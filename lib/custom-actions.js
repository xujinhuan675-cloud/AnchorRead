/**
 * 自定义动作（选区派生内容扩展点）
 * 用户可定义"对选中文本执行一段提示词模板"的动作，
 * 模板中 {{selection}} 会被替换为选中文本，{{context}} 为可选上下文。
 */

export const CUSTOM_ACTION_SELECTION_PLACEHOLDER = '{{selection}}';
export const CUSTOM_ACTION_CONTEXT_PLACEHOLDER = '{{context}}';
export const MAX_CUSTOM_ACTION_NAME_LENGTH = 40;
export const MAX_CUSTOM_ACTION_TEMPLATE_LENGTH = 4000;

export class CustomActionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CustomActionError';
  }
}

function defaultGenerateId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * 创建/规范化一个自定义动作
 * @param {{name: string, promptTemplate: string, description?: string, enabled?: boolean}} input
 */
export function createCustomAction(input = {}, { now = Date.now(), generateId = defaultGenerateId } = {}) {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const promptTemplate = typeof input.promptTemplate === 'string' ? input.promptTemplate.trim() : '';

  if (!name) throw new CustomActionError('动作名称不能为空。');
  if (name.length > MAX_CUSTOM_ACTION_NAME_LENGTH) {
    throw new CustomActionError(`动作名称不能超过 ${MAX_CUSTOM_ACTION_NAME_LENGTH} 个字符。`);
  }
  if (!promptTemplate) throw new CustomActionError('提示词模板不能为空。');
  if (promptTemplate.length > MAX_CUSTOM_ACTION_TEMPLATE_LENGTH) {
    throw new CustomActionError(`提示词模板不能超过 ${MAX_CUSTOM_ACTION_TEMPLATE_LENGTH} 个字符。`);
  }
  if (!promptTemplate.includes(CUSTOM_ACTION_SELECTION_PLACEHOLDER)) {
    throw new CustomActionError(`提示词模板必须包含 ${CUSTOM_ACTION_SELECTION_PLACEHOLDER} 占位符，用于插入选中文本。`);
  }

  return {
    id: typeof input.id === 'string' && input.id.trim() ? input.id.trim() : generateId(),
    name,
    description: typeof input.description === 'string' ? input.description.trim() : '',
    promptTemplate,
    enabled: input.enabled !== false,
    createdAt: Number.isFinite(input.createdAt) ? input.createdAt : now,
    updatedAt: now,
  };
}

/**
 * 渲染动作提示词：替换 {{selection}} / {{context}}
 */
export function renderCustomActionPrompt(action, { selection = '', context = '' } = {}) {
  if (!action || typeof action.promptTemplate !== 'string') {
    throw new CustomActionError('无效的自定义动作。');
  }
  const selectedText = String(selection).trim();
  if (!selectedText) throw new CustomActionError('选中文本为空，无法执行动作。');
  return action.promptTemplate
    .split(CUSTOM_ACTION_SELECTION_PLACEHOLDER).join(selectedText)
    .split(CUSTOM_ACTION_CONTEXT_PLACEHOLDER).join(String(context).trim());
}

/** 过滤出合法动作列表（用于工作区导入等外部数据） */
export function normalizeCustomActions(list) {
  if (!Array.isArray(list)) return [];
  return list.flatMap((item) => {
    try {
      return [createCustomAction(item)];
    } catch {
      return [];
    }
  });
}
