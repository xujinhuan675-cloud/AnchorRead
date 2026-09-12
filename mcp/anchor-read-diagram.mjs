#!/usr/bin/env node
/**
 * AnchorRead Diagram MCP Server.
 *
 * This is the controlled Agent boundary for diagram scenes. Live mode submits
 * commands to the open AnchorRead browser tab, which is the primary workflow.
 * Offline file mode is retained for explicit import/export and migration work.
 *
 * Usage:
 *   node mcp/anchor-read-diagram.mjs --bridge http://127.0.0.1:3000
 *   node mcp/anchor-read-diagram.mjs <workspace-file.anchorread> --write
 *
 * Codex/Claude stdio configuration:
 * {
 *   "mcpServers": {
 *     "anchor-read-diagram": {
 *       "command": "node",
 *       "args": ["F:/AnchorOS/6-项目仓库/AnchorRead/mcp/anchor-read-diagram.mjs"]
 *     }
 *   }
 * }
 */

import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as Sentry from '@sentry/node';
import {
  applyScenePatch,
  alignScene,
  createSceneSnapshot,
  describeScene,
  duplicateScene,
  distributeScene,
  groupScene,
  querySceneElements,
  restoreSceneSnapshot,
  setSceneElementsLocked,
  setSceneViewport,
  ungroupScene,
} from '../lib/excalidraw-scene-ops.js';
import { parseExcalidrawScene, serializeExcalidrawScene } from '../lib/excalidraw-scene.js';
import {
  commitDiagramScene,
  findDiagramRevision,
  findDiagramRevisionByOperationId,
  getDiagramRevision,
  getDrawingScene,
  listDiagramRevisions,
  restoreDiagramRevision,
} from '../lib/diagram-scene-record.js';
import { createWorkspaceFilePayload, parseWorkspaceFile } from '../lib/workspace-file.js';
import { getPresentationSpec, normalizePresentationSpec } from '../lib/diagram-presentation.js';
import { createDefaultMermaidPresentation, createDefaultPresentation, isDefaultMermaidPresentation, isDefaultPresentation } from '../lib/diagram-stream.js';
import { executeDiagramAgentCommand, makeDrawing } from '../lib/diagram-agent-commands.js';
import { projectDiagram, projectDiagramAgentResult } from '../lib/diagram-agent-results.js';
import {
  buildDiagramUrl,
  buildDiagramWorkspaceUrl,
  createMcpBrowserRecoveryResult,
  createMcpErrorResult,
  createMcpToolResult,
  createInlineViewToolResult,
} from '../lib/diagram-mcp-links.js';
import {
  DIAGRAM_MCP_SERVER_INFO,
  DIAGRAM_MCP_INSTRUCTIONS,
  DIAGRAM_MCP_READ_ME,
  DIAGRAM_MCP_WRITE_TOOL_NAMES,
  getDiagramMcpTools,
} from '../lib/diagram-agent-mcp-contract.js';
import { getDiagramDesignGuide } from '../lib/diagram-design-guide.js';
import {
  DIAGRAM_MCP_APP_RESOURCE_URI,
  diagramMcpAppResourceListing,
  readDiagramMcpAppResource,
} from '../lib/diagram-mcp-app-resource.js';
import { createSentryOptions, safeTelemetryIdentifier } from '../lib/sentry-config.js';
import { openDiagramUrl } from '../lib/diagram-mcp-browser-launch.js';
import { createDiagramOperationMetrics, mergeDiagramOperationMetrics } from '../lib/diagram-operation-metrics.js';

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = DIAGRAM_MCP_SERVER_INFO;
const SERVER_INSTRUCTIONS = DIAGRAM_MCP_INSTRUCTIONS;
const sentryEnabled = Boolean(String(process.env.SENTRY_DSN || '').trim());
if (sentryEnabled) {
  Sentry.init(createSentryOptions({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT,
    release: process.env.SENTRY_RELEASE,
    service: 'anchorread-diagram-mcp',
    tracesSampleRate: process.env.SENTRY_TRACES_SAMPLE_RATE,
  }));
}
const rawArgs = process.argv.slice(2);
const writeEnabled = rawArgs.includes('--write') || process.env.ANCHORREAD_DIAGRAM_MCP_WRITE === 'true';
const bridgeIndex = rawArgs.findIndex((argument) => argument === '--bridge');
const bridgeValue = bridgeIndex >= 0
  ? rawArgs[bridgeIndex + 1]
  : rawArgs.find((argument) => argument.startsWith('--bridge='))?.slice('--bridge='.length);
const configuredBridgeUrl = bridgeValue || process.env.ANCHORREAD_DIAGRAM_BRIDGE_URL || '';
const bridgeUrl = normalizeBridgeUrl(configuredBridgeUrl || (
  rawArgs.length === 0 || rawArgs.every((argument) => argument.startsWith('--'))
    ? 'http://127.0.0.1:3000'
    : ''
));
const workspaceFlagIndex = rawArgs.findIndex((argument) => argument === '--workspace');
const workspaceArgument = workspaceFlagIndex >= 0
  ? rawArgs[workspaceFlagIndex + 1]
  : (!bridgeUrl ? rawArgs.find((argument) => !argument.startsWith('--')) : '');
const workspacePath = (workspaceArgument || process.env.ANCHORREAD_WORKSPACE_FILE || '')
  ? resolve(workspaceArgument || process.env.ANCHORREAD_WORKSPACE_FILE)
  : '';

function normalizeBridgeUrl(value) {
  const source = String(value || '').trim();
  if (!source) return '';
  const normalized = source.replace(/\/+$/, '');
  return normalized.endsWith('/api/diagram-agent') ? normalized : `${normalized}/api/diagram-agent`;
}

function textResult(value) {
  return createMcpToolResult(value);
}

function requireWorkspacePath() {
  if (!workspacePath) {
    throw new Error('未指定 .anchorread 工作区文件。');
  }
}

async function readWorkspace() {
  requireWorkspacePath();
  return parseWorkspaceFile(await readFile(workspacePath, 'utf8'));
}

async function writeWorkspace(payload) {
  requireWorkspacePath();
  if (!writeEnabled) {
    const error = new Error('Diagram MCP is read-only. Start it with --write to commit revisions.');
    error.code = 'WRITE_DISABLED';
    throw error;
  }
  const nextPayload = createWorkspaceFilePayload(payload.data, { exportedAt: Date.now() });
  const serialized = JSON.stringify(nextPayload, null, 2);
  const tempPath = `${workspacePath}.${process.pid}.tmp`;
  await writeFile(tempPath, serialized, 'utf8');
  try {
    await rename(tempPath, workspacePath);
  } catch (error) {
    // Windows cannot always replace an existing file with rename. Fall back to
    // a direct write while still removing the temporary artifact.
    await writeFile(workspacePath, serialized, 'utf8');
    await unlink(tempPath).catch(() => {});
    if (!error) return;
  }
  return nextPayload;
}

function getDrawing(payload, id) {
  const drawingId = String(id || '');
  const drawing = (payload.data?.drawings || []).find((item) => (
    item.id === drawingId || item.routeId === drawingId
  ));
  if (!drawing) throw new Error(`未找到图解：${drawingId}`);
  return drawing;
}

