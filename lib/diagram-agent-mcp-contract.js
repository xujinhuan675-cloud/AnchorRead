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
  version: '1.3.0',
};
export const DIAGRAM_MCP_INSTRUCTIONS =
  'Use create_view for a pure in-chat editable Excalidraw canvas; it accepts the official elements JSON string and does not require a browser. Element array order is drawing and playback order. For flow diagrams, interleave labeled shapes and arrows in reading order (shape -> arrow -> shape), and put node text in shape.label instead of a separate text element. Use create_diagram when a diagram should also be persisted in the AnchorRead browser workspace. Contentful Mermaid or Excalidraw diagrams automatically receive playback steps and start playback when opened; stream is optional and only adds pseudo-element/camera timeline input. Set open=true for that persisted workflow unless the user asks for a link only. If the browser is unavailable but create_diagram includes scene/elements/source, the MCP App renders the supplied content directly in chat; only content-free requests need open_diagram_workspace_then_retry. For incremental edits, pass the AnchorRead diagram id as id and the target element id as elementId; use create_element/update_element/delete_element/query_elements/get_element and expectedRevision. After a successful diagram or workspace tool returns a resource_link, an AI client with browser or open-URL capability should open that URI; clients without that capability should show the link and say that the user can open it. Use expectedRevision for edits so concurrent user changes fail instead of being overwritten.';
export const DIAGRAM_MCP_READ_ME =
  'Use create_view with a JSON string containing Excalidraw raw elements for a pure in-chat canvas. Element array order is drawing and playback order. For a flow diagram, emit each node as one shape with label, then its outgoing arrow, then the next labeled shape; do not create a separate text element for node text. Standalone text elements are for titles and annotations. Use create_diagram with engine=excalidraw and scene/elements for a persisted editable diagram, or engine=mermaid and source for a Mermaid diagram. For incremental edits, pass the AnchorRead diagram id as id and the target element id as elementId; use create_element/update_element/delete_element/query_elements/get_element and expectedRevision. The app accepts partial element JSON while streaming, ignores cameraUpdate/delete/restoreCheckpoint control items, and renders Mermaid source as SVG. Keep element ids stable.';

const BASE_TOOLS = [
  {
    name: 'read_me',
    description: '返回当前图解 MCP App 的输入格式与渲染约定，兼容官方 Excalidraw MCP Apps 的 read_me 工具。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'open_diagram_workspace',
    description: '返回 AnchorRead 图解工作区的可打开链接。具备浏览器或打开 URL 能力的 AI 客户端应立即打开该链接；不具备该能力的客户端应把链接展示给用户。该工具不要求已有配对浏览器在线。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
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
  description: '创建并保存一个新图解。浏览器在线时写入 AnchorRead 工作区并自动打开；有内容的 Mermaid 或 Excalidraw 图解会自动生成播放步骤并开始播放，无需额外传 stream。浏览器暂时不可用时，只要传入 scene/elements/source，内容仍会直接渲染到当前对话画布。结果同时包含可打开的 resource_link。优先传入完整 Excalidraw scene 或 elements；也可传 Mermaid source。',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: '可选的稳定图解 id；省略时由 AnchorRead 生成。' },
      title: { type: 'string' },
      documentId: { type: 'string' },
      engine: { type: 'string', enum: ['excalidraw', 'mermaid'] },
      elements: { type: 'array', description: 'Excalidraw raw element 数组；可替代 scene。' },
      scene: {},
      source: { type: 'string' },
      prompt: { type: 'string' },
      scope: { type: 'string' },
      intent: { type: 'string' },
      presentation: { type: 'object' },
      stream: { type: 'boolean', description: '兼容性流式输入：支持 cameraUpdate/delete 伪元素；普通有内容的 Excalidraw 图解也会自动生成播放步骤。' },
      open: { type: 'boolean', description: '是否在当前 AnchorRead 标签页打开，默认 true。' },
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
  description: '在当前对话中直接创建可编辑的 Excalidraw 画布。elements 必须是 JSON 数组字符串且数组顺序就是绘制与播放顺序；流程图按“带 label 的节点、箭头、下一个带 label 的节点”交替排列，不要为节点文字另建 text 元素。不依赖浏览器工作区。',
  annotations: { readOnlyHint: true },
  inputSchema: {
    type: 'object',
    properties: {
      elements: { type: 'string', description: 'Excalidraw raw element 数组的 JSON 字符串。数组顺序就是绘制与播放顺序；节点文字应放入 shape.label。' },
    },
    required: ['elements'],
    additionalProperties: false,
  },
};

const CANVAS_TOOLS = [
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

export const DIAGRAM_MCP_WRITE_TOOL_NAMES = new Set(WRITE_TOOLS.map((tool) => tool.name));
