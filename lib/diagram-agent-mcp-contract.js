/**
 * Shared MCP contract for the AnchorRead diagram server.
 *
 * Keep the tool schemas transport-independent so STDIO and Streamable HTTP
 * expose the same surface without coupling either transport to the command
 * executor or the browser bridge.
 */

import { DIAGRAM_MCP_APP_RESOURCE_URI } from './diagram-mcp-app-resource.js';

export const DIAGRAM_MCP_PROTOCOL_VERSION = '2024-11-05';
export const DIAGRAM_MCP_SUPPORTED_PROTOCOL_VERSIONS = [
  '2024-11-05',
  '2025-03-26',
  '2025-06-18',
];
export const DIAGRAM_MCP_SERVER_INFO = {
  name: 'anchor-read-diagram',
  title: 'AnchorRead Diagram',
  version: '1.4.1',
};
export const DIAGRAM_MCP_INSTRUCTIONS =
  'Call ensure_workspace_ready at the start of a persisted-diagram workflow, then call read_diagram_guide before creating or substantially editing a diagram. A local stdio companion may open the AnchorRead browser workspace automatically; a remote MCP returns a resource link for the client to open. Plan one flow direction and stable ids, create a coherent batch, then use describe_scene and get_canvas_screenshot to inspect the result. Fix truncation, overlap, cramped spacing, unbound or obstructed connectors, and label collisions; align or distribute repeated elements where useful, then screenshot again. Finish only when the guide checklist passes. Use create_view for a pure in-chat editable Excalidraw canvas; it accepts the official elements JSON string and does not require a browser. Scene element order is render order, while presentation.steps is the authoritative playback order. For every flow connector, provide a stable id, startElementId and endElementId (or Excalidraw start/end bindings), and put the relationship predicate in arrow.label.text instead of a standalone text element. Prefer generating presentation.steps with the diagram: reveal the source node, then the target node if it is not already visible, then the connector and its bound label; do not replay a node that is already visible as a new step. Each step should have a semantic title and cumulative visibleElementIds. When presentation is omitted, default playback infers this same source -> target -> connector order from bindings. Playback is human-paced and keeps a stable overview. Use create_diagram when a diagram should also be persisted in the AnchorRead browser workspace. Contentful Mermaid or Excalidraw diagrams automatically receive playback steps and start playback when opened. For incremental edits, use the AnchorRead diagram id, expectedRevision, and the diagram-scoped element tools so concurrent user changes fail instead of being overwritten.';
export const DIAGRAM_MCP_READ_ME =
  'Start with read_diagram_guide. Use create_view with a JSON string containing Excalidraw raw elements for a pure in-chat canvas, or create_diagram for a persisted AnchorRead diagram. Scene order controls rendering and presentation.steps controls playback. Keep element ids stable; bind every relationship connector with startElementId/endElementId (or native bindings), put node text in shape.label, and put concise relationship text in arrow.label.text. After creation or a substantial edit, call describe_scene and get_canvas_screenshot, fix every checklist issue, and screenshot again. Use align_elements and distribute_elements for repeated geometry. Use expectedRevision for mutations. The app accepts cameraUpdate/delete/restoreCheckpoint pseudo-elements while streaming and renders Mermaid source as SVG.';

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
    description: '返回 AnchorRead 图解工作区的可打开链接。具备浏览器或打开 URL 能力的 AI 客户端应在用户的默认浏览器中打开该链接；不具备该能力的客户端应把链接展示给用户。该工具不要求已有配对浏览器在线。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'verify_browser_connection',
    description: '逐项验证 MCP OAuth、服务器签发的浏览器 bindingId、公开工作区 URL、配对浏览器在线状态、IndexedDB 读取和完整往返；返回 PASS/FAIL 与可执行的 nextAction，不修改图解。',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'ensure_workspace_ready',
    description: 'Prepare the AnchorRead diagram workspace. A local stdio MCP may ask the operating system to open the default browser; a remote MCP returns a resource link for the client to open. Call before creating a persisted diagram.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: { open: { type: 'boolean', description: 'Request local stdio MCP to open the browser. Defaults to true.' } },
      additionalProperties: false,
    },
  },
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
    name: 'describe_scene',
    description: '兼容 mcp_excalidraw 的场景读取入口；返回指定 AnchorRead 图解的元素、位置、标签、连接、分组和边界。修改前和视觉验收前调用。',
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
    description: '按元素类型、文本、分组、锁定状态或区域查询指定图解中的元素；id 始终是图解 id，不使用全局画布。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'AnchorRead 图解 id 或 routeId。' },
        filters: { type: 'object', additionalProperties: true },
        filter: { type: 'object', additionalProperties: true },
        type: { type: 'string' },
        bbox: { type: 'object', additionalProperties: true },
        includeDeleted: { type: 'boolean' },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_element',
    description: '读取指定图解中的单个元素。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'AnchorRead 图解 id 或 routeId。' },
        elementId: { type: 'string' },
        includeDeleted: { type: 'boolean' },
      },
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
];

