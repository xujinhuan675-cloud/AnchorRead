/**
 * Shared MCP contract for the AnchorRead diagram server.
 *
 * Keep the tool schemas transport-independent so STDIO and Streamable HTTP
 * expose the same surface without coupling either transport to the command
 * executor or the browser bridge.
 */

export const DIAGRAM_MCP_PROTOCOL_VERSION = '2024-11-05';
export const DIAGRAM_MCP_SUPPORTED_PROTOCOL_VERSIONS = [
  '2024-11-05',
  '2025-03-26',
  '2025-06-18',
];
export const DIAGRAM_MCP_SERVER_INFO = {
  name: 'anchor-read-diagram-mcp',
  version: '1.1.0',
};
export const DIAGRAM_MCP_INSTRUCTIONS =
  'Use create_diagram when a visual would materially clarify a concept, process, relationship, or architecture. The browser workspace is the source of truth. Create or edit diagrams directly through these tools; do not introduce export/import files into the live workflow. Use expectedRevision for edits so concurrent user changes fail instead of being overwritten.';

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
    name: 'get_presentation',
    description: 'Read the persisted presentation steps for a diagram.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
  },
];

const CREATE_TOOL = {
  name: 'create_diagram',
  description: '在 AnchorRead 浏览器中创建并保存一个新图解，然后可切换到该图解。优先传入完整 Excalidraw scene；也可传 Mermaid source。',
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
      presentation: { type: 'object' },
      open: { type: 'boolean', description: '是否在当前 AnchorRead 标签页打开，默认 true。' },
    },
    required: ['title'],
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
  return [...BASE_TOOLS, ...exportTool, CREATE_TOOL, ...CANVAS_TOOLS, ...WRITE_TOOLS];
}

export const DIAGRAM_MCP_WRITE_TOOL_NAMES = new Set(WRITE_TOOLS.map((tool) => tool.name));