function getEffectivePresentation(drawing) {
  const stored = getPresentationSpec(drawing);
  if (drawing?.presentationDisabled === true) return null;
  if (drawing?.engine === 'mermaid') {
    if (!stored || isDefaultMermaidPresentation(stored)) return createDefaultMermaidPresentation(drawing.source);
    return stored;
  }
  if (stored && !isDefaultPresentation(stored)) return stored;
  if (drawing?.engine && drawing.engine !== 'excalidraw') return null;
  return createDefaultPresentation(getDrawingScene(drawing).elements);
}

function writeDrawing(payload, nextDrawing) {
  const drawings = Array.isArray(payload.data?.drawings) ? payload.data.drawings : [];
  const index = drawings.findIndex((item) => item.id === nextDrawing.id);
  if (index === -1) throw new Error(`未找到图解：${nextDrawing.id}`);
  return {
    ...payload,
    data: {
      ...payload.data,
      drawings: drawings.map((item, itemIndex) => itemIndex === index ? nextDrawing : item),
    },
  };
}

function namedSnapshots(drawing) {
  return Array.isArray(drawing?.namedSnapshots) ? drawing.namedSnapshots : [];
}

function snapshotSummary(drawing) {
  return namedSnapshots(drawing).map(({ elements, appState, files, ...summary }) => summary);
}

function saveNamedSnapshot(drawing, scene, name) {
  const normalizedName = String(name || '').trim();
  if (!normalizedName) throw new Error('snapshot requires a non-empty name');
  const snapshot = createSceneSnapshot(scene, { name: normalizedName, id: `${drawing.id}:snapshot:${normalizedName}` });
  return {
    ...drawing,
    namedSnapshots: [...namedSnapshots(drawing).filter((item) => item.name !== normalizedName), snapshot],
    updatedAt: Date.now(),
  };
}

function findNamedSnapshot(drawing, name) {
  const target = String(name || '').trim();
  const snapshot = namedSnapshots(drawing).find((item) => item.name === target || item.id === target);
  if (!snapshot) throw new Error(`Diagram snapshot not found: ${target}`);
  return snapshot;
}

function applyRequestedScenePatch(scene, patch = {}) {
  let next = applyScenePatch(scene, patch);
  if (patch.align) next = alignScene(next, patch.align);
  if (patch.distribute) next = distributeScene(next, patch.distribute);
  return next;
}

const ELEMENT_COMMAND_KEYS = new Set([
  'id', 'diagramId', 'drawingId', 'element', 'elements', 'elementId', 'elementIds',
  'changes', 'expectedRevision', 'author', 'reason', 'hardDelete', 'filter', 'filters',
  'bbox', 'includeDeleted',
]);

function elementPayload(args, { requireType = true, now = Date.now(), usedIds = new Set() } = {}) {
  const explicit = args?.element && typeof args.element === 'object' && !Array.isArray(args.element)
    ? args.element
    : (args?.changes && typeof args.changes === 'object' && !Array.isArray(args.changes) ? args.changes : null);
  const payload = explicit ? { ...explicit } : Object.fromEntries(
    Object.entries(args || {}).filter(([key]) => !ELEMENT_COMMAND_KEYS.has(key)),
  );
  if (args?.elementId !== undefined && payload.id === undefined) payload.id = args.elementId;
  if (payload.id === undefined) {
    const base = `element-${now}`;
    let candidate = base;
    let suffix = 1;
    while (usedIds.has(candidate)) candidate = `${base}-${suffix++}`;
    payload.id = candidate;
  }
  if (requireType && (!payload.type || typeof payload.type !== 'string')) {
    throw new TypeError('create_element requires an element type');
  }
  usedIds.add(String(payload.id));
  return payload;
}

function elementIdFromArgs(args) {
  const id = args?.elementId ?? (args?.element && typeof args.element === 'object' ? args.element.id : undefined);
  if (id === undefined || id === null || String(id).trim() === '') throw new TypeError('elementId is required');
  return String(id);
}

function queryFiltersFromArgs(args = {}) {
  const filters = { ...(args.filters || args.filter || {}) };
  if (args.type !== undefined && filters.type === undefined) filters.type = args.type;
  if (args.includeDeleted !== undefined) filters.includeDeleted = args.includeDeleted === true;
  if (args.bbox && typeof args.bbox === 'object') {
    const bbox = args.bbox;
    const x = Number.isFinite(bbox.x) ? bbox.x : bbox.x_min;
    const y = Number.isFinite(bbox.y) ? bbox.y : bbox.y_min;
    const maxX = Number.isFinite(bbox.maxX) ? bbox.maxX : bbox.x_max;
    const maxY = Number.isFinite(bbox.maxY) ? bbox.maxY : bbox.y_max;
    if ([x, y, maxX, maxY].every(Number.isFinite)) filters.bounds = { x, y, width: maxX - x, height: maxY - y };
  }
  return filters;
}

