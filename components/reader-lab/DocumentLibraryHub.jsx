'use client';

import {
  Archive,
  ArchiveRestore,
  BookOpen,
  Clock3,
  FilePlus2,
  FileText,
  FileUp,
  Globe2,
  MoreHorizontal,
  Pencil,
  Search,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import DocumentImportDialog from '@/components/reader-lab/DocumentImportDialog';
import { useLocale } from '@/components/LocaleProvider';
import {
  buildDocumentReaderHref,
  DOCUMENT_LIBRARY_SCOPES,
  DOCUMENT_LIBRARY_SORTS,
  deleteDocumentAssets,
  filterAndSortDocuments,
  getDocumentActivityTime,
  setDocumentArchived,
} from '@/lib/document-library';
import { isEpubFile, parseEpubFile } from '@/lib/epub-import';
import { flashcardStore } from '@/lib/flashcard-store';
import { historyManager } from '@/lib/history-manager';
import { workspaceRepository } from '@/lib/local-workspace-db';
import { createReaderLabSeedDocuments } from '@/lib/reader-lab';
import {
  ensureDocumentRouteId,
  isDocumentRouteId,
  normalizeDocumentRouteIds,
} from '@/lib/document-route-id';
import {
  createReaderDocumentFromFile,
  createReaderDocumentFromPaste,
  createReaderDocumentFromUrl,
} from '@/lib/reader-document';
import {
  markReaderSampleSeeded,
  READER_DOCUMENT_SAMPLES_SEEDED_KEY,
  shouldSeedReaderSample,
} from '@/lib/reader-sample-seeding';

function formatDate(value, locale, justNow) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return justNow;
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).format(date);
}

function sourceLabel(document, t) {
  if (document.sourceUrl || document.importSource === 'url') return t('documentLibrary.source.web');
  if (document.importSource === 'file') return t('documentLibrary.source.file');
  if (document.importSource === 'paste') return t('documentLibrary.source.paste');
  return t('documentLibrary.source.sample');
}

