import { NextResponse } from 'next/server';
import { ApiError, callLLMForJson, resolveLLMConfig } from '@/lib/server-llm';
import {
  ReaderAnalysisRequestError,
  ReaderAnalysisResponseError,
  buildReaderAnalysisPrompt,
  normalizeReaderAnalysisRequest,
  normalizeReaderAnalysisResponse,
} from '@/lib/reader-analysis';

/**
 * POST /api/reader-analysis
 * Input: { title, content, mode?, config? } or x-access-password.
 * Output: grounded anchors and block-bound display + mappings explanations.
 * Missing LLM configuration remains a 400; callers may explicitly use the
 * exported createDemoReaderAnalysis pure function for a labelled local demo.
 */
export async function POST(request) {
  try {
    const { config, body } = await resolveLLMConfig(request);
    const source = normalizeReaderAnalysisRequest(body);
    const result = await callLLMForJson(config, [
      { role: 'user', content: buildReaderAnalysisPrompt(source) },
    ]);

    return NextResponse.json(normalizeReaderAnalysisResponse(result, source));
  } catch (error) {
    console.error('Error analyzing reader document:', error);
    const status =
      error instanceof SyntaxError || error instanceof ReaderAnalysisRequestError
        ? 400
        : error instanceof ReaderAnalysisResponseError
          ? 502
          : error instanceof ApiError
            ? error.status
            : 500;
    return NextResponse.json(
      {
        error: error instanceof SyntaxError
          ? '请求体不是有效的 JSON'
          : error.message || '全文阅读分析失败',
      },
      { status }
    );
  }
}
