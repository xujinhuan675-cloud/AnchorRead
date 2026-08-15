'use client';

import { useRef, useState } from 'react';
import {
  ClipboardPaste,
  Clock3,
  Cloud,
  Download,
  FileText,
  FileUp,
  GraduationCap,
  LoaderCircle,
  NotebookText,
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
  const progress = Math.min(100, Math.max(0, session?.progress || 0));
  return (
    <button
      type="button"
      onClick={() => onSelect(document.id)}
      aria-current={current ? 'page' : undefined}
      className={`w-full border-l-2 px-3 py-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-600 ${current ? 'border-teal-700 bg-teal-50' : 'border-transparent hover:bg-gray-100'}`}
    >
      <div className="flex items-start gap-2.5">
        <FileText size={16} className={`mt-0.5 shrink-0 ${current ? 'text-teal-700' : 'text-gray-400'}`} />
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 break-words text-sm font-medium leading-5 text-gray-900">
            {document.title}
          </p>
          <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-gray-500">
            <span>{progress}%</span>
            <span className="truncate">{formatUpdatedAt(session?.updatedAt || document.updatedAt)}</span>
          </div>
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-gray-200">
            <span className="block h-full rounded-full bg-teal-600" style={{ width: `${progress}%` }} />
          </div>
        </div>
      </div>
    </button>
  );
}

export default function DocumentLibrary({
  documents,
  currentDocumentId,
  sessions,
  query,
  onQueryChange,
  onSelect,
  onExport,
  onExportAnki,
  onExportObsidian,
  onOpenSync,
  onImportFile,
  onCreateDocument,
  onAnalyzeDocument,
  analysisBusy = false,
  analysisDisabled = false,
}) {
  const fileInputRef = useRef(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
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
    <div className="flex h-full min-h-0 flex-col bg-[#f7f8f8]">
      <header className="shrink-0 border-b border-gray-200 px-4 pb-3 pt-4">
        <div className="flex items-center justify-between gap-3 pr-8 lg:pr-0">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-950">AnchorRead</p>
            <p className="mt-0.5 text-[11px] text-gray-500">本地阅读工作区</p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Tooltip content="工作区同步（本地 / WebDAV）">
              <button
                type="button"
                onClick={onOpenSync}
                aria-label="工作区同步"
                className="flex h-8 w-8 items-center justify-center rounded border border-gray-200 bg-white text-gray-500 outline-none hover:text-gray-900 focus-visible:ring-2 focus-visible:ring-gray-400"
              >
                <Cloud size={15} aria-hidden="true" />
              </button>
            </Tooltip>
            <Tooltip content="导出闪卡到 Anki">
              <button
                type="button"
                onClick={onExportAnki}
                aria-label="导出闪卡到 Anki"
                className="flex h-8 w-8 items-center justify-center rounded border border-gray-200 bg-white text-gray-500 outline-none hover:text-gray-900 focus-visible:ring-2 focus-visible:ring-gray-400"
              >
                <GraduationCap size={15} aria-hidden="true" />
              </button>
            </Tooltip>
            <Tooltip content="导出解读与术语到 Obsidian">
              <button
                type="button"
                onClick={onExportObsidian}
                aria-label="导出解读与术语到 Obsidian 笔记"
                className="flex h-8 w-8 items-center justify-center rounded border border-gray-200 bg-white text-gray-500 outline-none hover:text-gray-900 focus-visible:ring-2 focus-visible:ring-gray-400"
              >
                <NotebookText size={15} aria-hidden="true" />
              </button>
            </Tooltip>
            <Tooltip content="导出工作区备份（.anchorread）">
              <button
                type="button"
                onClick={onExport}
                aria-label="导出工作区备份"
                className="flex h-8 w-8 items-center justify-center rounded border border-gray-200 bg-white text-gray-500 outline-none hover:text-gray-900 focus-visible:ring-2 focus-visible:ring-gray-400"
              >
                <Download size={15} aria-hidden="true" />
              </button>
            </Tooltip>
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
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={!onImportFile || importBusy}
            className="flex h-9 items-center justify-center gap-2 rounded border border-gray-200 bg-white px-2 text-xs font-medium text-gray-700 outline-none hover:border-gray-300 hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-teal-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {importBusy ? <LoaderCircle size={15} className="animate-spin" aria-hidden="true" /> : <FileUp size={15} aria-hidden="true" />}
            {importBusy ? '导入中' : '导入文件'}
          </button>
          <button
            type="button"
            onClick={() => setPasteOpen(true)}
            disabled={!onCreateDocument}
            className="flex h-9 items-center justify-center gap-2 rounded border border-gray-200 bg-white px-2 text-xs font-medium text-gray-700 outline-none hover:border-gray-300 hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-teal-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ClipboardPaste size={15} aria-hidden="true" />
            粘贴文本
          </button>
        </div>
        <button
          type="button"
          onClick={onAnalyzeDocument}
          disabled={!onAnalyzeDocument || analysisBusy || analysisDisabled || !currentDocumentId}
          className="mt-2 flex h-9 w-full items-center justify-center gap-2 rounded bg-teal-700 px-3 text-xs font-medium text-white outline-none hover:bg-teal-800 focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-gray-300"
          title="为当前文档生成重点和解读"
        >
          {analysisBusy ? <LoaderCircle size={15} className="animate-spin" aria-hidden="true" /> : <Sparkles size={15} aria-hidden="true" />}
          {analysisBusy ? '正在分析全文' : '分析当前文档'}
        </button>
        {importError ? <p role="alert" className="mt-2 text-xs leading-5 text-red-700">{importError}</p> : null}
        <label className="relative mt-4 block">
          <span className="sr-only">搜索文档</span>
          <Search size={15} className="pointer-events-none absolute left-3 top-2.5 text-gray-400" />
          <input
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="搜索文档"
            className="h-9 w-full rounded border border-gray-200 bg-white pl-9 pr-3 text-xs text-gray-900 outline-none placeholder:text-gray-400 focus:border-teal-600 focus:ring-1 focus:ring-teal-600"
          />
        </label>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div className="py-3">
          <section aria-labelledby="reader-recent-title">
            <h2 id="reader-recent-title" className="flex items-center gap-1.5 px-4 py-2 text-[11px] font-semibold text-gray-500">
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
              <h2 id="reader-all-title" className="text-[11px] font-semibold text-gray-500">全部文档</h2>
              <span className="text-[10px] tabular-nums text-gray-400">{filtered.length}</span>
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
              <p className="px-4 py-8 text-center text-xs text-gray-500">没有匹配的文档</p>
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