const BASE_TOOLS = [
  {
    name: 'read_me',
    description: '返回当前图解 MCP App 的输入格式与渲染约定，兼容官方 Excalidraw MCP Apps 的 read_me 工具。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'read_diagram_guide',
    description: '返回从 mcp_excalidraw 迁移并适配 AnchorRead 的完整制图指南。创建或大幅修改图解前必须先调用。',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'open_diagram_workspace',
    description: '返回 AnchorRead 图解工作区的可打开链接。具备浏览器或打开 URL 能力的 AI 客户端应立即打开该链接；不具备该能力的客户端应把链接展示给用户。该工具不要求已有配对浏览器在线。',
    inputSchema: { type: 'object', properties: { open: { type: 'boolean' } }, additionalProperties: false },
  },
  {
    name: 'ensure_workspace_ready',
    description: 'Prepare the AnchorRead diagram workspace. Local stdio mode can ask the operating system to open the default browser; remote mode returns a link for the client to open.',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: { open: { type: 'boolean' } }, additionalProperties: false },
  },
  {
    name: 'list_diagrams',
    description: '列出 AnchorRead 工作区中的图解。可按 documentId 筛选。',
    inputSchema: { type: 'object', properties: { documentId: { type: 'string' } }, additionalProperties: false },
  },
  {
    name: 'get_diagram',
    description: '默认读取轻量图解摘要；完整 scene、source、history、variants 必须通过 projection/include 显式请求。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        projection: { type: 'string', enum: ['summary', 'full'], default: 'summary' },
        include: { type: 'array', uniqueItems: true, items: { type: 'string', enum: ['scene', 'source', 'history', 'revisionHistory', 'variants', 'presentation', 'namedSnapshots'] } },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'describe_diagram',
    description: '生成适合 Agent 理解的图解结构描述，包括元素、边界、箭头连接和分组。',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, maxElements: { type: 'number' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'describe_scene',
    description: '兼容 mcp_excalidraw 的场景读取入口；返回指定图解的元素、位置、标签、连接、分组和边界。',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, maxElements: { type: 'number' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'query_diagram',
    description: '按元素 id、类型、文本、组、锁定状态或区域查询图解元素。',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, filters: { type: 'object' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'query_elements',
    description: '按元素类型、文本、分组、锁定状态或区域查询指定图解中的元素；id 是图解 id。',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, filters: { type: 'object', additionalProperties: true }, filter: { type: 'object', additionalProperties: true }, type: { type: 'string' }, bbox: { type: 'object', additionalProperties: true }, includeDeleted: { type: 'boolean' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_element',
    description: '读取指定图解中的单个元素。',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, elementId: { type: 'string' }, includeDeleted: { type: 'boolean' } },
      required: ['id', 'elementId'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_diagram_revisions',
    description: '列出图解的 revision 历史。',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
  },
  {
    name: 'list_diagram_snapshots',
    description: '列出图解中保存的命名快照。',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
  },
  {
    name: 'get_presentation',
    description: '读取图解播放步骤；有内容的 Mermaid 或 Excalidraw 图解即使尚未持久化脚本也会返回默认播放步骤。',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
  },
  {
    name: 'export_excalidraw',
    description: '导出完整标准 .excalidraw JSON 文本，供文件保存或外部 Excalidraw 工具继续编辑。',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
  },
];

const CREATE_TOOL = {
  name: 'create_diagram',
  _meta: {
    ui: { resourceUri: DIAGRAM_MCP_APP_RESOURCE_URI },
    'ui/resourceUri': DIAGRAM_MCP_APP_RESOURCE_URI,
  },
  description: '创建并保存一个新图解。只有浏览器完成 IndexedDB 写入并返回 id、routeId 与 revision 后才算成功；浏览器不可用时返回错误并提示打开图解工作区后重试。open=true（默认）只请求客户端在用户的默认浏览器中打开已保存图解的返回链接，不会强制当前标签页跳转。优先传入完整 Excalidraw scene 或 elements；也可传 Mermaid source。',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: '可选的稳定图解 id；省略时由 AnchorRead 生成。' },
      title: { type: 'string' },
      documentId: { type: 'string' },
      engine: { type: 'string', enum: ['excalidraw', 'mermaid'] },
      elements: { type: 'array', description: '官方兼容的 Excalidraw raw element 数组；可替代 scene。流程连线应包含稳定 id、startElementId/endElementId（或绑定）以及表示关系谓词的 label.text。' },
      scene: {},
      source: { type: 'string' },
      prompt: { type: 'string' },
      scope: { type: 'string' },
      intent: { type: 'string' },
      presentation: { type: 'object', description: '建议由 AI 随图生成的播放脚本。steps 使用累积 visibleElementIds，按“起点节点 → 终点节点 → 连线及关系文字”编排；已出现节点不重复占步，每步提供语义 title。' },
      stream: { type: 'boolean', description: '兼容性流式输入：元素可含 cameraUpdate/delete 伪元素；普通有内容的 Excalidraw 图解也会自动生成播放步骤。' },
      open: { type: 'boolean', description: '是否请求客户端在用户的默认浏览器中打开返回链接，默认 true；不会强制当前标签页跳转。' },
    },
    required: ['title'],
    additionalProperties: false,
  },
};

// Keep the official Excalidraw MCP Apps entry point available for clients that
// only know the upstream create_view contract. This path is intentionally
// local to the MCP App and does not require a paired AnchorRead browser.
const CREATE_VIEW_TOOL = {
  name: 'create_view',
  _meta: {
    ui: { resourceUri: DIAGRAM_MCP_APP_RESOURCE_URI },
    'ui/resourceUri': DIAGRAM_MCP_APP_RESOURCE_URI,
  },
  description: '在当前对话中直接创建可编辑的 Excalidraw 画布。场景数组顺序用于渲染，presentation.steps 决定播放顺序。流程连线应声明两端绑定和关系 label；优先随图生成按“起点节点 → 终点节点 → 连线及关系文字”逐个出现的语义步骤。未传 presentation 时会从绑定推断同样顺序。默认保持稳定全局视口，仅在跨阶段或跨区域时使用聚焦与镜头动画。不依赖浏览器工作区。',
  annotations: { readOnlyHint: true },
  inputSchema: {
    type: 'object',
    properties: {
      elements: { type: 'string', description: 'Excalidraw raw element 数组的 JSON 字符串。节点文字放入 shape.label；连线提供 startElementId/endElementId（或绑定），关系文字放入 arrow.label.text。' },
      presentation: { type: 'object', description: '建议随图生成。steps 以累积 visibleElementIds 按“起点节点 → 终点节点 → 连线及关系文字”逐个编排，并提供语义 title；已出现节点不重复占步。支持 focusElementIds、highlightElementIds、camera、durationMs、transitionMs、revealMs、holdMs。默认保持全局视口。' },
    },
    required: ['elements'],
    additionalProperties: false,
  },
};

