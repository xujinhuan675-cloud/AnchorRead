#!/usr/bin/env node
/**
 * AnchorRead Diagram MCP Server.
 *
 * This is the controlled Agent boundary for diagram scenes. Live mode submits
 * commands to the open AnchorRead browser tab, which is the primary workflow.
 * Offline file mode is retained for explicit import/export and migration work.
 *
 * Usage:
 *   node mcp/anchor-read-diagram-mcp.mjs --bridge http://127.0.0.1:3000
 *   node mcp/anchor-read-diagram-mcp.mjs <workspace-file.anchorread> --write
 *
 * Codex/Claude stdio configuration:
 * {
 *   "mcpServers": {
 *     "anchor-read-diagram": {
 *       "command": "node",
 *       "args": ["F:/AnchorOS/6-项目仓库/AnchorRead/mcp/anchor-read-diagram-mcp.mjs"]
 *     }
 *   }
 * }
 */

import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
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
  getDrawingScene,
  listDiagramRevisions,
  restoreDiagramRevision,
} from '../lib/diagram-scene-record.js';
import { createWorkspaceFilePayload, parseWorkspaceFile } from '../lib/workspace-file.js';

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = { name: 'anchor-read-diagram-mcp', version: '1.0.0' };
const SERVER_INSTRUCTIONS = 'Use create_diagram when a visual would materially clarify a concept, process, relationship, or architecture. Live browser mode is the default: keep local AnchorRead open and treat its IndexedDB workspace as the source of truth. Create or edit diagrams directly through these tools; do not introduce .anchorread export/import into the live workflow. Use expectedRevision for edits so concurrent user changes fail instead of being overwritten.';
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
  return {
    content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
  };
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

const BASE_TOOLS = [
  {
    name: 'list_diagrams',
    description: '列出 AnchorRead 工作区中的图解。可按 documentId 筛选。',
    inputSchema: { type: 'object', properties: { documentId: { type: 'string' } }, additionalProperties: false },
  },
  {
    name: 'get_diagram',
    description: '读取图解元数据与完整 Excalidraw scene。',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
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
    name: 'export_excalidraw',
    description: '导出完整标准 .excalidraw JSON 文本，供文件保存或外部 Excalidraw 工具继续编辑。',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
  },
];

const CREATE_TOOL = {
  name: 'create_diagram',
  description: '在已打开的 AnchorRead 浏览器中创建并保存一个新图解，然后切换到该图解。优先传入完整 Excalidraw scene；也可传 Mermaid source。',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: '可选的稳定图解 id；省略时由 AnchorRead 生成。' },
      title: { type: 'string' },
      documentId: { type: 'string' },
      engine: { type: 'string', enum: ['excalidraw', 'mermaid'] },
      scene: {},
      source: { type: 'string' },
      prompt: { type: 'string' },
      scope: { type: 'string' },
      intent: { type: 'string' },
      open: { type: 'boolean', description: '是否在当前 AnchorRead 标签页打开，默认 true。' },
    },
    required: ['title'],
    additionalProperties: false,
  },
};

const WRITE_TOOLS = [
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

const LIVE_READ_TOOLS = BASE_TOOLS.filter((tool) => tool.name !== 'export_excalidraw');
const TOOLS = bridgeUrl
  ? [...LIVE_READ_TOOLS, CREATE_TOOL, ...WRITE_TOOLS]
  : (writeEnabled ? [...BASE_TOOLS, ...WRITE_TOOLS] : BASE_TOOLS);
const WRITE_TOOL_NAMES = new Set(WRITE_TOOLS.map((tool) => tool.name));
let writeQueue = Promise.resolve();

function enqueueWrite(task) {
  const next = writeQueue.then(task);
  writeQueue = next.catch(() => {});
  return next;
}

async function callTool(name, args = {}) {
  if (bridgeUrl) return callBridgeTool(name, args);
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
      return textResult({ ...drawing, scene: getDrawingScene(drawing) });
    }
    case 'describe_diagram':
      return textResult(describeScene(getDrawingScene(getDrawing(payload, args.id)), {
        maxElements: Number.isInteger(args.maxElements) ? args.maxElements : Infinity,
      }));
    case 'query_diagram':
      return textResult(querySceneElements(getDrawingScene(getDrawing(payload, args.id)), args.filters || {}));
    case 'list_diagram_revisions':
      return textResult(listDiagramRevisions(getDrawing(payload, args.id)));
    case 'list_diagram_snapshots':
      return textResult(snapshotSummary(getDrawing(payload, args.id)));
    case 'export_excalidraw':
      return textResult(serializeExcalidrawScene(getDrawingScene(getDrawing(payload, args.id))));
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
      return textResult({ routeId: drawing.routeId, url: `/diagrams/${encodeURIComponent(drawing.routeId)}`, local: true });
    }
    case 'get_canvas_screenshot':
      throw new Error('get_canvas_screenshot requires live browser mode.');
    case 'apply_diagram_patch': {
      const drawing = getDrawing(payload, args.id);
      const currentScene = getDrawingScene(drawing);
      const patchedScene = applyRequestedScenePatch(currentScene, args.patch || {});
      const nextDrawing = commitDiagramScene(drawing, patchedScene, args);
      await writeWorkspace(writeDrawing(payload, nextDrawing));
      return textResult({ id: nextDrawing.id, revision: nextDrawing.revision, scene: nextDrawing.scene });
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

async function callBridgeTool(name, args = {}) {
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
    throw new Error(`无法连接 AnchorRead live bridge ${bridgeUrl}: ${error?.message || error}`);
  }
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error(`AnchorRead live bridge returned non-JSON (${response.status}).`);
  }
  if (!response.ok || !body?.ok) throw new Error(body?.error || `AnchorRead live bridge failed (${response.status}).`);
  const result = body.result;
  return result && Array.isArray(result.content) ? result : textResult(result);
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function handleRequest(request) {
  const { id, method, params } = request;
  try {
    switch (method) {
      case 'initialize':
        return send({
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: SERVER_INFO,
            instructions: SERVER_INSTRUCTIONS,
          },
        });
      case 'tools/list':
        return send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
      case 'tools/call': {
        const result = await (WRITE_TOOL_NAMES.has(params?.name)
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
      return send({
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: String(error?.message || error) }], isError: true },
      });
    }
    return send({ jsonrpc: '2.0', id, error: { code: -32000, message: String(error?.message || error) } });
  }
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
  process.exit(0);
});