const CREATE_TOOL = {
  name: 'create_diagram',
  _meta: {
    ui: { resourceUri: DIAGRAM_MCP_APP_RESOURCE_URI },
    'ui/resourceUri': DIAGRAM_MCP_APP_RESOURCE_URI,
  },
  description: '创建并保存一个新图解。只有浏览器完成 IndexedDB 写入并返回 id、routeId 与 revision 后才算成功；浏览器不可用时返回错误并提示打开图解工作区后重试。open=true（默认）只请求 MCP 客户端在用户的默认浏览器中打开已保存图解的返回链接，不会强制当前标签页跳转。有内容的 Mermaid 或 Excalidraw 图解会自动生成播放步骤并开始播放，无需额外传 stream。结果同时包含可打开的 resource_link。优先传入完整 Excalidraw scene 或 elements；也可传 Mermaid source。',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: '可选的稳定图解 id；省略时由 AnchorRead 生成。' },
      title: { type: 'string' },
      documentId: { type: 'string' },
      engine: { type: 'string', enum: ['excalidraw', 'mermaid'] },
      elements: { type: 'array', description: 'Excalidraw raw element 数组；可替代 scene。流程连线应包含稳定 id、startElementId/endElementId（或绑定）以及表示关系谓词的 label.text。' },
      scene: {},
      source: { type: 'string' },
      prompt: { type: 'string' },
      scope: { type: 'string' },
      intent: { type: 'string' },
      presentation: { type: 'object', description: '建议由 AI 随图生成的播放脚本。steps 使用累积 visibleElementIds，按“起点节点 → 终点节点 → 连线及关系文字”编排；已出现节点不重复占步，每步提供语义 title。' },
      stream: { type: 'boolean', description: '兼容性流式输入：支持 cameraUpdate/delete 伪元素；普通有内容的 Excalidraw 图解也会自动生成播放步骤。' },
      open: { type: 'boolean', description: '是否请求客户端在用户的默认浏览器中打开返回链接，默认 true；不会强制当前标签页跳转。' },
    },
    required: ['title'],
    additionalProperties: false,
  },
};

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

const CANVAS_TOOLS = [
  {
    name: 'align_elements',
    description: '按 mcp_excalidraw 语义对齐指定元素，并以 expectedRevision 保护提交。完成后应调用 describe_scene 和 get_canvas_screenshot 复检。',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, elementIds: { type: 'array', items: { type: 'string' }, minItems: 2 }, alignment: { type: 'string', enum: ['left', 'center', 'right', 'top', 'middle', 'bottom'] }, expectedRevision: { type: 'number' }, author: { type: 'string' } }, required: ['id', 'elementIds', 'alignment'], additionalProperties: false },
  },
  {
    name: 'distribute_elements',
    description: '按 mcp_excalidraw 语义在现有跨度内均匀分布至少三个元素，并以 expectedRevision 保护提交。完成后应截图复检。',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, elementIds: { type: 'array', items: { type: 'string' }, minItems: 3 }, direction: { type: 'string', enum: ['horizontal', 'vertical'] }, expectedRevision: { type: 'number' }, author: { type: 'string' } }, required: ['id', 'elementIds', 'direction'], additionalProperties: false },
  },
  {
    name: 'create_from_mermaid',
    description: '将 Mermaid 源作为一个新的 AnchorRead Mermaid 图解保存；适合标准流程图、时序图或 ER 图。创建后必须截图检查自动布局。',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, documentId: { type: 'string' }, mermaidSyntax: { type: 'string' }, mermaidDiagram: { type: 'string', description: 'Upstream mcp_excalidraw alias for Mermaid source.' }, source: { type: 'string' }, config: { type: 'object', additionalProperties: true, description: 'Optional upstream Mermaid configuration; AnchorRead keeps rendering under its strict safe configuration.' }, open: { type: 'boolean' }, prompt: { type: 'string' }, scope: { type: 'string' }, intent: { type: 'string' } }, required: ['title'], anyOf: [{ required: ['mermaidSyntax'] }, { required: ['mermaidDiagram'] }, { required: ['source'] }], additionalProperties: false },
  },
  {
    name: 'group_elements',
    description: '将多个元素加入同一个 Excalidraw 分组。',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, elementIds: { type: 'array', items: { type: 'string' }, minItems: 2 }, groupId: { type: 'string' }, expectedRevision: { type: 'number' }, author: { type: 'string' } }, required: ['id', 'elementIds'], additionalProperties: false },
  },
  {
    name: 'ungroup_elements',
    description: '移除指定 groupId，或移除指定元素上的分组。',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, elementIds: { type: 'array', items: { type: 'string' } }, groupId: { type: 'string' }, expectedRevision: { type: 'number' }, author: { type: 'string' } }, required: ['id'], additionalProperties: false },
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
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, elementIds: { type: 'array', items: { type: 'string' }, minItems: 1 }, offsetX: { type: 'number' }, offsetY: { type: 'number' }, expectedRevision: { type: 'number' } }, required: ['id', 'elementIds'], additionalProperties: false },
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
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, scrollToContent: { type: 'boolean' }, scrollToElementIds: { type: 'array', items: { type: 'string' } }, scrollToElementId: { type: 'string' }, viewportZoomFactor: { type: 'number' }, zoom: { type: 'number' }, scrollX: { type: 'number' }, scrollY: { type: 'number' }, expectedRevision: { type: 'number' } }, required: ['id'], additionalProperties: false },
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
];