const WRITE_TOOLS = [
  {
    name: 'align_elements',
    description: '按 mcp_excalidraw 语义对齐指定元素，并以 expectedRevision 保护提交。完成后应进行场景读取和截图复检。',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, elementIds: { type: 'array', items: { type: 'string' }, minItems: 2 }, alignment: { type: 'string', enum: ['left', 'center', 'right', 'top', 'middle', 'bottom'] }, expectedRevision: { type: 'number' }, author: { type: 'string' } }, required: ['id', 'elementIds', 'alignment'], additionalProperties: false },
  },
  {
    name: 'distribute_elements',
    description: '按 mcp_excalidraw 语义均匀分布至少三个元素，并以 expectedRevision 保护提交。完成后应截图复检。',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, elementIds: { type: 'array', items: { type: 'string' }, minItems: 3 }, direction: { type: 'string', enum: ['horizontal', 'vertical'] }, expectedRevision: { type: 'number' }, author: { type: 'string' } }, required: ['id', 'elementIds', 'direction'], additionalProperties: false },
  },
  {
    name: 'create_from_mermaid',
    description: '将 Mermaid 源保存为新的 AnchorRead Mermaid 图解。创建后必须截图检查自动布局。',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, documentId: { type: 'string' }, mermaidSyntax: { type: 'string' }, mermaidDiagram: { type: 'string', description: 'Upstream mcp_excalidraw alias for Mermaid source.' }, source: { type: 'string' }, config: { type: 'object', additionalProperties: true, description: 'Optional upstream Mermaid configuration; AnchorRead keeps rendering under its strict safe configuration.' }, open: { type: 'boolean' }, prompt: { type: 'string' }, scope: { type: 'string' }, intent: { type: 'string' } }, required: ['title'], anyOf: [{ required: ['mermaidSyntax'] }, { required: ['mermaidDiagram'] }, { required: ['source'] }], additionalProperties: false },
  },
  {
    name: 'create_element',
    description: '在指定 AnchorRead 图解中增量创建一个 Excalidraw 元素。',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, elementId: { type: 'string' }, element: { type: 'object', additionalProperties: true }, expectedRevision: { type: 'number' }, author: { type: 'string' }, reason: { type: 'string' } },
      required: ['id', 'element'],
      additionalProperties: false,
    },
  },
  {
    name: 'batch_create_elements',
    description: '在指定 AnchorRead 图解中原子地增量创建多个 Excalidraw 元素。',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, elements: { type: 'array', items: { type: 'object', additionalProperties: true }, minItems: 1 }, expectedRevision: { type: 'number' }, retryOnConflict: { type: 'boolean' }, maxConflictRetries: { type: 'integer', minimum: 0, maximum: 5 }, author: { type: 'string' }, reason: { type: 'string' }, operationId: { type: 'string', minLength: 1 } },
      required: ['id', 'elements'],
      additionalProperties: false,
    },
  },
  {
    name: 'batch_update_elements',
    description: 'Atomically apply multiple element updates in one scene revision with optional idempotency and conflict rebasing.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        updates: { type: 'array', minItems: 1, items: { type: 'object', additionalProperties: true } },
        expectedRevision: { type: 'number' },
        retryOnConflict: { type: 'boolean' },
        maxConflictRetries: { type: 'integer', minimum: 0, maximum: 5 },
        operationId: { type: 'string', minLength: 1 },
        author: { type: 'string' },
        reason: { type: 'string' },
      },
      required: ['id', 'updates'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_element',
    description: '按 elementId 增量更新指定图解中的一个元素。',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, elementId: { type: 'string' }, changes: { type: 'object', additionalProperties: true }, expectedRevision: { type: 'number' }, author: { type: 'string' }, reason: { type: 'string' } },
      required: ['id', 'elementId', 'changes'],
      additionalProperties: false,
    },
  },
  {
    name: 'delete_element',
    description: '按 elementId 删除指定图解中的元素，默认使用 Excalidraw 软删除。',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, elementId: { type: 'string' }, hardDelete: { type: 'boolean' }, expectedRevision: { type: 'number' }, author: { type: 'string' }, reason: { type: 'string' } },
      required: ['id', 'elementId'],
      additionalProperties: false,
    },
  },
  {
    name: 'clear_canvas',
    description: '清空指定图解中的全部活动元素，默认使用 Excalidraw 软删除。',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, hardDelete: { type: 'boolean' }, expectedRevision: { type: 'number' }, author: { type: 'string' }, reason: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_presentation',
    description: 'Persist presentation steps without creating a scene revision.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, presentation: { type: 'object' } }, required: ['id', 'presentation'], additionalProperties: false },
  },
  {
    name: 'clear_presentation',
    description: 'Remove presentation steps without creating a scene revision.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
  },
  ...['play_presentation', 'pause_presentation', 'next_presentation_step', 'previous_presentation_step', 'stop_presentation'].map((name) => ({
    name,
    description: 'Control presentation playback in the connected AnchorRead browser.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, stepIndex: { type: 'integer', minimum: 0 } }, required: ['id'], additionalProperties: false },
  })),
  {
    name: 'group_elements',
    description: '将多个元素加入同一个 Excalidraw 分组。',
    inputSchema: {
      type: 'object', properties: {
        id: { type: 'string' }, elementIds: { type: 'array', items: { type: 'string' }, minItems: 2 }, groupId: { type: 'string' },
        expectedRevision: { type: 'number' }, author: { type: 'string' },
      }, required: ['id', 'elementIds'], additionalProperties: false,
    },
  },
  {
    name: 'ungroup_elements',
    description: '移除指定 groupId，或移除指定元素上的分组。',
    inputSchema: {
      type: 'object', properties: {
        id: { type: 'string' }, elementIds: { type: 'array', items: { type: 'string' } }, groupId: { type: 'string' },
        expectedRevision: { type: 'number' }, author: { type: 'string' },
      }, required: ['id'], additionalProperties: false,
    },
  },
  {
    name: 'lock_elements',
    description: '锁定元素，防止画布中的后续编辑误改。',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, elementIds: { type: 'array', items: { type: 'string' } }, expectedRevision: { type: 'number' } }, required: ['id', 'elementIds'], additionalProperties: false },
  },
  {
    name: 'unlock_elements',
    description: '解除元素锁定。',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, elementIds: { type: 'array', items: { type: 'string' } }, expectedRevision: { type: 'number' } }, required: ['id', 'elementIds'], additionalProperties: false },
  },
  {
    name: 'duplicate_elements',
    description: '复制指定元素，可设置平移偏移量，并保留复制组内箭头绑定。',
    inputSchema: {
      type: 'object', properties: {
        id: { type: 'string' }, elementIds: { type: 'array', items: { type: 'string' }, minItems: 1 }, offsetX: { type: 'number' }, offsetY: { type: 'number' }, expectedRevision: { type: 'number' },
      }, required: ['id', 'elementIds'], additionalProperties: false,
    },
  },
  {
    name: 'snapshot_scene',
    description: '保存当前图解的命名快照，快照留在 AnchorRead 工作区中。',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } }, required: ['id', 'name'], additionalProperties: false },
  },
  {
    name: 'restore_snapshot',
    description: '将当前图解恢复到命名快照，并创建新的 revision。',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, expectedRevision: { type: 'number' } }, required: ['id', 'name'], additionalProperties: false },
  },
  {
    name: 'set_viewport',
    description: '控制图解视口：适配全部元素、聚焦元素或设置 zoom/scroll。',
    inputSchema: {
      type: 'object', properties: {
        id: { type: 'string' }, scrollToContent: { type: 'boolean' }, scrollToElementIds: { type: 'array', items: { type: 'string' } }, scrollToElementId: { type: 'string' }, viewportZoomFactor: { type: 'number' }, zoom: { type: 'number' }, scrollX: { type: 'number' }, scrollY: { type: 'number' }, expectedRevision: { type: 'number' },
      }, required: ['id'], additionalProperties: false,
    },
  },
  {
    name: 'get_canvas_screenshot',
    description: '从当前 AnchorRead 浏览器画布捕获 PNG，供模型进行视觉验收。',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
  },
  {
    name: 'share_diagram',
    description: '生成当前 AnchorRead 图解的本地路由链接；不上传到第三方服务。',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
  },
  {
    name: 'apply_diagram_patch',
    description: '以 revision 乐观锁提交元素 create/update/delete/align/distribute patch。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        expectedRevision: { type: 'number' },
        patch: { type: 'object' },
        author: { type: 'string' },
        reason: { type: 'string' },
        retryOnConflict: { type: 'boolean' },
        maxConflictRetries: { type: 'integer', minimum: 0, maximum: 5 },
        operationId: { type: 'string', minLength: 1 },
      },
      required: ['id', 'patch'],
      additionalProperties: false,
    },
  },
  {
    name: 'commit_diagram_scene',
    description: '提交完整 Excalidraw scene；expectedRevision 不匹配时拒绝覆盖。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        scene: {},
        expectedRevision: { type: 'number' },
        author: { type: 'string' },
        reason: { type: 'string' },
      },
      required: ['id', 'scene'],
      additionalProperties: false,
    },
  },
  {
    name: 'restore_diagram_revision',
    description: '将图解恢复到指定 revision，并创建一个新的提交 revision。',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, revision: {}, expectedRevision: { type: 'number' }, author: { type: 'string' } },
      required: ['id', 'revision'],
      additionalProperties: false,
    },
  },
];

const offlineToolNames = new Set([
  ...BASE_TOOLS.map((tool) => tool.name),
  CREATE_VIEW_TOOL.name,
  ...(writeEnabled ? WRITE_TOOLS.map((tool) => tool.name) : []),
]);
const TOOLS = getDiagramMcpTools({ includeExport: !bridgeUrl })
  .filter((tool) => bridgeUrl || offlineToolNames.has(tool.name));
const WRITE_TOOL_NAMES = new Set(DIAGRAM_MCP_WRITE_TOOL_NAMES);
let writeQueue = Promise.resolve();

function enqueueWrite(task) {
  const next = writeQueue.then(task);
  writeQueue = next.catch(() => {});
  return next;
}

