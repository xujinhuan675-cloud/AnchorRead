/**
 * 浮动工具栏内置动作（解释这段/生成白话/图解）
 * 与自定义动作统一在「浮动工具栏」配置里管理，编辑表单也完全一致（名称/说明/模板）。
 * 执行差异：模板保持系统默认时走结构化锚定链路（解读锚定原文、术语白话附着文档、图解锚定选区）；
 * 模板被用户修改后改按提示词模板执行，结果在弹窗展示。
 */

export const MAX_TOOLBAR_BUILTIN_NAME_LENGTH = 40;

const BUILTIN_TOOLBAR_ACTION_DEFS = Object.freeze([
  {
    id: 'explain',
    name: '解释这段',
    description: '为选区生成解读，锚定到原文下方',
    promptTemplate: '请用通俗易懂的语言解释以下内容，说明其含义与作用：\n\n{{selection}}',
  },
  {
    id: 'term',
    name: '生成白话',
    description: '提取选区术语的白话解释，附着到当前文档',
    promptTemplate: '请提取以下内容中的关键术语，逐个用大白话解释：\n\n{{selection}}',
  },
  {
    id: 'diagram',
    name: '图解',
    description: '将图解锚定到当前选区，生成后插入对应原文下方',
    promptTemplate: '请梳理以下内容的结构与关系，用要点式大纲呈现，便于转成图解：\n\n{{selection}}',
  },
]);

/** 生成一份可修改的默认内置动作列表 */
export function createDefaultToolbarBuiltins() {
  return BUILTIN_TOOLBAR_ACTION_DEFS.map((def) => ({ ...def, enabled: true }));
}

/** 内置动作模板是否仍为系统默认：默认才走结构化锚定链路，改过改按模板执行 */
export function isDefaultToolbarBuiltinTemplate(action) {
  const def = BUILTIN_TOOLBAR_ACTION_DEFS.find((item) => item.id === action?.id);
  return Boolean(def && action?.promptTemplate === def.promptTemplate);
}

/**
 * 将本地持久化的覆盖项合并到默认内置动作上：
 * 仅接受合法改名（非空且未超长）与显式禁用，其余回退默认值
 */
export function mergeToolbarBuiltins(stored) {
  const defaults = createDefaultToolbarBuiltins();
  if (!stored || typeof stored !== 'object') return defaults;
  return defaults.map((def) => {
    const patch = stored[def.id];
    if (!patch || typeof patch !== 'object') return def;
    const name = typeof patch.name === 'string' ? patch.name.trim() : '';
    const validName = name && name.length <= MAX_TOOLBAR_BUILTIN_NAME_LENGTH;
    const description = typeof patch.description === 'string' ? patch.description : def.description;
    const promptTemplate = typeof patch.promptTemplate === 'string' && patch.promptTemplate.trim()
      ? patch.promptTemplate
      : def.promptTemplate;
    return {
      ...def,
      name: validName ? name : def.name,
      description,
      promptTemplate,
      enabled: patch.enabled !== false,
    };
  });
}

/** 把内置动作列表折算为持久化覆盖项（与默认一致的条目不落盘） */
export function toToolbarBuiltinOverrides(builtins) {
  const overrides = {};
  for (const def of BUILTIN_TOOLBAR_ACTION_DEFS) {
    const current = builtins?.find?.((item) => item.id === def.id);
    if (!current) continue;
    const patch = {};
    if (current.name !== def.name) patch.name = current.name;
    if (current.description !== def.description) patch.description = current.description;
    if (current.promptTemplate !== def.promptTemplate) patch.promptTemplate = current.promptTemplate;
    if (current.enabled === false) patch.enabled = false;
    if (current.order != null) patch.order = current.order;
    if (Object.keys(patch).length > 0) overrides[def.id] = patch;
  }
  return overrides;
}