const WRITE_TOOLS = [
  {
    name: 'create_element',
    description: '在指定 AnchorRead 图解中增量创建一个 Excalidraw 元素；每次提交产生新的 revision。element.id 可选，省略时自动生成稳定 id。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'AnchorRead 图解 id 或 routeId，不是元素 id。' },
        elementId: { type: 'string', description: '可选的元素 id；也可放在 element.id 中。' },
        element: { type: 'object', additionalProperties: true },
        expectedRevision: { type: 'number' },
        author: { type: 'string' },
        reason: { type: 'string' },
      },
      required: ['id', 'element'],
      additionalProperties: false,
    },
  },
  {
    name: 'batch_create_elements',
    description: '在指定 AnchorRead 图解中原子地增量创建多个 Excalidraw 元素。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'AnchorRead 图解 id 或 routeId。' },
        elements: { type: 'array', items: { type: 'object', additionalProperties: true }, minItems: 1 },
        expectedRevision: { type: 'number' },
        author: { type: 'string' },
        reason: { type: 'string' },
      },
      required: ['id', 'elements'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_element',
    description: '按 elementId 增量更新指定 AnchorRead 图解中的一个元素，不覆盖其它元素。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'AnchorRead 图解 id 或 routeId。' },
        elementId: { type: 'string' },
        changes: { type: 'object', additionalProperties: true },
        expectedRevision: { type: 'number' },
        author: { type: 'string' },
        reason: { type: 'string' },
      },
      required: ['id', 'elementId', 'changes'],
      additionalProperties: false,
    },
  },
  {
    name: 'delete_element',
    description: '按 elementId 删除指定 AnchorRead 图解中的元素；默认保留 Excalidraw 软删除记录，hardDelete=true 才物理移除。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'AnchorRead 图解 id 或 routeId。' },
        elementId: { type: 'string' },
        hardDelete: { type: 'boolean' },
        expectedRevision: { type: 'number' },
        author: { type: 'string' },
        reason: { type: 'string' },
      },
      required: ['id', 'elementId'],
      additionalProperties: false,
    },
  },
  {
    name: 'clear_canvas',
    description: '清空指定 AnchorRead 图解中的全部活动元素；默认使用 Excalidraw 软删除。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'AnchorRead 图解 id 或 routeId。' },
        hardDelete: { type: 'boolean' },
        expectedRevision: { type: 'number' },
        author: { type: 'string' },
        reason: { type: 'string' },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_presentation',
    description: 'Persist presentation steps without creating a scene revision.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, presentation: { type: 'object' } },
      required: ['id', 'presentation'],
      additionalProperties: false,
    },
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

export function getDiagramMcpTools({ includeExport = false } = {}) {
  const exportTool = includeExport ? [{
    name: 'export_excalidraw',
    description: '导出完整标准 .excalidraw JSON 文本，供文件保存或外部 Excalidraw 工具继续编辑。',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
  }] : [];
  return [...BASE_TOOLS, ...exportTool, CREATE_VIEW_TOOL, CREATE_TOOL, ...CANVAS_TOOLS, ...WRITE_TOOLS];
}

export const DIAGRAM_MCP_WRITE_TOOL_NAMES = new Set([
  ...WRITE_TOOLS.map((tool) => tool.name),
  ...CANVAS_TOOLS.filter((tool) => !['get_canvas_screenshot', 'share_diagram'].includes(tool.name)).map((tool) => tool.name),
]);