async function callToolImpl(name, args = {}) {
  if (name === 'read_me') return textResult({ name: 'anchor-read-diagram', instructions: DIAGRAM_MCP_READ_ME });
  if (name === 'read_diagram_guide') return textResult(getDiagramDesignGuide());
  if (name === 'open_diagram_workspace') {
    const url = buildDiagramWorkspaceUrl();
    const shouldOpen = args?.open === true;
    const launch = shouldOpen ? openDiagramUrl(url, { force: true }) : { opened: false, code: 'OPEN_NOT_REQUESTED', url };
    return textResult({
      url,
      ...launch,
      openRequested: shouldOpen,
      openAction: launch.opened ? 'opened_by_local_companion' : 'open_url_if_supported',
      openTarget: 'default_browser',
      openResource: { kind: 'workspace', url },
    });
  }
  if (name === 'ensure_workspace_ready') {
    const url = buildDiagramWorkspaceUrl();
    const shouldOpen = args?.open !== false;
    const launch = shouldOpen ? openDiagramUrl(url) : { opened: false, code: 'OPEN_NOT_REQUESTED', url };
    return textResult({
      ready: false,
      readiness: 'browser_connection_pending',
      mode: 'local_stdio',
      url,
      ...launch,
      nextAction: 'verify_browser_connection_then_retry',
      openRequested: shouldOpen,
      openAction: launch.opened ? 'opened_by_local_companion' : 'open_url_if_supported',
      openTarget: 'default_browser',
      openResource: { kind: 'workspace', url },
    });
  }
  if (name === 'create_view') return createInlineViewToolResult(args);
  if (bridgeUrl) {
    return callBridgeTool(name, args);
  }
  const payload = await readWorkspace();
  switch (name) {
    case 'list_diagrams':
      return textResult((payload.data.drawings || [])
        .filter((drawing) => !args.documentId || drawing.documentId === args.documentId)
        .map((drawing) => ({
          id: drawing.id,
          routeId: drawing.routeId,
          documentId: drawing.documentId,
          title: drawing.title,
          engine: drawing.engine,
          revision: drawing.revision || 0,
          updatedAt: drawing.updatedAt,
        })));
    case 'get_diagram': {
      const drawing = getDrawing(payload, args.id);
      return textResult(projectDiagram(drawing, args));
    }
    case 'describe_diagram':
    case 'describe_scene':
      return textResult(describeScene(getDrawingScene(getDrawing(payload, args.id)), {
        maxElements: Number.isInteger(args.maxElements) ? args.maxElements : Infinity,
      }));
    case 'query_diagram':
      return textResult(querySceneElements(getDrawingScene(getDrawing(payload, args.id)), args.filters || {}));
    case 'query_elements': {
      const drawing = getDrawing(payload, args.id);
      return textResult(querySceneElements(getDrawingScene(drawing), queryFiltersFromArgs(args)));
    }
    case 'get_element': {
      const drawing = getDrawing(payload, args.id);
      const elementId = elementIdFromArgs(args);
      const element = querySceneElements(getDrawingScene(drawing), { ids: [elementId], includeDeleted: args.includeDeleted === true })[0];
      if (!element) throw new Error(`Element not found: ${elementId}`);
      return textResult({ id: drawing.id, routeId: drawing.routeId, revision: drawing.revision || 0, element });
    }
    case 'list_diagram_revisions':
      return textResult(listDiagramRevisions(getDrawing(payload, args.id)));
    case 'list_diagram_snapshots':
      return textResult(snapshotSummary(getDrawing(payload, args.id)));
    case 'get_presentation': {
      const drawing = getDrawing(payload, args.id);
      return textResult({ id: drawing.id, routeId: drawing.routeId, presentation: getEffectivePresentation(drawing) });
    }
    case 'align_elements': {
      const drawing = getDrawing(payload, args.id);
      const scene = alignScene(getDrawingScene(drawing), { ids: args.elementIds, alignment: args.alignment });
      const nextDrawing = commitDiagramScene(drawing, scene, { ...args, author: args.author || 'agent', reason: 'align-elements' });
      await writeWorkspace(writeDrawing(payload, nextDrawing));
      return textResult({ id: nextDrawing.id, routeId: nextDrawing.routeId, revision: nextDrawing.revision, elementIds: args.elementIds, alignment: args.alignment, scene: nextDrawing.scene, nextAction: 'describe_scene_then_get_canvas_screenshot' });
    }
    case 'distribute_elements': {
      const drawing = getDrawing(payload, args.id);
      const scene = distributeScene(getDrawingScene(drawing), { ids: args.elementIds, direction: args.direction });
      const nextDrawing = commitDiagramScene(drawing, scene, { ...args, author: args.author || 'agent', reason: 'distribute-elements' });
      await writeWorkspace(writeDrawing(payload, nextDrawing));
      return textResult({ id: nextDrawing.id, routeId: nextDrawing.routeId, revision: nextDrawing.revision, elementIds: args.elementIds, direction: args.direction, scene: nextDrawing.scene, nextAction: 'describe_scene_then_get_canvas_screenshot' });
    }
    case 'create_from_mermaid': {
      if (!writeEnabled) {
        const error = new Error('Diagram MCP is read-only. Start it with --write to create a Mermaid diagram.');
        error.code = 'WRITE_DISABLED';
        throw error;
      }
      const source = args.mermaidSyntax ?? args.mermaidDiagram ?? args.source;
      if (!String(source || '').trim()) throw new TypeError('create_from_mermaid requires mermaidSyntax, mermaidDiagram, or source');
      const drawing = makeDrawing({
        ...args,
        engine: 'mermaid',
        source,
      }, {
        now: Date.now(),
        existingDrawings: Array.isArray(payload.data?.drawings) ? payload.data.drawings : [],
      });
      const nextPayload = {
        ...payload,
        data: {
          ...payload.data,
          drawings: [...(Array.isArray(payload.data?.drawings) ? payload.data.drawings : []), drawing],
        },
      };
      await writeWorkspace(nextPayload);
      const url = buildDiagramUrl(drawing.routeId);
      const openRequested = args.open !== false;
      return textResult({
        ...drawing,
        scene: null,
        url,
        openRequested,
        openAction: openRequested ? 'open_url_if_supported' : 'none',
        ...(openRequested ? { openTarget: 'default_browser' } : {}),
        openResource: { kind: 'diagram', routeId: drawing.routeId, title: drawing.title, url },
        presentationAutoPlayed: false,
      });
    }
    case 'export_excalidraw':
      return textResult(serializeExcalidrawScene(getDrawingScene(getDrawing(payload, args.id))));
    case 'create_element': {
      const drawing = getDrawing(payload, args.id);
      const scene = getDrawingScene(drawing);
      const usedIds = new Set(scene.elements.map((element) => String(element.id)));
      const element = elementPayload(args, { now: Date.now(), usedIds });
      const nextDrawing = commitDiagramScene(drawing, applyScenePatch(scene, { create: [element] }), args);
      await writeWorkspace(writeDrawing(payload, nextDrawing));
      return textResult({ id: nextDrawing.id, routeId: nextDrawing.routeId, revision: nextDrawing.revision, element: nextDrawing.scene.elements.find((item) => item.id === element.id), scene: nextDrawing.scene });
    }
    case 'batch_create_elements': {
      const repository = {
        drawings: {
          list: async () => (await readWorkspace()).data.drawings || [],
          get: async (id) => getDrawing(await readWorkspace(), id),
          save: async (nextDrawing, options = {}) => {
            const latestPayload = await readWorkspace();
            const current = getDrawing(latestPayload, nextDrawing.id);
            if (options.expectedRevision !== undefined && getDiagramRevision(current) !== Number(options.expectedRevision)) {
              const error = new Error(`Diagram revision conflict: expected ${options.expectedRevision}, actual ${getDiagramRevision(current)}.`);
              error.code = 'REVISION_CONFLICT';
              error.expectedRevision = Number(options.expectedRevision);
              error.actualRevision = getDiagramRevision(current);
              throw error;
            }
            await writeWorkspace(writeDrawing(latestPayload, nextDrawing));
            return nextDrawing;
          },
        },
      };
      return textResult(await executeDiagramAgentCommand({ tool: name, args }, { repository, transport: 'stdio-file', compactResponse: true }));
    }
    case 'batch_update_elements': {
      const drawing = getDrawing(payload, args.id);
      const replay = idempotentReplay(drawing, args, name);
      if (replay) return textResult(replay);
      const updates = normalizeBatchUpdates(args);
      let expectedRevision = args.expectedRevision;
      let conflictRetries = 0;
      try {
        const nextDrawing = commitDiagramScene(drawing, applyScenePatch(getDrawingScene(drawing), { update: updates }), {
          ...args,
          expectedRevision,
          operationId: args.operationId,
          operationFingerprint: args.operationId ? operationFingerprint(name, args) : undefined,
          reason: args.reason || 'batch-update-elements',
        });
        await writeWorkspace(writeDrawing(payload, nextDrawing));
        return textResult({ id: nextDrawing.id, routeId: nextDrawing.routeId, revision: nextDrawing.revision, elements: updates.map(({ id }) => nextDrawing.scene.elements.find((item) => item.id === id)), scene: nextDrawing.scene, conflictRetries });
      } catch (error) {
        if (error?.code !== 'REVISION_CONFLICT' || args.retryOnConflict !== true) throw error;
        conflictRetries = 1;
        expectedRevision = getDiagramRevision(drawing);
        const nextDrawing = commitDiagramScene(drawing, applyScenePatch(getDrawingScene(drawing), { update: updates }), {
          ...args,
          expectedRevision,
          operationId: args.operationId,
          operationFingerprint: args.operationId ? operationFingerprint(name, args) : undefined,
          reason: args.reason || 'batch-update-elements',
        });
        await writeWorkspace(writeDrawing(payload, nextDrawing));
        return textResult({ id: nextDrawing.id, routeId: nextDrawing.routeId, revision: nextDrawing.revision, elements: updates.map(({ id }) => nextDrawing.scene.elements.find((item) => item.id === id)), scene: nextDrawing.scene, conflictRetries });
      }
    }
    case 'update_element': {
      const drawing = getDrawing(payload, args.id);
      const scene = getDrawingScene(drawing);
      const elementId = elementIdFromArgs(args);
      const changes = args.changes && typeof args.changes === 'object' ? { ...args.changes } : elementPayload(args, { requireType: false });
      delete changes.id;
      if (Object.keys(changes).length === 0) throw new TypeError('update_element requires at least one change');
      const nextDrawing = commitDiagramScene(drawing, applyScenePatch(scene, { update: [{ id: elementId, ...changes }] }), args);
      await writeWorkspace(writeDrawing(payload, nextDrawing));
      return textResult({ id: nextDrawing.id, routeId: nextDrawing.routeId, revision: nextDrawing.revision, element: nextDrawing.scene.elements.find((item) => item.id === elementId), scene: nextDrawing.scene });
    }
    case 'delete_element': {
      const drawing = getDrawing(payload, args.id);
      const elementId = elementIdFromArgs(args);
      const nextDrawing = commitDiagramScene(drawing, applyScenePatch(getDrawingScene(drawing), { delete: [elementId] }, { hardDelete: args.hardDelete === true }), args);
      await writeWorkspace(writeDrawing(payload, nextDrawing));
      return textResult({ id: nextDrawing.id, routeId: nextDrawing.routeId, revision: nextDrawing.revision, element: nextDrawing.scene.elements.find((item) => item.id === elementId) || null, deleted: true, hardDelete: args.hardDelete === true, scene: nextDrawing.scene });
    }
    case 'clear_canvas': {
      const drawing = getDrawing(payload, args.id);
      const scene = getDrawingScene(drawing);
      const ids = scene.elements.filter((element) => !element.isDeleted).map((element) => element.id);
      if (ids.length === 0) return textResult({ id: drawing.id, routeId: drawing.routeId, revision: drawing.revision || 0, deletedCount: 0, scene });
      const nextDrawing = commitDiagramScene(drawing, applyScenePatch(scene, { delete: ids }, { hardDelete: args.hardDelete === true }), args);
      await writeWorkspace(writeDrawing(payload, nextDrawing));
      return textResult({ id: nextDrawing.id, routeId: nextDrawing.routeId, revision: nextDrawing.revision, deletedCount: ids.length, hardDelete: args.hardDelete === true, scene: nextDrawing.scene });
    }
    case 'set_presentation': {
      const drawing = getDrawing(payload, args.id);
      const presentation = normalizePresentationSpec(args.presentation);
      const nextDrawing = { ...drawing, presentation, presentationDisabled: false, updatedAt: Date.now() };
      await writeWorkspace(writeDrawing(payload, nextDrawing));
      return textResult({ id: nextDrawing.id, routeId: nextDrawing.routeId, revision: nextDrawing.revision || 0, presentation });
    }
    case 'clear_presentation': {
      const drawing = getDrawing(payload, args.id);
      const { presentation: _presentation, presentationSpec: _presentationSpec, ...rest } = drawing;
      const nextDrawing = { ...rest, presentationDisabled: true, updatedAt: Date.now() };
      await writeWorkspace(writeDrawing(payload, nextDrawing));
      return textResult({ id: nextDrawing.id, routeId: nextDrawing.routeId, revision: nextDrawing.revision || 0, presentation: null });
    }
    case 'play_presentation':
    case 'pause_presentation':
    case 'next_presentation_step':
    case 'previous_presentation_step':
    case 'stop_presentation':
      throw new Error('Presentation playback requires live browser mode.');
    case 'group_elements': {
      const drawing = getDrawing(payload, args.id);
      const result = groupScene(getDrawingScene(drawing), { ids: args.elementIds, groupId: args.groupId });
      const nextDrawing = commitDiagramScene(drawing, result.scene, { ...args, reason: 'group-elements' });
      await writeWorkspace(writeDrawing(payload, nextDrawing));
      return textResult({ id: nextDrawing.id, revision: nextDrawing.revision, groupId: result.groupId, scene: nextDrawing.scene });
    }
    case 'ungroup_elements': {
      const drawing = getDrawing(payload, args.id);
      const result = ungroupScene(getDrawingScene(drawing), { ids: args.elementIds, groupId: args.groupId });
      const nextDrawing = commitDiagramScene(drawing, result.scene, { ...args, reason: 'ungroup-elements' });
      await writeWorkspace(writeDrawing(payload, nextDrawing));
      return textResult({ id: nextDrawing.id, revision: nextDrawing.revision, scene: nextDrawing.scene });
    }
    case 'lock_elements':
    case 'unlock_elements': {
      const drawing = getDrawing(payload, args.id);
      const scene = setSceneElementsLocked(getDrawingScene(drawing), { ids: args.elementIds, locked: name === 'lock_elements' });
      const nextDrawing = commitDiagramScene(drawing, scene, { ...args, reason: name });
      await writeWorkspace(writeDrawing(payload, nextDrawing));
      return textResult({ id: nextDrawing.id, revision: nextDrawing.revision, scene: nextDrawing.scene });
    }
    case 'duplicate_elements': {
      const drawing = getDrawing(payload, args.id);
      const result = duplicateScene(getDrawingScene(drawing), args);
      const nextDrawing = commitDiagramScene(drawing, result.scene, { ...args, reason: 'duplicate-elements' });
      await writeWorkspace(writeDrawing(payload, nextDrawing));
      return textResult({ id: nextDrawing.id, revision: nextDrawing.revision, elements: result.elements, scene: nextDrawing.scene });
    }
    case 'snapshot_scene': {
      const drawing = getDrawing(payload, args.id);
      const nextDrawing = saveNamedSnapshot(drawing, getDrawingScene(drawing), args.name);
      await writeWorkspace(writeDrawing(payload, nextDrawing));
      return textResult({ id: nextDrawing.id, snapshots: snapshotSummary(nextDrawing) });
    }
    case 'restore_snapshot': {
      const drawing = getDrawing(payload, args.id);
      const snapshot = findNamedSnapshot(drawing, args.name);
      const nextDrawing = commitDiagramScene(drawing, restoreSceneSnapshot(snapshot), { ...args, reason: `restore-snapshot:${snapshot.name}` });
      await writeWorkspace(writeDrawing(payload, nextDrawing));
      return textResult({ id: nextDrawing.id, revision: nextDrawing.revision, snapshot: snapshot.name, scene: nextDrawing.scene });
    }
    case 'set_viewport': {
      const drawing = getDrawing(payload, args.id);
      const scene = setSceneViewport(getDrawingScene(drawing), args);
      const nextDrawing = commitDiagramScene(drawing, scene, { ...args, reason: 'set-viewport' });
      await writeWorkspace(writeDrawing(payload, nextDrawing));
      return textResult({ id: nextDrawing.id, revision: nextDrawing.revision, appState: nextDrawing.scene.appState });
    }
    case 'share_diagram': {
      const drawing = getDrawing(payload, args.id);
      const url = buildDiagramUrl(drawing.routeId);
      return textResult({
        routeId: drawing.routeId,
        url,
        local: true,
        openAction: 'open_url_if_supported',
        openResource: { kind: 'diagram', routeId: drawing.routeId, title: drawing.title, url },
      });
    }
    case 'get_canvas_screenshot':
      throw new Error('get_canvas_screenshot requires live browser mode.');
    case 'apply_diagram_patch': {
      const drawing = getDrawing(payload, args.id);
      const replay = idempotentReplay(drawing, args, name);
      if (replay) return textResult(replay);
      const commitArgs = {
        ...args,
        operationId: args.operationId,
        operationFingerprint: args.operationId ? operationFingerprint(name, args) : undefined,
        reason: args.reason || 'agent-patch',
      };
      try {
        const nextDrawing = commitDiagramScene(drawing, applyRequestedScenePatch(getDrawingScene(drawing), args.patch || {}), commitArgs);
        await writeWorkspace(writeDrawing(payload, nextDrawing));
        return textResult({ id: nextDrawing.id, revision: nextDrawing.revision, scene: nextDrawing.scene, conflictRetries: 0 });
      } catch (error) {
        if (error?.code !== 'REVISION_CONFLICT' || args.retryOnConflict !== true) throw error;
        const nextDrawing = commitDiagramScene(drawing, applyRequestedScenePatch(getDrawingScene(drawing), args.patch || {}), {
          ...commitArgs,
          expectedRevision: getDiagramRevision(drawing),
        });
        await writeWorkspace(writeDrawing(payload, nextDrawing));
        return textResult({ id: nextDrawing.id, revision: nextDrawing.revision, scene: nextDrawing.scene, conflictRetries: 1 });
      }
    }
    case 'commit_diagram_scene': {
      const drawing = getDrawing(payload, args.id);
      const nextDrawing = commitDiagramScene(drawing, parseExcalidrawScene(args.scene), args);
      await writeWorkspace(writeDrawing(payload, nextDrawing));
      return textResult({ id: nextDrawing.id, revision: nextDrawing.revision, scene: nextDrawing.scene });
    }
    case 'restore_diagram_revision': {
      const drawing = getDrawing(payload, args.id);
      if (!findDiagramRevision(drawing, args.revision)) throw new Error(`Diagram revision not found: ${args.revision}`);
      const nextDrawing = restoreDiagramRevision(drawing, args.revision, args);
      await writeWorkspace(writeDrawing(payload, nextDrawing));
      return textResult({ id: nextDrawing.id, revision: nextDrawing.revision, scene: nextDrawing.scene });
    }
    default:
      throw new Error(`未知工具：${name}`);
  }
}

