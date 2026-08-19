import { NextResponse } from 'next/server';
import { resolveLLMConfig, callLLMForJson, ApiError } from '@/lib/server-llm';
import { authorizeApiRequest } from '@/lib/api-auth';
import { buildAskPrompt } from '@/lib/article-prompts';
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
export async function POST(request) {
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
    console.error('Error answering selection question:', error);
    const status =
      error instanceof AskRequestError
        ? 400
        : error instanceof AskResponseError
          ? 502
          : error instanceof ApiError
            ? error.status
            : 500;

    return NextResponse.json(
      { error: error.message || '划词提问失败' },
      { status }
    );
  }
}
