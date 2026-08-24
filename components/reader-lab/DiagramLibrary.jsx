'use client';

import {
  Copy,
  FileText,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import DiagramThumbnail from '@/components/reader-lab/DiagramThumbnail';
import { useLocale } from '@/components/LocaleProvider';
import { createDocumentDrawingId } from '@/lib/diagram-generation';
import {
  buildDiagramEditorHref,
  DIAGRAM_LIBRARY_RENDERERS,
  DIAGRAM_LIBRARY_SCOPES,
  DIAGRAM_LIBRARY_SORTS,
  duplicateDrawing,
  filterAndSortDrawings,
  getDrawingRenderer,
  isStandaloneDrawing,
} from '@/lib/diagram-library';
import { createLocalDemoDrawing } from '@/lib/excalidraw-runtime-demo';
import {
  ensureDiagramRouteId,
  isDiagramRouteId,
  normalizeDiagramRouteIds,
} from '@/lib/diagram-route-id';
import {
  markReaderSampleSeeded,
  READER_DIAGRAM_SAMPLE_SEEDED_KEY,
  shouldSeedReaderSample,
} from '@/lib/reader-sample-seeding';
import { workspaceRepository } from '@/lib/local-workspace-db';

function formatUpdatedAt(value, locale, justNow) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return justNow;
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).format(date);
}