function stableOperationValue(value) {
  if (Array.isArray(value)) return value.map(stableOperationValue);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = stableOperationValue(value[key]);
    return result;
  }, {});
}

function operationFingerprint(tool, args) {
  const payload = { ...args };
  delete payload.expectedRevision;
  delete payload.retryOnConflict;
  delete payload.maxConflictRetries;
  delete payload.includeScene;
  return JSON.stringify(stableOperationValue({ tool, args: payload }));
}

function idempotentReplay(drawing, args, tool) {
  if (!args?.operationId) return null;
  const previous = findDiagramRevisionByOperationId(drawing, args.operationId);
  if (!previous) return null;
  if (previous.operationFingerprint && previous.operationFingerprint !== operationFingerprint(tool, args)) {
    const error = new Error(`operationId ${args.operationId} was already used for a different diagram operation.`);
    error.code = 'IDEMPOTENCY_KEY_REUSE';
    throw error;
  }
  return { id: drawing.id, routeId: drawing.routeId, revision: drawing.revision, operationRevision: previous.revision, idempotentReplay: true, scene: getDrawingScene(drawing) };
}

function normalizeBatchUpdates(args) {
  const updates = Array.isArray(args.updates) ? args.updates : [];
  if (updates.length === 0) throw new TypeError('batch_update_elements requires a non-empty updates array');
  return updates.map((item) => {
    if (!item || typeof item !== 'object') throw new TypeError('batch_update_elements updates must be objects');
    const id = item.elementId ?? item.id;
    if (id === undefined || id === null || String(id).trim() === '') throw new TypeError('batch_update_elements requires elementId for every update');
    const changes = item.changes && typeof item.changes === 'object' ? { ...item.changes } : { ...item };
    delete changes.id;
    delete changes.elementId;
    delete changes.changes;
    if (Object.keys(changes).length === 0) throw new TypeError(`batch_update_elements update ${id} has no changes`);
    return { id: String(id), ...changes };
  });
}

