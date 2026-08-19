'use client';

import { useRef, useState } from 'react';
import {
  ClipboardPaste,
  Clock3,
  FileText,
  FileUp,
  List,
  LoaderCircle,
  Plus,
  Search,
  Sparkles,
} from 'lucide-react';
import DocumentImportDialog from '@/components/reader-lab/DocumentImportDialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip } from '@/components/ui/tooltip';

function formatUpdatedAt(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '刚刚';
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function DocumentRow({ document, current, session, onSelect }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(document.id)}
      aria-current={current ? 'page' : undefined}
      className={`w-full border-l-2 px-3 py-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-stone-950 dark:ring-stone-100 ${current ? 'border-stone-950 dark:border-stone-100 bg-stone-100 dark:bg-white/10' : 'border-transparent hover:bg-stone-100 dark:bg-white/10'}`}
    >
      <div className="flex items-start gap-2.5">
        <FileText size={16} className={`mt-0.5 shrink-0 ${current ? 'text-stone-950 dark:text-stone-100' : 'text-stone-400'}`} />
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 break-words text-sm font-medium leading-5 text-stone-900 dark:text-stone-100">
            {document.title}
          </p>
          <p className="mt-1.5 truncate text-[11px] text-stone-500">
            {formatUpdatedAt(session?.updatedAt || document.updatedAt)}
          </p>
        </div>
      </div>
    </button>
  );
}