export default function DiagramLibrary({ onOpenDrawing, onCreateDrawing }) {
  const { locale, t } = useLocale();
  const [ready, setReady] = useState(false);
  const [drawings, setDrawings] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState(DIAGRAM_LIBRARY_SCOPES.all);
  const [renderer, setRenderer] = useState(DIAGRAM_LIBRARY_RENDERERS.all);
  const [sort, setSort] = useState(DIAGRAM_LIBRARY_SORTS.updated);
  const [menuId, setMenuId] = useState('');
  const [renaming, setRenaming] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [storedDrawings, storedDocuments] = await Promise.all([
          workspaceRepository.drawings.list({ index: 'updatedAt', direction: 'prev' }),
          workspaceRepository.documents.list(),
        ]);
        const shouldSeed = shouldSeedReaderSample({
          storage: window.localStorage,
          key: READER_DIAGRAM_SAMPLE_SEEDED_KEY,
          existingCount: storedDrawings.length,
        });
        const seededDrawing = shouldSeed ? createLocalDemoDrawing() : null;
        const drawingsWithSeed = seededDrawing ? [seededDrawing, ...storedDrawings] : storedDrawings;
        const normalizedDrawings = normalizeDiagramRouteIds(drawingsWithSeed);
        for (const [index, drawing] of normalizedDrawings.entries()) {
          if (drawing !== drawingsWithSeed[index]) await workspaceRepository.drawings.save(drawing);
        }
        markReaderSampleSeeded(window.localStorage, READER_DIAGRAM_SAMPLE_SEEDED_KEY);
        if (cancelled) return;
        setDrawings(normalizedDrawings);
        setDocuments(storedDocuments);
      } catch (error) {
        console.error('Failed to open diagram library:', error);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const documentMap = useMemo(
    () => new Map(documents.map((document) => [document.id, document])),
    [documents]
  );
  const visibleDrawings = useMemo(
    () => filterAndSortDrawings({ drawings, documents, query, scope, renderer, sort }),
    [documents, drawings, query, renderer, scope, sort]
  );

  const renameDrawing = async () => {
    const title = renaming?.title?.trim();
    if (!renaming?.drawing || !title) {
      setRenaming(null);
      return;
    }
    const next = { ...renaming.drawing, title, updatedAt: Date.now() };
    await workspaceRepository.drawings.save(next);
    setDrawings((current) => current.map((drawing) => drawing.id === next.id ? next : drawing));
    setRenaming(null);
  };

  const copyDrawing = async (drawing) => {
    const duplicate = duplicateDrawing(drawing, {
      id: createDocumentDrawingId(drawing.documentId),
      titleSuffix: t('diagramLibrary.copySuffix'),
    });
    const usedRouteIds = new Set(drawings.map((item) => item.routeId).filter(isDiagramRouteId));
    const next = ensureDiagramRouteId(duplicate, usedRouteIds);
    await workspaceRepository.drawings.save(next);
    setDrawings((current) => [next, ...current]);
    setMenuId('');
  };

  const deleteDrawing = async () => {
    if (!deleteTarget) return;
    await workspaceRepository.drawings.remove(deleteTarget.id);
    setDrawings((current) => current.filter((drawing) => drawing.id !== deleteTarget.id));
    setDeleteTarget(null);
  };

  return (
    <main className="h-full overflow-y-auto bg-background text-stone-950 dark:text-stone-100">
      <div className="mx-auto w-full max-w-7xl px-6 py-8 lg:py-10">
        <header className="flex flex-col gap-5 border-b border-stone-200 pb-7 dark:border-stone-800 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-normal">{t('diagramLibrary.title')}</h1>
            <p className="mt-2 text-sm leading-6 text-stone-500 dark:text-stone-400">
              {t('diagramLibrary.subtitle', { count: drawings.length })}
            </p>
          </div>
          <button
            type="button"
            onClick={onCreateDrawing}
            className="inline-flex h-10 items-center justify-center gap-2 self-start rounded-md bg-stone-950 px-4 text-sm font-medium text-white transition hover:bg-stone-800 md:self-auto dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-white"
          >
            <Plus size={16} aria-hidden="true" />
            {t('diagramLibrary.new')}
          </button>
        </header>

        <section className="flex flex-col gap-3 py-6 lg:flex-row lg:items-center" aria-label={t('diagramLibrary.filtersAria')}>
          <label className="relative min-w-0 flex-1 lg:max-w-sm">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" aria-hidden="true" />
            <span className="sr-only">{t('diagramLibrary.searchAria')}</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('diagramLibrary.searchPlaceholder')}
              className="h-9 w-full rounded-md border border-stone-200 bg-white pl-9 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-stone-400 dark:border-stone-800 dark:bg-stone-900"
            />
          </label>
          <div className="flex min-w-0 flex-wrap gap-2 lg:ml-auto">
            <select value={scope} onChange={(event) => setScope(event.target.value)} aria-label={t('diagramLibrary.scopeAria')} className="h-9 rounded-md border border-stone-200 bg-white px-3 text-xs dark:border-stone-800 dark:bg-stone-900">
              <option value="all">{t('diagramLibrary.scope.all')}</option>
              <option value="document">{t('diagramLibrary.scope.document')}</option>
              <option value="freeform">{t('diagramLibrary.scope.freeform')}</option>
            </select>
            <select value={renderer} onChange={(event) => setRenderer(event.target.value)} aria-label={t('diagramLibrary.rendererAria')} className="h-9 rounded-md border border-stone-200 bg-white px-3 text-xs dark:border-stone-800 dark:bg-stone-900">
              <option value="all">{t('diagramLibrary.renderer.all')}</option>
              <option value="mermaid">Mermaid</option>
              <option value="excalidraw">Excalidraw</option>
            </select>
            <select value={sort} onChange={(event) => setSort(event.target.value)} aria-label={t('diagramLibrary.sortAria')} className="h-9 rounded-md border border-stone-200 bg-white px-3 text-xs dark:border-stone-800 dark:bg-stone-900">
              <option value="updated">{t('diagramLibrary.sort.updated')}</option>
              <option value="created">{t('diagramLibrary.sort.created')}</option>
            </select>
          </div>
        </section>

        {!ready ? (
          <div className="py-24 text-center text-sm text-stone-400">{t('common.loading')}</div>
        ) : visibleDrawings.length === 0 ? (
          <section className="border-y border-stone-200 py-24 text-center dark:border-stone-800">
            <h2 className="text-lg font-semibold">{drawings.length === 0 ? t('diagramLibrary.emptyTitle') : t('diagramLibrary.noMatchTitle')}</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-stone-500 dark:text-stone-400">
              {drawings.length === 0 ? t('diagramLibrary.emptyBody') : t('diagramLibrary.noMatchBody')}
            </p>
            {drawings.length === 0 ? (
              <button type="button" onClick={onCreateDrawing} className="mt-5 inline-flex h-9 items-center gap-2 rounded-md bg-stone-950 px-4 text-sm font-medium text-white dark:bg-stone-100 dark:text-stone-950">
                <Plus size={15} aria-hidden="true" />
                {t('diagramLibrary.newFreeform')}
              </button>
            ) : null}
          </section>
        ) : (
          <section className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-label={t('diagramLibrary.gridAria')}>
            {visibleDrawings.map((drawing) => {
              const sourceDocument = documentMap.get(drawing.documentId);
              const standalone = isStandaloneDrawing(drawing);
              const title = drawing.title || t('diagram.untitled');
              return (
                <article key={drawing.id} className="group relative overflow-hidden rounded-md border border-stone-200 bg-white transition hover:border-stone-400 dark:border-stone-800 dark:bg-stone-900 dark:hover:border-stone-600">
                  <button type="button" onClick={() => onOpenDrawing?.(drawing, buildDiagramEditorHref(drawing))} className="block w-full text-left" aria-label={`${t('home.quick.openDiagram')}: ${title}`}>
                    <div className="relative aspect-[4/3] overflow-hidden bg-stone-50 bg-[radial-gradient(#d6d3d1_1px,transparent_1px)] [background-size:12px_12px] dark:bg-stone-950 dark:bg-[radial-gradient(rgba(245,245,244,.12)_1px,transparent_1px)]">
                      <DiagramThumbnail drawing={drawing} title={title} />
                      <span className="absolute left-2.5 top-2.5 rounded bg-white/90 px-2 py-1 text-[10px] font-medium uppercase text-stone-600 shadow-sm backdrop-blur dark:bg-stone-900/90 dark:text-stone-300">
                        {getDrawingRenderer(drawing)}
                      </span>
                    </div>
                    <div className="border-t border-stone-100 px-3 pb-3 pt-3 dark:border-stone-800">
                      <h2 className="line-clamp-1 pr-7 text-sm font-medium leading-5">{title}</h2>
                      <p className="mt-1.5 flex min-w-0 items-center gap-1.5 truncate text-xs text-stone-400">
                        {!standalone ? <FileText size={12} className="shrink-0" aria-hidden="true" /> : null}
                        <span className="truncate">{standalone ? t('diagramLibrary.freeform') : (sourceDocument?.title || t('diagramLibrary.sourceMissing'))}</span>
                      </p>
                      <p className="mt-1 text-[11px] text-stone-400">{formatUpdatedAt(drawing.updatedAt || drawing.createdAt, locale, t('library.justNow'))}</p>
                    </div>
                  </button>
                  <button type="button" onClick={() => setMenuId((current) => current === drawing.id ? '' : drawing.id)} className="absolute bottom-9 right-2 flex size-7 items-center justify-center rounded text-stone-400 hover:bg-stone-100 hover:text-stone-800 dark:hover:bg-white/10 dark:hover:text-stone-100" aria-label={t('diagramLibrary.actionsAria', { title })}>
                    <MoreHorizontal size={16} aria-hidden="true" />
                  </button>
                  {menuId === drawing.id ? (
                    <>
                      <div className="fixed inset-0 z-40" aria-hidden="true" onClick={() => setMenuId('')} />
                      <div className="absolute bottom-14 right-2 z-50 w-32 rounded-md border border-stone-200 bg-white p-1 shadow-lg dark:border-stone-800 dark:bg-stone-900">
                        <button type="button" onClick={() => { setRenaming({ drawing, title }); setMenuId(''); }} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs hover:bg-stone-50 dark:hover:bg-white/5"><Pencil size={13} />{t('common.edit')}</button>
                        <button type="button" onClick={() => copyDrawing(drawing)} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs hover:bg-stone-50 dark:hover:bg-white/5"><Copy size={13} />{t('diagramLibrary.duplicate')}</button>
                        <button type="button" onClick={() => { setDeleteTarget(drawing); setMenuId(''); }} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/50"><Trash2 size={13} />{t('common.delete')}</button>
                      </div>
                    </>
                  ) : null}
                </article>
              );
            })}
          </section>
        )}
      </div>

      {renaming ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="diagram-library-rename-title">
          <form onSubmit={(event) => { event.preventDefault(); renameDrawing(); }} className="w-full max-w-sm rounded-md border border-stone-200 bg-white p-5 shadow-xl dark:border-stone-800 dark:bg-stone-900">
            <h2 id="diagram-library-rename-title" className="text-base font-semibold">{t('diagramLibrary.rename')}</h2>
            <input autoFocus value={renaming.title} onChange={(event) => setRenaming((current) => ({ ...current, title: event.target.value }))} className="mt-4 h-10 w-full rounded-md border border-stone-200 bg-white px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-stone-400 dark:border-stone-700 dark:bg-stone-950" />
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setRenaming(null)} className="h-9 rounded-md px-3 text-sm text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-white/10">{t('common.cancel')}</button>
              <button type="submit" className="h-9 rounded-md bg-stone-950 px-3 text-sm font-medium text-white dark:bg-stone-100 dark:text-stone-950">{t('common.save')}</button>
            </div>
          </form>
        </div>
      ) : null}

      {deleteTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="alertdialog" aria-modal="true" aria-labelledby="diagram-library-delete-title">
          <div className="w-full max-w-sm rounded-md border border-stone-200 bg-white p-5 shadow-xl dark:border-stone-800 dark:bg-stone-900">
            <h2 id="diagram-library-delete-title" className="text-base font-semibold">{t('diagramLibrary.deleteTitle')}</h2>
            <p className="mt-2 text-sm leading-6 text-stone-500 dark:text-stone-400">{t('diagramLibrary.deleteBody', { title: deleteTarget.title || t('diagram.untitled') })}</p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setDeleteTarget(null)} className="h-9 rounded-md px-3 text-sm text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-white/10">{t('common.cancel')}</button>
              <button type="button" onClick={deleteDrawing} className="h-9 rounded-md bg-red-600 px-3 text-sm font-medium text-white hover:bg-red-700">{t('common.delete')}</button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
