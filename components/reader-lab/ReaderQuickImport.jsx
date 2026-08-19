'use client';

import { useRef, useState } from 'react';
import { ArrowRight, ArrowUpRight, Eraser, FileText, FileUp, LoaderCircle, Sparkles } from 'lucide-react';
import { isEpubFile, parseEpubFile } from '@/lib/epub-import';

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

  const clearAll = () => {
    setTitle('');
    setContent('');
    setFileName('');
    setSelectedFile(null);
    setReadError('');
  };

  const submit = (event) => {
    event.preventDefault();
    if (!content.trim() || busy) return;
    onSubmit({ title, content, file: selectedFile });
  };

  return (
    <div aria-label="快速导入">
      <form onSubmit={submit} className="overflow-hidden border border-stone-200 bg-white shadow-sm dark:border-stone-800 dark:bg-stone-900">
        <input
          type="text"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="文档标题（可选）"
          className="h-12 w-full border-0 border-b border-stone-100 bg-transparent px-5 text-sm font-medium text-stone-900 outline-none placeholder:text-stone-400 dark:border-stone-800 dark:text-stone-100"
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
          className="block min-h-[240px] w-full resize-y border-0 bg-transparent px-5 py-4 text-sm leading-7 text-stone-800 outline-none placeholder:text-stone-400 md:min-h-[280px] dark:text-stone-200"
        />
        <div className="flex flex-col gap-3 border-t border-stone-100 px-4 py-3 sm:flex-row sm:items-center dark:border-stone-800">
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
            className="flex h-9 items-center justify-center gap-2 rounded-md border border-stone-200 bg-white px-3 text-xs font-medium text-stone-600 transition-colors hover:border-stone-400 hover:bg-stone-50 disabled:opacity-50 dark:border-stone-700 dark:bg-transparent dark:text-stone-300 dark:hover:bg-white/10"
          >
            <FileUp size={16} aria-hidden="true" />
            导入 Markdown / TXT / EPUB
          </button>
          <button
            type="button"
            onClick={clearAll}
            disabled={busy || (!title && !content && !fileName)}
            className="flex h-9 items-center justify-center gap-2 rounded-md border border-stone-200 bg-white px-3 text-xs font-medium text-stone-600 transition-colors hover:border-stone-400 hover:bg-stone-50 disabled:opacity-50 dark:border-stone-700 dark:bg-transparent dark:text-stone-300 dark:hover:bg-white/10"
          >
            <Eraser size={16} aria-hidden="true" />
            清空
          </button>
          <span className="min-w-0 truncate text-xs tabular-nums text-stone-400">
            {fileName || (content ? `${content.length.toLocaleString()} 字符` : '等待输入')}
          </span>
          <button
            type="submit"
            disabled={busy || !content.trim()}
            className="flex h-10 items-center justify-center gap-2 rounded-lg bg-stone-950 px-5 text-sm font-medium text-white transition-colors hover:bg-stone-800 disabled:opacity-50 sm:ml-auto dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-white"
          >
            {busy ? <LoaderCircle size={17} className="animate-spin" aria-hidden="true" /> : <Sparkles size={17} aria-hidden="true" />}
            {busy ? '正在解析...' : '解析并进入阅读'}
          </button>
        </div>
        {error || readError ? (
          <p role="alert" className="border-t border-red-100 bg-red-50 px-4 py-3 text-xs text-red-700">{error || readError}</p>
        ) : null}
      </form>

      {recentDocuments.length > 0 ? (
        <section className="mt-10" aria-labelledby="reader-home-recent-title">
          <div className="mb-4 flex items-center justify-between">
            <h3 id="reader-home-recent-title" className="text-lg font-semibold text-stone-950 dark:text-stone-100">
              继续上次阅读
            </h3>
            {/* 文档库入口替换排序说明：最近文档只是库的预览，完整管理进文档库 */}
            {hasExistingDocuments && onOpenExisting ? (
              <button
                type="button"
                onClick={onOpenExisting}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-stone-950 transition hover:text-stone-600 dark:text-stone-100 dark:hover:text-stone-300"
              >
                <span>打开文档库</span>
                <ArrowRight className="size-4" />
              </button>
            ) : (
              <span className="text-xs text-stone-400">按最近更新时间排序</span>
            )}
          </div>
          <div className="grid auto-rows-[108px] gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {recentDocuments.map((doc) => (
              <button
                key={doc.id || doc.title}
                type="button"
                onClick={() => onOpenDocument?.(doc.id)}
                disabled={busy}
                className="group relative flex flex-col justify-center overflow-hidden border border-stone-200 bg-white p-4 text-left transition hover:border-stone-400 disabled:opacity-50 dark:border-stone-800 dark:bg-stone-900 dark:hover:border-stone-600"
              >
                <ArrowUpRight size={16} aria-hidden="true" className="absolute right-3 top-3 text-stone-400 opacity-0 transition group-hover:opacity-100" />
                {/* 图标与标题同行对齐：左上图标贴着标题首行 */}
                <span className="flex items-start gap-2.5">
                  <FileText size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-stone-400 transition group-hover:text-stone-700 dark:group-hover:text-stone-200" />
                  <span className="line-clamp-2 text-sm font-medium leading-6 text-stone-900 dark:text-stone-100">
                    {doc.title}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
