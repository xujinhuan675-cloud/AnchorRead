import { NextResponse } from 'next/server';
import { ApiError, callLLMForJson, resolveLLMConfig } from '@/lib/server-llm';
import { authorizeApiRequest } from '@/lib/api-auth';
import {
  ReaderAnalysisRequestError,
  ReaderAnalysisResponseError,
  buildReaderAnalysisPrompt,
  normalizeReaderAnalysisRequest,
  normalizeReaderAnalysisResponse,
} from '@/lib/reader-analysis';
import {
  apiErrorResponse,
  normalizeApiErrorStatus,
  withApiObservability,
} from '@/lib/api-observability';

/**
 * POST /api/reader-analysis
 * Input: { title, content, mode?, config? } or x-access-password.
 * Output: grounded anchors and block-bound display + mappings explanations.
 * Missing LLM configuration remains a 400; the client surfaces the error
 * and asks the user to configure a model first (no local demo fallback).
 */
async function handlePOST(request) {
  const denied = authorizeApiRequest(request);
  if (denied) return denied;
  try {
    const { config, body } = await resolveLLMConfig(request, 'analysis');
    const source = normalizeReaderAnalysisRequest(body);
    const result = await callLLMForJson(config, [
      { role: 'user', content: buildReaderAnalysisPrompt(source) },
    ]);

    return NextResponse.json(normalizeReaderAnalysisResponse(result, source));
  } catch (error) {
    const status =
      error instanceof SyntaxError || error instanceof ReaderAnalysisRequestError
        ? 400
        : error instanceof ReaderAnalysisResponseError
          ? 502
          : error instanceof ApiError
            ? error.status
            : normalizeApiErrorStatus(error?.status);
    return apiErrorResponse({
      request,
      operation: 'ai.reader_analysis',
      error,
      status,
      message: error instanceof SyntaxError ? '请求体不是有效的 JSON' : error.message || '全文阅读分析失败',
    });
  }
}

export const POST = withApiObservability('ai.reader_analysis', handlePOST);
