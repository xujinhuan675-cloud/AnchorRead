'use client';

import { useRef, useState } from 'react';
import { Anchor, ChevronRight, Clock3, FileText, FileUp, LoaderCircle, Sparkles, TrendingUp, EyeOff } from 'lucide-react';
import { isEpubFile, parseEpubFile } from '@/lib/epub-import';

const SELLING_POINTS = Object.freeze([
  {
    icon: TrendingUp,
    title: '越用越准确',
    description: '术语与理解记录自动累积，读得越多，它越知道哪些不用解释。',
  },
  {
    icon: Anchor,
    title: '解读贴着原文',
    description: '重点与白话解释逐句锚定原文，随时对照，不怕 AI 编。',
  },
  {
    icon: EyeOff,
    title: '辅助层会退出',
    description: '已掌握的术语渐隐，最终你可以直接读专业原文。',
  },
]);

export default function ReaderQuickImport({
  recentDocuments = [],
  hasExistingDocuments = false,
  busy = false,
  error = '',
  onSubmit,
  onOpenExisting,
  onOpenDocument,
}) {
  const fileInputRef = useRef(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [fileName, setFileName] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [readError, setReadError] = useState('');

  const importFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setFileName(file.name);
    setReadError('');
    try {
      if (isEpubFile(file)) {
        const { title: epubTitle, content: epubContent } = await parseEpubFile(file);
        setContent(epubContent);
        setSelectedFile(file);
        if (!title.trim()) setTitle(epubTitle || file.name.replace(/\.epub$/iu, ''));
        return;
      }
      setContent(await file.text());
      setSelectedFile(file);
      if (!title.trim()) setTitle(file.name.replace(/\.[^.]+$/u, ''));
    } catch (readFailure) {
      setFileName('');
      setSelectedFile(null);
      setReadError(readFailure?.message || '无法读取该文件，请确认它是 UTF-8 编码的 Markdown/TXT 或有效的 EPUB 文件。');
    }
  };

  const submit = (event) => {
    event.preventDefault();
    if (!content.trim() || busy) return;
    onSubmit({ title, content, file: selectedFile });
  };

  return (
    <section className="h-full overflow-auto bg-[#f7f8f8] px-4 py-8 md:px-8 md:py-12" aria-label="快速导入">
      <div className="mx-auto w-full max-w-4xl">
        <div className="text-center">
          <p className="text-xs font-semibold uppercase text-teal-700">Reader Lab</p>
          <h2 className="mt-3 text-3xl font-semibold text-gray-950 md:text-4xl">快速导入一篇文档</h2>
          <p className="mt-3 text-sm text-gray-500">用熟悉的语言读懂陌生的专业知识。先导入并解析，完成后进入统一阅读界面。</p>
        </div>

        <ul className="mt-8 grid gap-3 md:grid-cols-3" aria-label="产品卖点">
          {SELLING_POINTS.map((point) => {
            const Icon = point.icon;
            return (
              <li key={point.title} className="rounded-lg border border-gray-200 bg-white p-4 text-left shadow-sm">
                <div className="flex items-center gap-2 text-teal-700">
                  <Icon size={16} aria-hidden="true" />
                  <span className="text-xs font-semibold text-gray-900">{point.title}</span>
                </div>
                <p className="mt-2 text-xs leading-5 text-gray-500">{point.description}</p>
              </li>
            );
          })}
        </ul>

        <form onSubmit={submit} className="mt-8 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <input
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="文档标题（可选）"
            className="h-12 w-full border-0 border-b border-gray-100 px-5 text-sm font-medium text-gray-900 outline-none placeholder:text-gray-400"
          />
          <textarea
            value={content}
            onChange={(event) => {
              setContent(event.target.value);
              setSelectedFile(null);
              setFileName('');
              setReadError('');
            }}
            placeholder="在这里粘贴 Markdown、TXT 正文或网页链接..."
            className="block min-h-[240px] w-full resize-y border-0 px-5 py-4 text-sm leading-7 text-gray-800 outline-none placeholder:text-gray-400 md:min-h-[280px]"
          />
          <div className="flex flex-col gap-3 border-t border-gray-100 px-4 py-3 sm:flex-row sm:items-center">
            <input
              ref={fileInputRef}
              type="file"
              accept=".md,.markdown,.txt,.epub,text/markdown,text/plain,application/epub+zip"
              onChange={importFile}
              className="sr-only"
              tabIndex={-1}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
              className="flex h-9 items-center justify-center gap-2 rounded border border-gray-200 bg-white px-3 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50"
            >
              <FileUp size={16} aria-hidden="true" />
              导入 Markdown / TXT / EPUB
            </button>
            <span className="min-w-0 truncate text-xs tabular-nums text-gray-400">
              {fileName || (content ? `${content.length.toLocaleString()} 字符` : '等待输入')}
            </span>
            <button
              type="submit"
              disabled={busy || !content.trim()}
              className="flex h-10 items-center justify-center gap-2 rounded bg-gray-900 px-5 text-sm font-medium text-white transition-colors hover:bg-gray-700 disabled:opacity-50 sm:ml-auto"
            >
              {busy ? <LoaderCircle size={17} className="animate-spin" aria-hidden="true" /> : <Sparkles size={17} aria-hidden="true" />}
              {busy ? '正在解析...' : '解析并进入阅读'}
            </button>
          </div>
          {error || readError ? <p role="alert" className="border-t border-red-100 bg-red-50 px-4 py-3 text-xs text-red-700">{error || readError}</p> : null}
        </form>

        {recentDocuments.length > 0 ? (
          <section className="mt-10" aria-labelledby="reader-quick-recent-title">
            <div className="flex items-center justify-between">
              <h3 id="reader-quick-recent-title" className="flex items-center gap-1.5 text-base font-semibold text-gray-900">
                <Clock3 size={16} aria-hidden="true" />
                最近文档
              </h3>
              <div className="flex items-center gap-3">
                {hasExistingDocuments ? (
                  <button
                    type="button"
                    onClick={onOpenExisting}
                    disabled={busy}
                    className="flex items-center gap-1 text-xs font-medium text-teal-700 hover:text-teal-900 disabled:opacity-50"
                  >
                    打开文档库
                    <ChevronRight size={14} aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {recentDocuments.map((doc) => (
                <button
                  key={doc.id || doc.title}
                  type="button"
                  onClick={() => onOpenDocument?.(doc.id)}
                  disabled={busy}
                  className="flex min-h-24 items-start gap-3 rounded-lg border border-gray-200 bg-white p-4 text-left transition-colors hover:border-gray-400 hover:bg-gray-50 disabled:opacity-50"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-gray-100 text-gray-700">
                    <FileText size={18} aria-hidden="true" />
                  </span>
                  <span className="min-w-0 text-sm font-semibold leading-6 text-gray-900">{doc.title}</span>
                </button>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </section>
  );
}
