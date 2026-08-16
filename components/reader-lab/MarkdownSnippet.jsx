'use client';

import { useMemo } from 'react';
import { markdownToSafeHtml } from '@/lib/document-content';

/**
 * 知识面板与行间解读卡的小字号 Markdown 渲染器：
 * AI 产出常含表格/列表等 Markdown 语法，纯文本展示会漏出原始符号；
 * 经 markdownToSafeHtml 清洗后渲染，单行纯文本渲染效果与原段落一致。
 */
export default function MarkdownSnippet({ text, className = '' }) {
  const trimmed = typeof text === 'string' ? text.trim() : '';
  const html = useMemo(() => (trimmed ? markdownToSafeHtml(trimmed) : ''), [trimmed]);
  if (!trimmed) return null;
  return (
    <div
      className={`reader-lab-md${className ? ` ${className}` : ''}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
