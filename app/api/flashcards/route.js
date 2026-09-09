import { NextResponse } from 'next/server';
import { resolveLLMConfig, callLLMForJson, ApiError } from '@/lib/server-llm';
import { authorizeApiRequest } from '@/lib/api-auth';
import { buildFlashcardsPrompt } from '@/lib/article-prompts';
import { apiErrorResponse, withApiObservability } from '@/lib/api-observability';

/**
 * POST /api/flashcards
 * 记忆卡片生成：基于文章与重点高亮制作闪卡
 * 入参：{ config, article, highlights? }
 * 出参：{ cards: [{ front, back, source }] }
 */
async function handlePOST(request) {
  const denied = authorizeApiRequest(request);
  if (denied) return denied;
  try {
    const { config, body } = await resolveLLMConfig(request, 'flashcards');
    const { article, highlights } = body;

    if (!article || typeof article !== 'string' || !article.trim()) {
      return NextResponse.json({ error: '文章内容为空' }, { status: 400 });
    }

    const messages = [
      {
        role: 'user',
        content: buildFlashcardsPrompt(
          article.trim(),
          Array.isArray(highlights) ? highlights : []
        ),
      },
    ];

    const result = await callLLMForJson(config, messages);

    const cards = Array.isArray(result.cards)
      ? result.cards
          .filter(
            (c) =>
              c &&
              typeof c.front === 'string' &&
              c.front.trim() &&
              typeof c.back === 'string' &&
              c.back.trim()
          )
          .map((c) => ({
            front: c.front.trim(),
            back: c.back.trim(),
            source: typeof c.source === 'string' ? c.source.trim() : '',
          }))
      : [];

    if (cards.length === 0) {
      return NextResponse.json(
        { error: 'AI 未返回有效的记忆卡片，请重试' },
        { status: 502 }
      );
    }

    return NextResponse.json({ cards });
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 500;
    return apiErrorResponse({ request, operation: 'ai.flashcards', error, status, message: error.message || '记忆卡片生成失败' });
  }
}

export const POST = withApiObservability('ai.flashcards', handlePOST);
