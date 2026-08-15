/**
 * 按任务路由模型
 * 配置中的 taskModels 允许为不同任务指定不同模型：
 * - 字符串：仅覆盖当前配置的 model（同一提供商下用便宜/强模型分工）
 *   { taskModels: { parse: "gpt-4o-mini", explain: "gpt-4o" } }
 * - 对象：完整覆盖提供商配置（跨提供商路由）
 *   { taskModels: { flashcards: { type: "ollama", model: "llama3.1" } } }
 *
 * 支持的任务名：parse / explain / concepts / flashcards / analysis / action
 */

export const TASK_MODEL_KEYS = Object.freeze([
  'parse',
  'explain',
  'concepts',
  'flashcards',
  'analysis',
  'action',
]);

/**
 * 根据任务名解析最终 LLM 配置
 * @param {Object} config - 基础 LLM 配置
 * @param {string} task - 任务名（TASK_MODEL_KEYS 之一）
 * @returns {Object} 应用任务覆盖后的配置
 */
export function resolveTaskConfig(config, task) {
  if (!config || !task) return config;

  const override = config.taskModels?.[task];
  if (!override) return config;

  if (typeof override === 'string' && override.trim()) {
    return { ...config, model: override.trim() };
  }

  if (override && typeof override === 'object') {
    const merged = {
      ...config,
      ...(override.type ? { type: override.type } : {}),
      ...(override.baseUrl ? { baseUrl: override.baseUrl } : {}),
      ...(override.apiKey ? { apiKey: override.apiKey } : {}),
      ...(override.model ? { model: override.model } : {}),
    };
    // taskModels 不再向下传递，避免嵌套解析
    delete merged.taskModels;
    return merged;
  }

  return config;
}
