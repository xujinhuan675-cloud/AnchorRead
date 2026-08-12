/**
 * 服务端 LLM 调用辅助层
 * 统一处理访问密码/客户端配置两种鉴权方式，并提供稳定的 JSON 解析能力
 * 供 /api/parse、/api/concepts、/api/flashcards 等路由复用
 */

import { callLLM } from '@/lib/llm-client';
import { repairJsonClosure } from '@/lib/json-repair';

/**
 * 带状态码的业务错误
 */
export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * 解析请求中的 LLM 配置
 * 优先使用访问密码对应的服务端配置，否则使用客户端传来的配置
 * @param {Request} request - Next.js 请求对象
 * @returns {Promise<{config: Object, body: Object}>} 最终配置与请求体
 */
export async function resolveLLMConfig(request) {
  const body = await request.json();
  const accessPassword = request.headers.get('x-access-password');

  let config = body.config;

  if (accessPassword) {
    const envPassword = process.env.ACCESS_PASSWORD;
    if (!envPassword) {
      throw new ApiError(400, '服务器未配置访问密码');
    }
    if (accessPassword !== envPassword) {
      throw new ApiError(401, '访问密码错误');
    }
    // 使用服务端环境变量中的 LLM 配置
    config = {
      type: process.env.SERVER_LLM_TYPE,
      baseUrl: process.env.SERVER_LLM_BASE_URL,
      apiKey: process.env.SERVER_LLM_API_KEY,
      model: process.env.SERVER_LLM_MODEL,
    };
    if (!config.type || !config.apiKey) {
      throw new ApiError(500, '服务器LLM配置不完整');
    }
  }

  if (!config) {
    throw new ApiError(400, '缺少 LLM 配置');
  }

  return { config, body };
}

/**
 * 从 LLM 输出文本中提取并解析 JSON
 * 依次尝试：去除代码围栏 -> 截取首尾括号区间 -> 原生解析 -> 闭合修复后再解析
 * @param {string} text - LLM 原始输出
 * @returns {Object|Array} 解析后的 JSON 数据
 */
export function extractJson(text) {
  if (!text || typeof text !== 'string') {
    throw new Error('AI 返回内容为空');
  }

  let processed = text.trim();

  // 去除 markdown 代码围栏
  processed = processed.replace(/^```(?:json|javascript|js)?\s*\n?/i, '');
  processed = processed.replace(/\n?```\s*$/, '');
  processed = processed.trim();

  // 截取第一个 { 或 [ 到最后一个 } 或 ] 之间的内容，剔除多余说明文字
  const start = processed.search(/[{[]/);
  const endObj = processed.lastIndexOf('}');
  const endArr = processed.lastIndexOf(']');
  const end = Math.max(endObj, endArr);
  if (start !== -1 && end > start) {
    processed = processed.slice(start, end + 1);
  }

  try {
    return JSON.parse(processed);
  } catch (e) {
    // 兜底：修复常见的 JSON 闭合问题后再尝试
    const repaired = repairJsonClosure(processed);
    try {
      return JSON.parse(repaired);
    } catch (e2) {
      throw new Error('AI 返回的 JSON 无法解析，请重试');
    }
  }
}

/**
 * 调用 LLM 并期望返回 JSON 结果（非流式，等待完整响应）
 * @param {Object} config - LLM 提供商配置
 * @param {Array} messages - 对话消息数组
 * @returns {Promise<Object|Array>} 解析后的 JSON 数据
 */
export async function callLLMForJson(config, messages) {
  const text = await callLLM(config, messages);
  return extractJson(text);
}
