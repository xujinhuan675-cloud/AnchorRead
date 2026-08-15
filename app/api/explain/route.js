import { NextResponse } from 'next/server';
import { resolveLLMConfig, callLLMForJson, ApiError } from '@/lib/server-llm';
import { authorizeApiRequest } from '@/lib/api-auth';
import { buildExplainPrompt } from '@/lib/article-prompts';
import {
  ExplainRequestError,
  ExplainResponseError,
  normalizeExplainRequest,
  normalizeExplainResponse,
} from '@/lib/explain-contract';

/**
 * POST /api/explain
 * 入参：{ config, article|articleContext|context, selectedText, glossary }
 * glossary 为用户自维护术语表，作为背景交代给 AI（已有定义的术语不再从零解释）
 * 出参：{ plainExplanation, terms: [{ source, explanation }], context }
 */
export async function POST(request) {
  const denied = authorizeApiRequest(request);
  if (denied) return denied;
  try {
    const { config, body } = await resolveLLMConfig(request, 'explain');
    const source = normalizeExplainRequest(body);
    const messages = [
      {
        role: 'user',
        content: buildExplainPrompt(source.article, source.selectedText, source.glossary),
      },
    ];

    const result = await callLLMForJson(config, messages);
    return NextResponse.json(normalizeExplainResponse(result, source));
  } catch (error) {
    console.error('Error explaining selected text:', error);
    const status =
      error instanceof ExplainRequestError
        ? 400
        : error instanceof ExplainResponseError
          ? 502
          : error instanceof ApiError
            ? error.status
            : 500;

    return NextResponse.json(
      { error: error.message || '原文解释失败' },
      { status }
    );
  }
}
