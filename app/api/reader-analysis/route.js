import { NextResponse } from 'next/server';
import { ApiError, callLLMForJson, resolveLLMConfig } from '@/lib/server-llm';
import { authorizeApiRequest } from '@/lib/api-auth';
import {
  ReaderAnalysisRequestError,
  ReaderAnalysisResponseError,
  buildReaderAnalysisPrompt,
  createReaderAnalysisChunks,
  mergeReaderAnalysisResponses,
  normalizeReaderAnalysisRequest,
  normalizeReaderAnalysisResponse,
} from '@/lib/reader-analysis';
import {
  apiErrorResponse,
  normalizeApiErrorStatus,
  withApiObservability,
} from '@/lib/api-observability';

const ANALYSIS_CHUNK_CONCURRENCY = 3;
const ANALYSIS_CHUNK_RETRIES = 2;

async function mapWithConcurrency(items, worker, limit) {
  const results = new Array(items.length);
  let cursor = 0;
  const consume = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => consume())
  );
  return results;
}

async function analyzeChunk({ config, source, chunk }) {
  let lastError;
  for (let attempt = 0; attempt < ANALYSIS_CHUNK_RETRIES; attempt += 1) {
    try {
      const result = await callLLMForJson(config, [
        { role: 'user', content: buildReaderAnalysisPrompt(source, chunk.blocks, { allowSubset: true }) },
      ]);
      return normalizeReaderAnalysisResponse(result, source, chunk.blocks, {
        allowEmpty: true,
        allowSubset: true,
      });
    } catch (error) {
      lastError = error;
      if (attempt + 1 < ANALYSIS_CHUNK_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
  }
  throw lastError;
}

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
    const chunks = createReaderAnalysisChunks(source);
    const chunkResults = await mapWithConcurrency(
      chunks,
      (chunk) => analyzeChunk({ config, source, chunk }),
      ANALYSIS_CHUNK_CONCURRENCY
    );
    const result = mergeReaderAnalysisResponses(chunkResults, source);

    return NextResponse.json(result);
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