export default function DocumentLibraryHub({ onOpenDocument }) {
  const { locale, t } = useLocale();
  const fileInputRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [documents, setDocuments] = useState([]);
  const [sessions, setSessions] = useState({});
  const [drawings, setDrawings] = useState([]);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState(DOCUMENT_LIBRARY_SCOPES.active);
  const [sort, setSort] = useState(DOCUMENT_LIBRARY_SORTS.activity);
  const [importOpen, setImportOpen] = useState(false);
  const [importMenuOpen, setImportMenuOpen] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [menuId, setMenuId] = useState('');
  const [renaming, setRenaming] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [operationError, setOperationError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [storedDocuments, storedSessions, storedDrawings] = await Promise.all([
          workspaceRepository.documents.list(),
          workspaceRepository.readSessions.list({ index: 'updatedAt', direction: 'prev' }),
          workspaceRepository.drawings.list(),
        ]);
        const readerDocuments = storedDocuments.filter((document) => document.readerLab);
        const shouldSeed = shouldSeedReaderSample({
          storage: window.localStorage,
          key: READER_DOCUMENT_SAMPLES_SEEDED_KEY,
          existingCount: readerDocuments.length,
        });
        const seededDocuments = shouldSeed ? createReaderLabSeedDocuments() : [];
        const documentsWithSeeds = [...readerDocuments, ...seededDocuments];
        const normalizedDocuments = normalizeDocumentRouteIds(documentsWithSeeds);
        for (const [index, document] of normalizedDocuments.entries()) {
          if (document !== documentsWithSeeds[index] || index >= readerDocuments.length) {
            await workspaceRepository.documents.save(document);
          }
        }
        markReaderSampleSeeded(window.localStorage, READER_DOCUMENT_SAMPLES_SEEDED_KEY);
        if (cancelled) return;
        const documentMap = new Map(normalizedDocuments.map((document) => [document.id, document]));
        setDocuments([...documentMap.values()]);
        setSessions(Object.fromEntries(storedSessions
          .filter((session) => session.readerLab)
          .map((session) => [session.documentId, session])));
        setDrawings(storedDrawings);
      } catch (error) {
        console.error('Failed to open document library:', error);
        setOperationError(t('documentLibrary.loadFailed'));
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => { cancelled = true; };
  }, [t]);

  const visibleDocuments = useMemo(
    () => filterAndSortDocuments({ documents, sessions, query, scope, sort }),
    [documents, query, scope, sessions, sort]
  );
  const recentDocuments = useMemo(
    () => filterAndSortDocuments({
      documents,
      sessions,
      query: '',
      scope: DOCUMENT_LIBRARY_SCOPES.active,
      sort: DOCUMENT_LIBRARY_SORTS.activity,
    }).slice(0, 4),
    [documents, sessions]
  );
  const drawingCounts = useMemo(() => {
    const counts = new Map();
    for (const drawing of drawings) {
      counts.set(drawing.documentId, (counts.get(drawing.documentId) || 0) + 1);
    }
    return counts;
  }, [drawings]);

  const openDocument = (document) => {
    onOpenDocument?.(document, buildDocumentReaderHref(document));
  };

  const persistImportedDocument = async (document) => {
    const usedRouteIds = new Set(documents.map((item) => item.routeId).filter(isDocumentRouteId));
    const nextDocument = ensureDocumentRouteId(document, usedRouteIds);
    await workspaceRepository.documents.save(nextDocument);
    setDocuments((current) => [nextDocument, ...current.filter((item) => item.id !== nextDocument.id)]);
    openDocument(nextDocument);
  };

  const importFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setImportBusy(true);
    setOperationError('');
    try {
      let document;
      if (isEpubFile(file)) {
        const { title, content } = await parseEpubFile(file);
        const baseTitle = title || file.name.replace(/\.epub$/iu, '');
        document = createReaderDocumentFromFile(
          { content, name: `${baseTitle}.md`, type: 'text/markdown', title: baseTitle },
          { existingIds: documents.map((item) => item.id) }
        );
      } else {
        document = createReaderDocumentFromFile(
          { content: await file.text(), name: file.name, type: file.type, size: file.size },
          { existingIds: documents.map((item) => item.id) }
        );
      }
      await persistImportedDocument(document);
    } catch (error) {
      setOperationError(error?.message || t('library.importFailed'));
    } finally {
      setImportBusy(false);
    }
  };

  const createDocument = async ({ title, content, sourceType, sourceUrl }) => {
    setOperationError('');
    try {
      const document = sourceType === 'url'
        ? createReaderDocumentFromUrl(
          { title, content, url: sourceUrl },
          { existingIds: documents.map((item) => item.id) }
        )
        : createReaderDocumentFromPaste(
          { title, content },
          { existingIds: documents.map((item) => item.id) }
        );
      await persistImportedDocument(document);
    } catch (error) {
      setOperationError(error?.message || t('library.import.err.failed'));
      throw error;
    }
  };

  const renameDocument = async () => {
    const title = renaming?.title?.trim();
    if (!renaming?.document || !title) return;
    const next = { ...renaming.document, title, updatedAt: Date.now() };
    await workspaceRepository.documents.save(next);
    setDocuments((current) => current.map((document) => document.id === next.id ? next : document));
    setRenaming(null);
  };

  const toggleArchive = async (document) => {
    const next = setDocumentArchived(document, document.status !== 'archived');
    await workspaceRepository.documents.save(next);
    setDocuments((current) => current.map((item) => item.id === next.id ? next : item));
    setMenuId('');
  };

  const deleteDocument = async () => {
    if (!deleteTarget) return;
    setOperationError('');
    try {
      await deleteDocumentAssets({
        repository: workspaceRepository,
        flashcards: flashcardStore,
        histories: historyManager,
        documentId: deleteTarget.id,
      });
      setDocuments((current) => current.filter((document) => document.id !== deleteTarget.id));
      setDrawings((current) => current.filter((drawing) => drawing.documentId !== deleteTarget.id));
      setSessions((current) => {
        const next = { ...current };
        delete next[deleteTarget.id];
        return next;
      });
      setDeleteTarget(null);
    } catch (error) {
      setOperationError(error?.message || t('documentLibrary.deleteFailed'));
    }
  };

  return (
    <main className="h-full overflow-y-auto bg-background text-stone-950 dark:text-stone-100">
      <div className="mx-auto w-full max-w-7xl px-6 py-8 lg:py-10">
        <header className="flex flex-col gap-5 border-b border-stone-200 pb-7 dark:border-stone-800 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-normal">{t('documentLibrary.title')}</h1>
            <p className="mt-2 text-sm leading-6 text-stone-500 dark:text-stone-400">
              {t('documentLibrary.subtitle', { count: documents.length })}
            </p>
          </div>
          <div className="relative self-start md:self-auto">
            <button
              type="button"
              onClick={() => setImportMenuOpen((open) => !open)}
              disabled={importBusy}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-stone-950 px-4 text-sm font-medium text-white transition hover:bg-stone-800 disabled:opacity-50 dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-white"
            >
              <FilePlus2 size={16} aria-hidden="true" />
              {importBusy ? t('documentLibrary.importing') : t('documentLibrary.import')}
            </button>
            {importMenuOpen ? (
              <>
                <div className="fixed inset-0 z-40" aria-hidden="true" onClick={() => setImportMenuOpen(false)} />
                <div className="absolute right-0 top-12 z-50 w-44 rounded-md border border-stone-200 bg-white p-1 shadow-lg dark:border-stone-800 dark:bg-stone-900">
                  <button type="button" onClick={() => { setImportMenuOpen(false); fileInputRef.current?.click(); }} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs hover:bg-stone-50 dark:hover:bg-white/5"><FileUp size={14} />{t('library.importFile')}</button>
                  <button type="button" onClick={() => { setImportMenuOpen(false); setImportOpen(true); }} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs hover:bg-stone-50 dark:hover:bg-white/5"><Globe2 size={14} />{t('documentLibrary.pasteOrUrl')}</button>
                </div>
              </>
            ) : null}
          </div>
          <input ref={fileInputRef} type="file" accept=".md,.markdown,.txt,.epub,text/markdown,text/plain,application/epub+zip" onChange={importFile} className="sr-only" tabIndex={-1} />
        </header>

        <section className="flex flex-col gap-3 py-6 lg:flex-row lg:items-center" aria-label={t('documentLibrary.filtersAria')}>
          <label className="relative min-w-0 flex-1 lg:max-w-sm">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" aria-hidden="true" />
            <span className="sr-only">{t('library.searchAria')}</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('library.searchPlaceholder')} className="h-9 w-full rounded-md border border-stone-200 bg-white pl-9 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-stone-400 dark:border-stone-800 dark:bg-stone-900" />
          </label>
          <div className="flex min-w-0 flex-wrap gap-2 lg:ml-auto">
            <select value={scope} onChange={(event) => setScope(event.target.value)} aria-label={t('documentLibrary.scopeAria')} className="h-9 rounded-md border border-stone-200 bg-white px-3 text-xs dark:border-stone-800 dark:bg-stone-900">
              <option value="active">{t('documentLibrary.scope.active')}</option>
              <option value="archived">{t('documentLibrary.scope.archived')}</option>
              <option value="all">{t('documentLibrary.scope.all')}</option>
            </select>
            <select value={sort} onChange={(event) => setSort(event.target.value)} aria-label={t('documentLibrary.sortAria')} className="h-9 rounded-md border border-stone-200 bg-white px-3 text-xs dark:border-stone-800 dark:bg-stone-900">
              <option value="activity">{t('documentLibrary.sort.activity')}</option>
              <option value="updated">{t('documentLibrary.sort.updated')}</option>
              <option value="created">{t('documentLibrary.sort.created')}</option>
              <option value="title">{t('documentLibrary.sort.title')}</option>
            </select>
          </div>
        </section>

        {operationError ? <p role="alert" className="mb-5 border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{operationError}</p> : null}

        {!ready ? (
          <div className="py-24 text-center text-sm text-stone-400">{t('common.loading')}</div>
        ) : documents.length === 0 ? (
          <section className="border-y border-stone-200 py-24 text-center dark:border-stone-800">
            <h2 className="text-lg font-semibold">{t('documentLibrary.emptyTitle')}</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-stone-500 dark:text-stone-400">{t('documentLibrary.emptyBody')}</p>
            <button type="button" onClick={() => setImportOpen(true)} className="mt-5 inline-flex h-9 items-center gap-2 rounded-md bg-stone-950 px-4 text-sm font-medium text-white dark:bg-stone-100 dark:text-stone-950"><FilePlus2 size={15} />{t('documentLibrary.import')}</button>
          </section>
        ) : (
          <>
            {!query.trim() && scope !== DOCUMENT_LIBRARY_SCOPES.archived && recentDocuments.length > 0 ? (
              <section aria-labelledby="document-library-recent-title">
                <div className="mb-3 flex items-center justify-between">
                  <h2 id="document-library-recent-title" className="flex items-center gap-2 text-sm font-semibold">
                    <Clock3 size={16} className="text-stone-500" aria-hidden="true" />
                    {t('library.recent')}
                  </h2>
                  <span className="text-xs text-stone-400">{t('documentLibrary.sort.activity')}</span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {recentDocuments.map((document) => {
                    const session = sessions[document.id];
                    const progress = Math.min(100, Math.max(0, Math.round(session?.progress || 0)));
                    return (
                      <button
                        key={`recent-${document.id}`}
                        type="button"
                        onClick={() => openDocument(document)}
                        className="min-w-0 rounded-md border border-stone-200 bg-white p-4 text-left transition hover:border-stone-400 hover:shadow-sm dark:border-stone-800 dark:bg-stone-900 dark:hover:border-stone-600"
                        aria-label={`${t('documentLibrary.open')}: ${document.title}`}
                      >
                        <div className="flex items-start gap-2.5">
                          <FileText size={16} className="mt-0.5 shrink-0 text-stone-500" aria-hidden="true" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold">{document.title}</span>
                            <span className="mt-1 block truncate text-xs text-stone-400">{formatDate(getDocumentActivityTime(document, sessions), locale, t('library.justNow'))}</span>
                          </span>
                        </div>
                        <div className="mt-3 h-1 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800" aria-hidden="true">
                          <div className="h-full rounded-full bg-stone-700 dark:bg-stone-300" style={{ width: `${progress}%` }} />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>
            ) : null}

            <section className="mt-10" aria-labelledby="document-library-all-title">
              <div className="mb-3 flex items-center justify-between">
                <h2 id="document-library-all-title" className="text-sm font-semibold">{t('library.allDocs')}</h2>
                <span className="text-xs tabular-nums text-stone-400">{visibleDocuments.length}</span>
              </div>
              {visibleDocuments.length === 0 ? (
                <div className="border-y border-stone-200 py-20 text-center dark:border-stone-800">
                  <h3 className="text-base font-semibold">{t('documentLibrary.noMatchTitle')}</h3>
                  <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-stone-500 dark:text-stone-400">{t('documentLibrary.noMatchBody')}</p>
                </div>
              ) : (
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-label={t('documentLibrary.gridAria')}>
            {visibleDocuments.map((document) => {
              const session = sessions[document.id];
              const archived = document.status === 'archived';
              const progress = Math.min(100, Math.max(0, Math.round(session?.progress || 0)));
              return (
                <article key={document.id} className={`group relative overflow-visible rounded-md border bg-white transition hover:border-stone-400 dark:bg-stone-900 dark:hover:border-stone-600 ${archived ? 'border-stone-200 opacity-75 dark:border-stone-800' : 'border-stone-200 dark:border-stone-800'}`}>
                  <button type="button" onClick={() => openDocument(document)} className="block w-full p-4 text-left" aria-label={`${t('documentLibrary.open')}: ${document.title}`}>
                    <h2 className="text-base font-semibold leading-6 truncate">{document.title}</h2>
                    <p className="mt-1 flex min-w-0 items-center gap-1.5 truncate text-xs text-stone-400">
                      <span className="truncate">{document.category || sourceLabel(document, t)}</span>
                    </p>
                    <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-stone-400">
                      <span className="inline-flex items-center gap-1"><Clock3 size={12} />{formatDate(getDocumentActivityTime(document, sessions), locale, t('library.justNow'))}</span>
                      <span className="inline-flex items-center gap-1"><BookOpen size={12} />{t('documentLibrary.readMinutes', { count: document.readMinutes || 0 })}</span>
                      {drawingCounts.get(document.id) ? <span>{t('documentLibrary.diagramCount', { count: drawingCounts.get(document.id) })}</span> : null}
                    </div>
                  </button>
                  <button type="button" onClick={() => setMenuId((current) => current === document.id ? '' : document.id)} className="absolute right-3 top-3 flex size-8 items-center justify-center rounded text-stone-400 hover:bg-stone-100 hover:text-stone-800 dark:hover:bg-white/10 dark:hover:text-stone-100" aria-label={t('documentLibrary.actionsAria', { title: document.title })}><MoreHorizontal size={16} /></button>
                  {menuId === document.id ? (
                    <>
                      <div className="fixed inset-0 z-40" aria-hidden="true" onClick={() => setMenuId('')} />
                      <div className="absolute right-3 top-12 z-50 w-36 rounded-md border border-stone-200 bg-white p-1 shadow-lg dark:border-stone-800 dark:bg-stone-900">
                        <button type="button" onClick={() => { setRenaming({ document, title: document.title }); setMenuId(''); }} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs hover:bg-stone-50 dark:hover:bg-white/5"><Pencil size={13} />{t('common.edit')}</button>
                        <button type="button" onClick={() => toggleArchive(document)} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs hover:bg-stone-50 dark:hover:bg-white/5">{archived ? <ArchiveRestore size={13} /> : <Archive size={13} />}{archived ? t('documentLibrary.restore') : t('documentLibrary.archive')}</button>
                        <button type="button" onClick={() => { setDeleteTarget(document); setMenuId(''); }} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/50"><Trash2 size={13} />{t('common.delete')}</button>
                      </div>
                    </>
                  ) : null}
                </article>
              );
            })}
              </div>
              )}
            </section>
          </>
        )}
      </div>

      <DocumentImportDialog open={importOpen} onClose={() => setImportOpen(false)} onCreateDocument={createDocument} />

      {renaming ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="document-library-rename-title">
          <form onSubmit={(event) => { event.preventDefault(); renameDocument(); }} className="w-full max-w-sm rounded-md border border-stone-200 bg-white p-5 shadow-xl dark:border-stone-800 dark:bg-stone-900">
            <h2 id="document-library-rename-title" className="text-base font-semibold">{t('documentLibrary.rename')}</h2>
            <input autoFocus value={renaming.title} onChange={(event) => setRenaming((current) => ({ ...current, title: event.target.value }))} className="mt-4 h-10 w-full rounded-md border border-stone-200 bg-white px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-stone-400 dark:border-stone-700 dark:bg-stone-950" />
            <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setRenaming(null)} className="h-9 rounded-md px-3 text-sm text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-white/10">{t('common.cancel')}</button><button type="submit" className="h-9 rounded-md bg-stone-950 px-3 text-sm font-medium text-white dark:bg-stone-100 dark:text-stone-950">{t('common.save')}</button></div>
          </form>
        </div>
      ) : null}

      {deleteTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="alertdialog" aria-modal="true" aria-labelledby="document-library-delete-title">
          <div className="w-full max-w-sm rounded-md border border-stone-200 bg-white p-5 shadow-xl dark:border-stone-800 dark:bg-stone-900">
            <h2 id="document-library-delete-title" className="text-base font-semibold">{t('documentLibrary.deleteTitle')}</h2>
            <p className="mt-2 text-sm leading-6 text-stone-500 dark:text-stone-400">{t('documentLibrary.deleteBody', { title: deleteTarget.title })}</p>
            <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setDeleteTarget(null)} className="h-9 rounded-md px-3 text-sm text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-white/10">{t('common.cancel')}</button><button type="button" onClick={deleteDocument} className="h-9 rounded-md bg-red-600 px-3 text-sm font-medium text-white hover:bg-red-700">{t('common.delete')}</button></div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