async function callTool(name, args = {}) {
  const toolName = safeTelemetryIdentifier(name);
  const metrics = createDiagramOperationMetrics({ operation: toolName, transport: 'stdio', payload: args });
  return Sentry.startSpan({
    name: `mcp.tool ${toolName}`,
    op: 'mcp.server',
    attributes: {
      'app.mcp.transport': 'stdio',
      'app.mcp.method': 'tools/call',
      'app.mcp.tool': toolName,
    },
  }, async (span) => {
    try {
      let result = await metrics.measure('serverExecutionMs', () => callToolImpl(name, args));
      if (!bridgeUrl && result?.structuredContent && typeof result.structuredContent === 'object') {
        const projected = projectDiagramAgentResult({ tool: name, args }, result.structuredContent);
        if (projected !== result.structuredContent) result = createMcpToolResult(projected);
      }
      const browserMetrics = result?.structuredContent?.operationMetrics || result?.operationMetrics || {};
      const operationMetrics = { ...browserMetrics, ...metrics.finish(result, 'ok') };
      const attributes = {
        'app.mcp.total_ms': operationMetrics.mcpTotalMs,
        'app.mcp.server_execution_ms': operationMetrics.serverExecutionMs,
        'app.mcp.bridge_round_trip_ms': operationMetrics.bridgeRoundTripMs,
        'app.mcp.browser_execution_ms': operationMetrics.browserExecutionMs,
        'app.mcp.repository_read_ms': operationMetrics.repositoryReadMs,
        'app.mcp.repository_write_ms': operationMetrics.repositoryWriteMs,
        'app.mcp.request_bytes': operationMetrics.requestBytes,
        'app.mcp.response_bytes': operationMetrics.responseBytes,
        'app.mcp.conflict_retries': operationMetrics.conflictRetries,
      };
      for (const [key, value] of Object.entries(attributes)) {
        if (Number.isFinite(value)) span.setAttribute(key, value);
      }
      span.setAttribute('app.mcp.outcome', 'ok');
      if (result?.structuredContent && typeof result.structuredContent === 'object') {
        return { ...result, structuredContent: mergeDiagramOperationMetrics(result.structuredContent, operationMetrics) };
      }
      return result;
    } catch (error) {
      const operationMetrics = metrics.finish({ error: String(error?.message || error) }, 'error');
      span.setAttribute('app.mcp.total_ms', operationMetrics.mcpTotalMs);
      span.setAttribute('app.mcp.request_bytes', operationMetrics.requestBytes);
      span.setAttribute('app.mcp.response_bytes', operationMetrics.responseBytes);
      span.setAttribute('app.mcp.outcome', 'error');
      throw error;
    }
  });
}

