import { NextResponse } from 'next/server';
import { resolveLLMConfig, callLLMForJson, ApiError } from '@/lib/server-llm';
import { authorizeApiRequest } from '@/lib/api-auth';
import { buildAskPrompt } from '@/lib/article-prompts';
import { apiErrorResponse, withApiObservability } from '@/lib/api-observability';
import {
  AskRequestError,
  AskResponseError,
  normalizeAskRequest,
  normalizeAskResponse,
} from '@/lib/ask-contract';

/**
 * POST /api/ask
 * 入参：{ config, article, selectedText, glossary }
 * 划词提问：内置提问提示词，选区即触发；
 * 出参：{ answer, context, candidates }，candidates 为待用户审阅的候选词条
 */
async function handlePOST(request) {
  const denied = authorizeApiRequest(request);
  if (denied) return denied;
  try {
    const { config, body } = await resolveLLMConfig(request, 'ask');
    const source = normalizeAskRequest(body);
    const messages = [
      {
        role: 'user',
        content: buildAskPrompt(source.article, source.selectedText, source.glossary),
      },
    ];

    const result = await callLLMForJson(config, messages);
    return NextResponse.json(normalizeAskResponse(result, source));
  } catch (error) {
    const status =
      error instanceof AskRequestError
        ? 400
        : error instanceof AskResponseError
          ? 502
          : error instanceof ApiError
            ? error.status
            : 500;

    return apiErrorResponse({ request, operation: 'ai.ask', error, status, message: error.message || '划词提问失败' });
  }
}

export const POST = withApiObservability('ai.ask', handlePOST);
