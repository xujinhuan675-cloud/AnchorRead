import { NextResponse } from 'next/server';
import { resolveLLMConfig, callLLMForJson, ApiError } from '@/lib/server-llm';
import { buildParsePrompt, HIGHLIGHT_LEVELS } from '@/lib/article-prompts';

/**
 * POST /api/parse
 * 文章解析：AI 挑选重点片段并分级高亮
 * 入参：{ config, article }
 * 出参：{ summary, highlights: [{ text, level, reason }] }
 */
export async function POST(request) {
  try {
    const { config, body } = await resolveLLMConfig(request);
    const { article } = body;

    if (!article || typeof article !== 'string' || !article.trim()) {
      return NextResponse.json({ error: '文章内容为空' }, { status: 400 });
    }

    const messages = [
      { role: 'user', content: buildParsePrompt(article.trim()) },
    ];

    const result = await callLLMForJson(config, messages);

    // 校验并过滤 AI 返回的高亮条目
    const highlights = Array.isArray(result.highlights)
      ? result.highlights
          .filter((h) => h && typeof h.text === 'string' && h.text.trim())
          .map((h) => ({
            text: h.text.trim(),
            level: HIGHLIGHT_LEVELS[h.level] ? h.level : 'core',
            reason: typeof h.reason === 'string' ? h.reason : '',
          }))
      : [];

    if (highlights.length === 0) {
      return NextResponse.json(
        { error: 'AI 未返回有效的高亮片段，请重试' },
        { status: 502 }
      );
    }

    return NextResponse.json({
      summary: typeof result.summary === 'string' ? result.summary : '',
      highlights,
    });
  } catch (error) {
    console.error('Error parsing article:', error);
    const status = error instanceof ApiError ? error.status : 500;
    return NextResponse.json(
      { error: error.message || '文章解析失败' },
      { status }
    );
  }
}