async function callBridgeTool(name, args = {}) {
  const startedAt = Date.now();
  const headers = { 'content-type': 'application/json' };
  const token = String(process.env.ANCHORREAD_DIAGRAM_BRIDGE_TOKEN || '').trim();
  if (token) headers['x-anchorread-bridge-token'] = token;
  const timeoutMs = Math.max(5_000, Math.min(Number(process.env.ANCHORREAD_DIAGRAM_BRIDGE_TIMEOUT_MS) || 90_000, 180_000));
  let response;
  try {
    response = await fetch(bridgeUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: 'submit', request: { tool: name, args }, timeoutMs }),
      signal: AbortSignal.timeout(timeoutMs + 5_000),
    });
  } catch (error) {
    const wrapped = new Error(`无法连接 AnchorRead live bridge ${bridgeUrl}: ${error?.message || error}`);
    wrapped.code = 'BROWSER_SESSION_OFFLINE';
    throw wrapped;
  }
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error(`AnchorRead live bridge returned non-JSON (${response.status}).`);
  }
  if (!response.ok || !body?.ok) {
    const error = new Error(body?.error || `AnchorRead live bridge failed (${response.status}).`);
    Object.assign(error, body, { code: String(body?.code || '').trim() || `BRIDGE_HTTP_${response.status}` });
    throw error;
  }
  const result = mergeDiagramOperationMetrics(body.result, { bridgeRoundTripMs: Date.now() - startedAt });
  if (result && Array.isArray(result.content)) return result;
  return textResult(projectDiagramAgentResult({ tool: name, args }, result));
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function handleRequestImpl(request) {
  const { id, method, params } = request;
  try {
    switch (method) {
      case 'initialize':
        return send({
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: {}, resources: {} },
            serverInfo: SERVER_INFO,
            instructions: SERVER_INSTRUCTIONS,
          },
        });
      case 'tools/list':
        return send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
      case 'resources/list':
        return send({ jsonrpc: '2.0', id, result: { resources: [diagramMcpAppResourceListing()] } });
      case 'resources/read': {
        const uri = String(params?.uri || '').trim();
        if (uri !== DIAGRAM_MCP_APP_RESOURCE_URI) {
          return send({ jsonrpc: '2.0', id, error: { code: -32602, message: `未知 MCP App 资源：${uri}` } });
        }
        return send({ jsonrpc: '2.0', id, result: { contents: [readDiagramMcpAppResource()] } });
      }
      case 'tools/call': {
        // Offline workspace reads and writes share one queue so a read sent in
        // the same JSON-RPC batch cannot observe the scene before a prior
        // element mutation has finished persisting it. Live browser reads stay
        // concurrent; live writes retain their existing serialization.
        const result = await (!bridgeUrl || WRITE_TOOL_NAMES.has(params?.name)
          ? enqueueWrite(() => callTool(params?.name, params?.arguments))
          : callTool(params?.name, params?.arguments));
        return send({ jsonrpc: '2.0', id, result });
      }
      case 'ping':
        return send({ jsonrpc: '2.0', id, result: {} });
      default:
        return send({ jsonrpc: '2.0', id, error: { code: -32601, message: `方法不支持：${method}` } });
    }
  } catch (error) {
    if (method === 'tools/call') {
      const recovery = createMcpBrowserRecoveryResult(error);
      return send({
        jsonrpc: '2.0',
        id,
        result: recovery ? { ...recovery, isError: true } : createMcpErrorResult(error),
      });
    }
    return send({ jsonrpc: '2.0', id, error: { code: -32000, message: String(error?.message || error) } });
  }
}

async function handleRequest(request) {
  const method = safeTelemetryIdentifier(request?.method);
  const tool = method === 'tools/call'
    ? safeTelemetryIdentifier(request?.params?.name)
    : undefined;
  return Sentry.startSpan({
    name: tool ? `mcp.rpc ${method}/${tool}` : `mcp.rpc ${method}`,
    op: 'mcp.server',
    attributes: {
      'app.mcp.transport': 'stdio',
      'app.mcp.method': method,
      ...(tool ? { 'app.mcp.tool': tool } : {}),
    },
  }, async (span) => {
    try {
      const result = await handleRequestImpl(request);
      span.setAttribute('app.mcp.outcome', 'completed');
      return result;
    } catch (error) {
      span.setAttribute('app.mcp.outcome', 'error');
      throw error;
    }
  });
}

let buffer = '';
const pendingRequests = new Set();
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let newlineIndex;
  while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, newlineIndex).trim();
    buffer = buffer.slice(newlineIndex + 1);
    if (!line) continue;
    try {
      const request = JSON.parse(line);
      if (request.id !== undefined && request.id !== null) {
        const pending = handleRequest(request).finally(() => pendingRequests.delete(pending));
        pendingRequests.add(pending);
      }
    } catch {
      // Ignore malformed lines to keep stdio transport alive.
    }
  }
});
process.stdin.on('end', async () => {
  await Promise.all(pendingRequests);
  if (sentryEnabled) await Sentry.flush(2_000);
  process.exit(0);
});