export default function DocumentLibrary({
  documents,
  outlineOpen = false,
  onToggleOutline = null,
  outlineHidden = false,
  currentDocumentId,
  sessions,
  query,
  onQueryChange,
  onSelect,
  onImportFile,
  onCreateDocument,
  onAnalyzeDocument,
  analysisBusy = false,
  analysisDisabled = false,
}) {
  const fileInputRef = useRef(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [importError, setImportError] = useState('');
  const normalizedQuery = query.trim().toLocaleLowerCase('zh-CN');
  const filtered = documents.filter((document) =>
    !normalizedQuery || document.title.toLocaleLowerCase('zh-CN').includes(normalizedQuery)
  );
  const recent = [...filtered]
    .sort((left, right) =>
      (sessions[right.id]?.updatedAt || right.updatedAt) -
      (sessions[left.id]?.updatedAt || left.updatedAt)
    )
    .slice(0, 2);

  const importFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !onImportFile) return;

    setImportBusy(true);
    setImportError('');
    try {
      await onImportFile(file);
    } catch (error) {
      setImportError(error?.message || '文件导入失败，请检查格式后重试。');
    } finally {
      setImportBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#f5f7f6]">
      <header className="shrink-0 border-b border-stone-200 dark:border-stone-800 px-4 pb-3 pt-4">
        <div className="flex items-center justify-between gap-3 pr-8 lg:pr-0">
          {/* 全局顶栏已承担品牌与回首页职责：库头部只留面板标题 */}
          <div className="min-w-0">
            <p className="text-sm font-semibold text-stone-950 dark:text-stone-100">文档库</p>
          </div>
          {/* 添加文档收纳到头部行：导入与粘贴两项通过下拉展开 */}
          <div className="relative shrink-0">
            <Tooltip content="添加文档">
              <button
                type="button"
                onClick={() => setAddOpen((open) => !open)}
                aria-label="添加文档"
                className="flex h-8 w-8 items-center justify-center rounded border border-stone-200 dark:border-stone-800 bg-white text-stone-500 outline-none hover:text-stone-900 dark:text-stone-100 focus-visible:ring-2 focus-visible:ring-stone-400"
              >
                {importBusy ? <LoaderCircle size={15} className="animate-spin" aria-hidden="true" /> : <Plus size={15} aria-hidden="true" />}
              </button>
            </Tooltip>
            {addOpen && !importBusy && (
              <>
                <div className="fixed inset-0 z-40" aria-hidden="true" onClick={() => setAddOpen(false)} />
                <div className="absolute right-0 top-9 z-50 w-36 rounded-md border border-zinc-200 bg-white p-1.5 shadow-lg">
                  <button
                    type="button"
                    onClick={() => { setAddOpen(false); fileInputRef.current?.click(); }}
                    disabled={!onImportFile}
                    className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs text-stone-700 dark:text-stone-300 outline-none hover:bg-stone-50 dark:bg-white/5 focus-visible:ring-2 focus-visible:ring-stone-400 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <FileUp size={14} className="shrink-0" />
                    导入文件
                  </button>
                  <button
                    type="button"
                    onClick={() => { setAddOpen(false); setPasteOpen(true); }}
                    disabled={!onCreateDocument}
                    className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs text-stone-700 dark:text-stone-300 outline-none hover:bg-stone-50 dark:bg-white/5 focus-visible:ring-2 focus-visible:ring-stone-400 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <ClipboardPaste size={14} className="shrink-0" />
                    粘贴文本
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".md,.markdown,.txt,.epub,text/markdown,text/plain,application/epub+zip"
          onChange={importFile}
          className="sr-only"
          tabIndex={-1}
        />
        {importError ? <p role="alert" className="mt-2 text-xs leading-5 text-red-700">{importError}</p> : null}
        {/* 头部行重排：搜索与目录优先，一键生成沉底作为收尾动作 */}
        <div className="mt-3 flex items-center gap-2">
          <label className="relative flex-1">
            <span className="sr-only">搜索文档</span>
            <Search size={15} className="pointer-events-none absolute left-3 top-2.5 text-stone-400" />
            <input
              type="search"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="搜索文档"
              className="h-9 w-full rounded border border-stone-200 dark:border-stone-800 bg-white pl-9 pr-3 text-xs text-stone-900 dark:text-stone-100 outline-none placeholder:text-stone-400 focus:border-stone-950 dark:border-stone-100 focus:ring-1 focus:ring-stone-950 dark:focus:ring-stone-100"
            />
          </label>
          {/* 目录开关收进文档库：与搜索并列，顶栏不再留按钮；图解画布下不展示 */}
          {onToggleOutline && !outlineHidden && (
            <Tooltip content={outlineOpen ? '收起目录' : '打开目录'}>
              <button
                type="button"
                onClick={onToggleOutline}
                aria-pressed={outlineOpen}
                aria-label={outlineOpen ? '收起目录' : '打开目录'}
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded border outline-none focus-visible:ring-2 focus-visible:ring-stone-400 ${outlineOpen ? 'border-stone-300 dark:border-stone-700 bg-white text-stone-900 dark:text-stone-100 shadow-sm' : 'border-stone-200 dark:border-stone-800 text-stone-600 dark:text-stone-400 hover:bg-stone-50 dark:bg-white/5'}`}
              >
                <List size={15} aria-hidden="true" />
              </button>
            </Tooltip>
          )}
        </div>
        <button
          type="button"
          onClick={onAnalyzeDocument}
          disabled={!onAnalyzeDocument || analysisBusy || analysisDisabled || !currentDocumentId}
          className="mt-3 flex h-9 w-full items-center justify-center gap-2 rounded bg-stone-950 dark:bg-stone-100 px-3 text-xs font-medium text-white outline-none hover:bg-stone-800 dark:hover:bg-stone-300 focus-visible:ring-2 focus-visible:ring-stone-950 dark:ring-stone-100 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-stone-300 dark:bg-white/20"
          title="一键生成图解、重点、解读、白话与闪卡"
        >
          {analysisBusy ? <LoaderCircle size={15} className="animate-spin" aria-hidden="true" /> : <Sparkles size={15} aria-hidden="true" />}
          {analysisBusy ? '生成中…' : '一键生成'}
        </button>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div className="py-3">
          <section aria-labelledby="reader-recent-title">
            <h2 id="reader-recent-title" className="flex items-center gap-1.5 px-4 py-2 text-[11px] font-semibold text-stone-500">
              <Clock3 size={13} aria-hidden="true" />
              最近阅读
            </h2>
            {recent.map((document) => (
              <DocumentRow
                key={`recent-${document.id}`}
                document={document}
                current={document.id === currentDocumentId}
                session={sessions[document.id]}
                onSelect={onSelect}
              />
            ))}
          </section>

          <section className="mt-4" aria-labelledby="reader-all-title">
            <div className="flex items-center justify-between px-4 py-2">
              <h2 id="reader-all-title" className="text-[11px] font-semibold text-stone-500">全部文档</h2>
              <span className="text-[10px] tabular-nums text-stone-400">{filtered.length}</span>
            </div>
            {filtered.length > 0 ? filtered.map((document) => (
              <DocumentRow
                key={document.id}
                document={document}
                current={document.id === currentDocumentId}
                session={sessions[document.id]}
                onSelect={onSelect}
              />
            )) : (
              <p className="px-4 py-8 text-center text-xs text-stone-500">没有匹配的文档</p>
            )}
          </section>
        </div>
      </ScrollArea>
      <DocumentImportDialog
        open={pasteOpen}
        onClose={() => setPasteOpen(false)}
        onCreateDocument={onCreateDocument}
      />
    </div>
  );
}
