'use client';

import { useEffect, useRef, useState } from 'react';
import { ClipboardPaste, Globe, LoaderCircle, X } from 'lucide-react';

const MODES = Object.freeze([
  { id: 'paste', label: '粘贴正文' },
  { id: 'url', label: '从网址导入' },
]);

export default function DocumentImportDialog({ open, onClose, onCreateDocument }) {
  const [mode, setMode] = useState('paste');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const titleInputRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    titleInputRef.current?.focus();
    const handleEscape = (event) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [busy, onClose, open]);

  if (!open) return null;

  const submitUrl = async () => {
    const normalizedUrl = url.trim();
    if (!normalizedUrl) {
      setError('请输入网页地址。');
      return;
    }

    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/import-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: normalizedUrl }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.content) {
        throw new Error(payload.error || '网页正文抽取失败，请稍后重试。');
      }
      await onCreateDocument({
        title: title.trim() || payload.title || '',
        content: payload.content,
        sourceType: 'url',
        sourceUrl: payload.sourceUrl || normalizedUrl,
      });
      setTitle('');
      setUrl('');
      onClose();
    } catch (submissionError) {
      setError(submissionError?.message || '网页导入失败，请稍后重试。');
    } finally {
      setBusy(false);
    }
  };

  const submitDocument = async (event) => {
    event.preventDefault();
    if (busy) return;

    if (mode === 'url') {
      await submitUrl();
      return;
    }

    const normalizedContent = content.trim();
    if (!normalizedContent) {
      setError('请先粘贴 Markdown 或纯文本内容。');
      return;
    }

    setBusy(true);
    setError('');
    try {
      await onCreateDocument({
        title: title.trim(),
        content: normalizedContent,
        sourceType: 'pasted',
      });
      setTitle('');
      setContent('');
      onClose();
    } catch (submissionError) {
      setError(submissionError?.message || '导入失败，请稍后重试。');
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = mode === 'url' ? url.trim().length > 0 : content.trim().length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/40 p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="reader-paste-title"
        className="flex max-h-[min(680px,calc(100dvh-2rem))] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-stone-200 dark:border-stone-800 bg-white shadow-2xl"
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-stone-200 dark:border-stone-800 px-5 py-4">
          <div className="min-w-0">
            <h2 id="reader-paste-title" className="flex items-center gap-2 text-base font-semibold text-stone-950 dark:text-stone-100">
              <ClipboardPaste size={18} className="text-stone-950 dark:text-stone-100" aria-hidden="true" />
              导入新文档
            </h2>
            <p className="mt-1 text-xs leading-5 text-stone-500">粘贴 Markdown/纯文本，或从网页网址抽取正文。</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            title="关闭"
            aria-label="关闭导入文档对话框"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-stone-400 outline-none hover:bg-stone-100 dark:bg-white/10 hover:text-stone-700 dark:text-stone-300 focus-visible:ring-2 focus-visible:ring-stone-950 dark:ring-stone-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X size={17} aria-hidden="true" />
          </button>
        </header>

        <form onSubmit={submitDocument} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
            <div className="flex gap-1 rounded-lg bg-stone-100 dark:bg-white/10 p-1" role="tablist" aria-label="导入方式">
              {MODES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={mode === item.id}
                  onClick={() => {
                    setMode(item.id);
                    setError('');
                  }}
                  disabled={busy}
                  className={`flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-stone-950 dark:ring-stone-100 disabled:opacity-50 ${mode === item.id ? 'bg-white text-stone-950 dark:text-stone-100 shadow-sm' : 'text-stone-500 hover:text-stone-800 dark:text-stone-200'}`}
                >
                  {item.id === 'url' ? <Globe size={14} aria-hidden="true" /> : <ClipboardPaste size={14} aria-hidden="true" />}
                  {item.label}
                </button>
              ))}
            </div>

            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-stone-700 dark:text-stone-300">标题（可选）</span>
              <input
                ref={titleInputRef}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                disabled={busy}
                placeholder="例如：如何建立可靠的知识系统"
                className="h-10 w-full rounded border border-stone-300 dark:border-stone-700 px-3 text-sm text-stone-950 dark:text-stone-100 outline-none placeholder:text-stone-400 focus:border-stone-950 dark:border-stone-100 focus:ring-1 focus:ring-stone-950 dark:focus:ring-stone-100 disabled:bg-stone-100 dark:bg-white/10"
              />
            </label>

            {mode === 'url' ? (
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-stone-700 dark:text-stone-300">网页地址</span>
                <input
                  type="url"
                  value={url}
                  onChange={(event) => {
                    setUrl(event.target.value);
                    if (error) setError('');
                  }}
                  disabled={busy}
                  placeholder="https://example.com/article"
                  className="h-10 w-full rounded border border-stone-300 dark:border-stone-700 px-3 text-sm text-stone-950 dark:text-stone-100 outline-none placeholder:text-stone-400 focus:border-stone-950 dark:border-stone-100 focus:ring-1 focus:ring-stone-950 dark:focus:ring-stone-100 disabled:bg-stone-100 dark:bg-white/10"
                />
                <span className="mt-1.5 block text-[11px] leading-4 text-stone-400">
                  服务端会抓取网页并用 Readability 抽取正文，转为 Markdown 后仅保存在你的浏览器本地。
                </span>
              </label>
            ) : (
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-stone-700 dark:text-stone-300">正文</span>
                <textarea
                  value={content}
                  onChange={(event) => {
                    setContent(event.target.value);
                    if (error) setError('');
                  }}
                  disabled={busy}
                  required
                  rows={14}
                  placeholder="在这里粘贴 Markdown 或纯文本内容..."
                  className="min-h-64 w-full resize-y rounded border border-stone-300 dark:border-stone-700 px-3 py-2.5 font-mono text-sm leading-6 text-stone-950 dark:text-stone-100 outline-none placeholder:font-sans placeholder:text-stone-400 focus:border-stone-950 dark:border-stone-100 focus:ring-1 focus:ring-stone-950 dark:focus:ring-stone-100 disabled:bg-stone-100 dark:bg-white/10"
                />
              </label>
            )}
            {error ? <p role="alert" className="text-xs text-red-700">{error}</p> : null}
          </div>

          <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-white/5 px-5 py-3">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="h-9 rounded border border-stone-300 dark:border-stone-700 bg-white px-3 text-xs font-medium text-stone-700 dark:text-stone-300 outline-none hover:bg-stone-100 dark:bg-white/10 focus-visible:ring-2 focus-visible:ring-stone-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={busy || !canSubmit}
              className="flex h-9 min-w-24 items-center justify-center gap-2 rounded bg-stone-950 dark:bg-stone-100 px-3 text-xs font-medium text-white outline-none hover:bg-stone-800 dark:hover:bg-stone-300 focus-visible:ring-2 focus-visible:ring-stone-950 dark:ring-stone-100 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-stone-300 dark:bg-white/20"
            >
              {busy ? <LoaderCircle size={15} className="animate-spin" aria-hidden="true" /> : mode === 'url' ? <Globe size={15} aria-hidden="true" /> : <ClipboardPaste size={15} aria-hidden="true" />}
              {busy ? (mode === 'url' ? '正在抓取网页' : '正在导入') : '导入文档'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
