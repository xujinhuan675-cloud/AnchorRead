import { NextResponse } from 'next/server';
import { callLLM } from '@/lib/llm-client';
import { ApiError, resolveLLMConfig } from '@/lib/server-llm';
import { authorizeApiRequest } from '@/lib/api-auth';
import { createCustomAction, renderCustomActionPrompt } from '@/lib/custom-actions';
import { apiErrorResponse, withApiObservability } from '@/lib/api-observability';

/**
 * POST /api/custom-action
 * 自定义动作执行：把选中文本代入用户定义的提示词模板，返回 LLM 原始文本结果
 * 入参：{ config, action: { name, promptTemplate }, selection, context? }
 * 出参：{ result }
 */
async function handlePOST(request) {
  const denied = authorizeApiRequest(request);
  if (denied) return denied;
  try {
    const { config, body } = await resolveLLMConfig(request, 'action');
    const selection = typeof body.selection === 'string' ? body.selection : '';
    const context = typeof body.context === 'string' ? body.context : '';

    let action;
    try {
      action = createCustomAction(body.action || {});
    } catch (error) {
      throw new ApiError(400, error.message);
    }

    let prompt;
    try {
      prompt = renderCustomActionPrompt(action, { selection, context });
    } catch (error) {
      throw new ApiError(400, error.message);
    }

    const result = await callLLM(config, [{ role: 'user', content: prompt }]);
    if (!result || typeof result !== 'string' || !result.trim()) {
      return NextResponse.json({ error: 'AI 未返回有效内容，请重试' }, { status: 502 });
    }

    return NextResponse.json({ result: result.trim() });
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 500;
    return apiErrorResponse({ request, operation: 'ai.custom_action', error, status, message: error.message || '自定义动作执行失败' });
  }
}

export const POST = withApiObservability('ai.custom_action', handlePOST);
