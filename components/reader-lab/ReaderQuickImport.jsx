'use client';

import { useRef, useState } from 'react';
import { ArrowRight, ArrowUpRight, Eraser, FileText, FileUp, LoaderCircle, Network, Plus, Sparkles } from 'lucide-react';
import { isEpubFile, parseEpubFile } from '@/lib/epub-import';
import { useLocale } from '@/components/LocaleProvider';
import DiagramThumbnail from '@/components/reader-lab/DiagramThumbnail';

export default function ReaderQuickImport({
  recentDocuments = [],
  recentDrawings = [],
  hasExistingDocuments = false,
  busy = false,
  error = '',
  onSubmit,
  onOpenExisting,
  onOpenDocument,
  onOpenDrawing,
  onCreateDiagram,
  onOpenDiagram,
}) {
  const { t } = useLocale();
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
      setReadError(readFailure?.message || t('home.quick.readError'));
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
    <div aria-label={t('home.quickAria')}>
      <form onSubmit={submit} className="overflow-hidden border border-stone-200 bg-white shadow-sm dark:border-stone-800 dark:bg-stone-900">
        <input
          type="text"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={t('home.quick.titlePlaceholder')}
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
          placeholder={t('home.quick.contentPlaceholder')}
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
            {t('home.quick.importFile')}
          </button>
          <button
            type="button"
            onClick={clearAll}
            disabled={busy || (!title && !content && !fileName)}
            className="flex h-9 items-center justify-center gap-2 rounded-md border border-stone-200 bg-white px-3 text-xs font-medium text-stone-600 transition-colors hover:border-stone-400 hover:bg-stone-50 disabled:opacity-50 dark:border-stone-700 dark:bg-transparent dark:text-stone-300 dark:hover:bg-white/10"
          >
            <Eraser size={16} aria-hidden="true" />
            {t('home.quick.clear')}
          </button>
          <span className="min-w-0 truncate text-xs tabular-nums text-stone-400">
            {fileName || (content ? t('home.quick.charCount', { count: content.length.toLocaleString() }) : t('home.quick.waitingInput'))}
          </span>
          <button
            type="submit"
            disabled={busy || !content.trim()}
            className="flex h-10 items-center justify-center gap-2 rounded-lg bg-stone-950 px-5 text-sm font-medium text-white transition-colors hover:bg-stone-800 disabled:opacity-50 sm:ml-auto dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-white"
          >
            {busy ? <LoaderCircle size={17} className="animate-spin" aria-hidden="true" /> : <Sparkles size={17} aria-hidden="true" />}
            {busy ? t('home.quick.parsing') : t('home.quick.parseAndRead')}
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
              {t('home.quick.recentDocuments')}
            </h3>
            {/* 文档库入口替换排序说明：最近文档只是库的预览，完整管理进文档库 */}
            {hasExistingDocuments && onOpenExisting ? (
              <button
                type="button"
                onClick={onOpenExisting}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-stone-950 transition hover:text-stone-600 dark:text-stone-100 dark:hover:text-stone-300"
              >
                <span>{t('workspace.libraryOpen')}</span>
                <ArrowRight className="size-4" />
              </button>
            ) : (
              <span className="text-xs text-stone-400">{t('home.quick.sortedByRecent')}</span>
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

      <section className="mt-10" aria-labelledby="reader-home-recent-diagrams-title">
        <div className="mb-4 flex items-center justify-between">
          <h3 id="reader-home-recent-diagrams-title" className="text-lg font-semibold text-stone-950 dark:text-stone-100">
            {t('home.quick.recentDiagrams')}
          </h3>
          {recentDrawings.length > 0 ? (
            <button
              type="button"
              onClick={onOpenDiagram}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-stone-950 transition hover:text-stone-600 dark:text-stone-100 dark:hover:text-stone-300"
            >
              <span>{t('diagramLibrary.openLibrary')}</span>
              <ArrowRight className="size-4" />
            </button>
          ) : null}
        </div>
        {recentDrawings.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {recentDrawings.map((drawing) => (
              <button
                key={drawing.id || drawing.title}
                type="button"
                onClick={() => onOpenDrawing?.(drawing)}
                disabled={busy}
                className="group relative overflow-hidden border border-stone-200 bg-white text-left transition hover:border-stone-400 disabled:opacity-50 dark:border-stone-800 dark:bg-stone-900 dark:hover:border-stone-600"
                aria-label={`${t('home.quick.openDiagram')}: ${drawing.title || t('diagram.untitled')}`}
              >
                <div className="relative aspect-[4/3] overflow-hidden bg-stone-50 bg-[radial-gradient(#d6d3d1_1px,transparent_1px)] [background-size:12px_12px] dark:bg-stone-950 dark:bg-[radial-gradient(rgba(245,245,244,.12)_1px,transparent_1px)]">
                  <DiagramThumbnail
                    drawing={drawing}
                    title={drawing.title || t('diagram.untitled')}
                  />
                  <span className="absolute left-2.5 top-2.5 rounded bg-white/90 px-2 py-1 text-[10px] font-medium uppercase text-stone-600 shadow-sm backdrop-blur dark:bg-stone-900/90 dark:text-stone-300">
                    {drawing.renderer || drawing.engine || 'Mermaid'}
                  </span>
                  <span className="absolute right-2.5 top-2.5 flex size-7 items-center justify-center rounded bg-white/90 text-stone-600 opacity-0 shadow-sm backdrop-blur transition group-hover:opacity-100 dark:bg-stone-900/90 dark:text-stone-300">
                    <ArrowUpRight size={15} aria-hidden="true" />
                  </span>
                </div>
                <div className="border-t border-stone-100 px-3 py-3 dark:border-stone-800">
                  <span className="line-clamp-1 text-sm font-medium leading-5 text-stone-900 dark:text-stone-100">
                    {drawing.title || t('diagram.untitled')}
                  </span>
                  <span className="mt-1 block truncate text-xs text-stone-400">
                    {drawing.isLocalDemo ? t('home.quick.localDemo') : (drawing.chartType || drawing.renderer || drawing.engine || 'Mermaid')}
                  </span>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-start justify-between gap-4 border border-dashed border-stone-300 bg-white/60 px-4 py-4 dark:border-stone-700 dark:bg-stone-900/50 sm:flex-row sm:items-center">
            <div className="flex items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-stone-100 text-stone-500 dark:bg-white/10 dark:text-stone-300">
                <Network size={17} aria-hidden="true" />
              </span>
              <div>
                <p className="text-sm font-medium text-stone-900 dark:text-stone-100">{t('home.quick.noDiagramsTitle')}</p>
                <p className="mt-1 text-xs leading-5 text-stone-500 dark:text-stone-400">{t('home.quick.noDiagramsBody')}</p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {onCreateDiagram ? (
                <button
                  type="button"
                  onClick={onCreateDiagram}
                  className="inline-flex h-9 items-center gap-2 rounded-md bg-stone-950 px-3 text-xs font-medium text-white transition hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-white"
                >
                  <Plus size={14} aria-hidden="true" />
                  {t('home.quick.newDiagram')}
                </button>
              ) : null}
              <button
                type="button"
                onClick={onOpenDiagram}
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-stone-300 bg-white px-3 text-xs font-medium text-stone-700 transition hover:border-stone-400 hover:text-stone-950 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300 dark:hover:border-stone-600 dark:hover:text-stone-100"
              >
                <span>{t('diagramLibrary.openLibrary')}</span>
                <ArrowRight className="size-4" />
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
