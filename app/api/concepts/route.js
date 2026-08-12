import { NextResponse } from 'next/server';
import { resolveLLMConfig, callLLMForJson, ApiError } from '@/lib/server-llm';
import { buildConceptsPrompt } from '@/lib/article-prompts';

/**
 * POST /api/concepts
 * 概念网络抽取：从文章中提取概念与关系，用于绘制概念图
 * 入参：{ config, article }
 * 出参：{ concepts: [{ name, description }], relations: [{ from, to, type, label }] }
 */
export async function POST(request) {
  try {
    const { config, body } = await resolveLLMConfig(request);
    const { article } = body;

    if (!article || typeof article !== 'string' || !article.trim()) {
      return NextResponse.json({ error: '文章内容为空' }, { status: 400 });
    }

    const messages = [
      { role: 'user', content: buildConceptsPrompt(article.trim()) },
    ];

    const result = await callLLMForJson(config, messages);

    const concepts = Array.isArray(result.concepts)
      ? result.concepts
          .filter((c) => c && typeof c.name === 'string' && c.name.trim())
          .map((c) => ({
            name: c.name.trim(),
            description: typeof c.description === 'string' ? c.description : '',
          }))
      : [];

    if (concepts.length === 0) {
      return NextResponse.json(
        { error: 'AI 未返回有效的概念列表，请重试' },
        { status: 502 }
      );
    }

    // 只保留两端都在概念列表中的关系
    const nameSet = new Set(concepts.map((c) => c.name));
    const relations = Array.isArray(result.relations)
      ? result.relations
          .filter(
            (r) =>
              r &&
              typeof r.from === 'string' &&
              typeof r.to === 'string' &&
              nameSet.has(r.from) &&
              nameSet.has(r.to) &&
              r.from !== r.to
          )
          .map((r) => ({
            from: r.from,
            to: r.to,
            type: typeof r.type === 'string' ? r.type : '相关',
            label:
              typeof r.label === 'string' && r.label.trim()
                ? r.label.trim()
                : typeof r.type === 'string'
                  ? r.type
                  : '相关',
          }))
      : [];

    return NextResponse.json({ concepts, relations });
  } catch (error) {
    console.error('Error extracting concepts:', error);
    const status = error instanceof ApiError ? error.status : 500;
    return NextResponse.json(
      { error: error.message || '概念抽取失败' },
      { status }
    );
  }
}
