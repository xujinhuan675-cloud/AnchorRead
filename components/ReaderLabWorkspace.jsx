'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  CheckCircle2,
  Download,
  EyeOff,
  Library,
  Menu,
  PanelRight,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
} from 'lucide-react';
import DocumentLibrary from '@/components/reader-lab/DocumentLibrary';
import DerivedDraft from '@/components/reader-lab/DerivedDraft';
import KnowledgePanel from '@/components/reader-lab/KnowledgePanel';
import ReaderSurface from '@/components/reader-lab/ReaderSurface';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipProvider } from '@/components/ui/tooltip';
import { getConfig, isConfigValid } from '@/lib/config';
import {
  calculateReadingProgress,
  createDemoExplanation,
  createReaderLabExplanation,
  createReaderLabSeedDocuments,
  createReaderLabTerms,
  createReviewState,
  recordsForDocument,
} from '@/lib/reader-lab';
import { workspaceRepository } from '@/lib/local-workspace-db';
import { downloadWorkspaceFile, exportWorkspace } from '@/lib/workspace-file';

const MODES = Object.freeze([
  { id: 'original', label: '原文' },
  { id: 'comparison', label: '对照' },
  { id: 'interpretation', label: '解读稿' },
]);

function sessionId(documentId) {
  return `reader-lab-session-${documentId}`;
}

function reviewId(explanationId) {
  return `reader-lab-review-${explanationId}`;
}

function hasPasswordMode() {
  return typeof window !== 'undefined' &&
    localStorage.getItem('smart-excalidraw-use-password') === 'true' &&
    Boolean(localStorage.getItem('smart-excalidraw-access-password'));
}

function formatDate(value) {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(value));
}

export default function ReaderLabWorkspace({ embedded = false }) {
  const [ready, setReady] = useState(false);
  const [documents, setDocuments] = useState([]);
  const [currentDocumentId, setCurrentDocumentId] = useState('');
  const [sessions, setSessions] = useState({});
  const [explanations, setExplanations] = useState([]);
  const [terms, setTerms] = useState([]);
  const [reviewStates, setReviewStates] = useState([]);
  const [mode, setMode] = useState('comparison');
  const [query, setQuery] = useState('');
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const [busyAction, setBusyAction] = useState('');
  const [notice, setNotice] = useState(null);
  const [isDesktop, setIsDesktop] = useState(false);
  const [focusRange, setFocusRange] = useState(null);
  const saveProgressTimerRef = useRef(null);
  const sessionsRef = useRef({});

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    const media = window.matchMedia('(min-width: 1024px)');
    const update = () => setIsDesktop(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function restore() {
      try {
        const seedDocuments = createReaderLabSeedDocuments();
        const storedDocuments = await workspaceRepository.documents.list();
        const storedReaderDocuments = storedDocuments.filter((document) => document.readerLab);
        const byId = new Map(storedReaderDocuments.map((document) => [document.id, document]));
        for (const seed of seedDocuments) {
          if (!byId.has(seed.id)) {
            await workspaceRepository.documents.save(seed);
            byId.set(seed.id, seed);
          }
        }

        const [storedSessions, storedExplanations, storedTerms, storedReviews] = await Promise.all([
          workspaceRepository.readSessions.list({ index: 'updatedAt', direction: 'prev' }),
          workspaceRepository.explanations.list(),
          workspaceRepository.terms.list(),
          workspaceRepository.reviewStates.list(),
        ]);
        if (cancelled) return;

        const readerSessions = storedSessions.filter((session) => session.readerLab);
        const sessionMap = Object.fromEntries(readerSessions.map((session) => [session.documentId, session]));
        const nextDocuments = seedDocuments.map((seed) => byId.get(seed.id));
        const initialId = readerSessions[0]?.documentId && byId.has(readerSessions[0].documentId)
          ? readerSessions[0].documentId
          : nextDocuments[0].id;

        setDocuments(nextDocuments);
        setSessions(sessionMap);
        setExplanations(storedExplanations.filter((record) => record.readerLab || record.id?.startsWith('reader-lab-')));
        setTerms(storedTerms.filter((term) => term.readerLab || term.id?.startsWith('reader-lab-')));
        setReviewStates(storedReviews.filter((state) => state.id?.startsWith('reader-lab-review-')));
        setCurrentDocumentId(initialId);
        setMode(sessionMap[initialId]?.mode || 'comparison');
      } catch (error) {
        console.error('Failed to restore reader lab:', error);
        setNotice({ type: 'error', message: '本地工作区恢复失败，请检查浏览器是否允许 IndexedDB。' });
      } finally {
        if (!cancelled) setReady(true);
      }
    }
    restore();
    return () => {
      cancelled = true;
      if (saveProgressTimerRef.current) window.clearTimeout(saveProgressTimerRef.current);
    };
  }, []);

  const currentDocument = documents.find((document) => document.id === currentDocumentId) || documents[0];
  const currentExplanations = useMemo(
    () => recordsForDocument(explanations, currentDocumentId),
    [currentDocumentId, explanations]
  );
  const currentTerms = useMemo(
    () => recordsForDocument(terms, currentDocumentId),
    [currentDocumentId, terms]
  );
  const mastery = useMemo(() => Object.fromEntries(
    reviewStates.map((state) => [state.itemId, Boolean(state.mastered)])
  ), [reviewStates]);

  const saveSession = useCallback(async (documentId, changes) => {
    if (!documentId) return;
    const now = Date.now();
    const previous = sessionsRef.current[documentId] || {};
    const next = {
      ...previous,
      id: sessionId(documentId),
      documentId,
      readerLab: true,
      mode: previous.mode || 'comparison',
      progress: previous.progress || 0,
      scrollTop: previous.scrollTop || 0,
      ...changes,
      updatedAt: now,
    };
    sessionsRef.current = { ...sessionsRef.current, [documentId]: next };
    setSessions(sessionsRef.current);
    await workspaceRepository.readSessions.save(next);
  }, []);

  const selectDocument = useCallback((documentId) => {
    setCurrentDocumentId(documentId);
    setMode(sessions[documentId]?.mode || 'comparison');
    setLibraryOpen(false);
    setNotice(null);
    saveSession(documentId, {}).catch(console.error);
  }, [saveSession, sessions]);

  const changeMode = useCallback((nextMode) => {
    if (!nextMode || !currentDocumentId) return;
    setMode(nextMode);
    saveSession(currentDocumentId, { mode: nextMode }).catch(console.error);
  }, [currentDocumentId, saveSession]);

  const persistProgress = useCallback((metrics) => {
    if (!currentDocumentId) return;
    if (saveProgressTimerRef.current) window.clearTimeout(saveProgressTimerRef.current);
    saveProgressTimerRef.current = window.setTimeout(() => {
      saveSession(currentDocumentId, {
        progress: calculateReadingProgress(metrics),
        scrollTop: Math.round(metrics.scrollTop),
      }).catch(console.error);
    }, 250);
  }, [currentDocumentId, saveSession]);

  const callExplainApi = useCallback(async (selectedText) => {
    const config = getConfig();
    const usePassword = hasPasswordMode();
    if (!usePassword && !isConfigValid(config)) {
      return { result: createDemoExplanation(selectedText), isDemo: true };
    }

    const headers = { 'Content-Type': 'application/json' };
    if (usePassword) {
      headers['x-access-password'] = localStorage.getItem('smart-excalidraw-access-password');
    }
    const response = await fetch('/api/explain', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        article: currentDocument.content,
        selectedText,
        config: usePassword ? null : config,
      }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `解释请求失败 (${response.status})`);
    }
    return { result: await response.json(), isDemo: false };
  }, [currentDocument]);

  const handleSelectionAction = useCallback(async (selection) => {
    if (!currentDocument || busyAction) return;
    setBusyAction(selection.action);
    setNotice(null);
    try {
      const { result, isDemo } = await callExplainApi(selection.text);
      const now = Date.now();
      const explanation = createReaderLabExplanation({
        id: `reader-lab-explanation-${currentDocument.id}-${now}`,
        document: currentDocument,
        selection,
        response: result,
        isDemo,
        now,
      });
      explanation.readerLab = true;

      if (selection.action === 'explain') {
        await workspaceRepository.explanations.save(explanation);
        setExplanations((current) => [...current, explanation]);
        setMode('comparison');
        await saveSession(currentDocument.id, { mode: 'comparison' });
        setNotice({
          type: isDemo ? 'demo' : 'success',
          message: isDemo ? '未检测到可用模型配置，已生成明确标识的 Demo 解读。' : '解读已保存到此浏览器。',
        });
      }

      if (selection.action === 'term') {
        const nextTerms = createReaderLabTerms({
          documentId: currentDocument.id,
          explanationId: selection.action === 'explain' ? explanation.id : '',
          selectedText: selection.text,
          range: { from: selection.from, to: selection.to },
          terms: result.terms,
          isDemo,
          now,
        }).map((term) => ({ ...term, readerLab: true }));
        for (const term of nextTerms) await workspaceRepository.terms.save(term);
        setTerms((current) => [...current, ...nextTerms]);
        setKnowledgeOpen(true);
        setNotice({
          type: isDemo ? 'demo' : 'success',
          message: `${nextTerms.length} 个术语已附着到当前文档${isDemo ? '（Demo）' : ''}。`,
        });
      }
    } catch (error) {
      setNotice({ type: 'error', message: error.message });
    } finally {
      setBusyAction('');
    }
  }, [busyAction, callExplainApi, currentDocument, saveSession]);

  const toggleMastery = useCallback(async (record) => {
    const nextState = createReviewState(record, !mastery[record.id]);
    await workspaceRepository.reviewStates.save(nextState);
    setReviewStates((current) => [
      ...current.filter((state) => state.id !== nextState.id),
      nextState,
    ]);
  }, [mastery]);

  const deleteExplanation = useCallback(async (record) => {
    await Promise.all([
      workspaceRepository.explanations.remove(record.id),
      workspaceRepository.reviewStates.remove(reviewId(record.id)),
    ]);
    const linkedTerms = terms.filter((term) => term.explanationId === record.id);
    for (const term of linkedTerms) await workspaceRepository.terms.remove(term.id);
    setExplanations((current) => current.filter((item) => item.id !== record.id));
    setReviewStates((current) => current.filter((state) => state.itemId !== record.id));
    setTerms((current) => current.filter((term) => term.explanationId !== record.id));
    setNotice({ type: 'success', message: '解读已删除，源文档保持不变。' });
  }, [terms]);

  const focusExplanation = useCallback((recordId) => {
    if (mode !== 'comparison') changeMode('comparison');
    window.setTimeout(() => {
      const element = document.getElementById(`reader-note-${recordId}`);
      element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      element?.animate?.(
        [{ backgroundColor: '#ccfbf1' }, { backgroundColor: '#f0fdfa' }],
        { duration: 900 }
      );
    }, 100);
    setKnowledgeOpen(false);
  }, [changeMode, mode]);

  const focusTerm = useCallback((term) => {
    if (!term?.range) return;
    if (mode === 'interpretation') changeMode('comparison');
    setFocusRange({ ...term.range, nonce: Date.now() });
    setKnowledgeOpen(false);
  }, [changeMode, mode]);

  const exportBackup = useCallback(async () => {
    try {
      const payload = await exportWorkspace(workspaceRepository);
      downloadWorkspaceFile(payload, `anchor-read-backup-${new Date().toISOString().slice(0, 10)}.anchorread`);
      setNotice({ type: 'success', message: 'JSON 备份已开始下载。' });
    } catch (error) {
      setNotice({ type: 'error', message: error.message });
    }
  }, []);

  if (!ready || !currentDocument) {
    return (
      <main className={`flex items-center justify-center bg-[#f5f6f6] text-sm text-gray-500 ${embedded ? 'h-full min-h-0' : 'min-h-screen'}`}>
        <Sparkles size={17} className="mr-2 animate-pulse text-teal-700" />
        正在打开本地阅读工作区...
      </main>
    );
  }

  const library = (
    <DocumentLibrary
      documents={documents}
      currentDocumentId={currentDocument.id}
      sessions={sessions}
      query={query}
      onQueryChange={setQuery}
      onSelect={selectDocument}
      onExport={exportBackup}
    />
  );
  const knowledge = mode === 'original' ? (
    <div className="flex h-full flex-col items-center justify-center bg-[#fafafa] px-6 text-center">
      <EyeOff size={20} className="text-gray-400" aria-hidden="true" />
      <p className="mt-3 text-sm font-medium text-gray-700">派生内容已隐藏</p>
      <p className="mt-1 text-xs leading-5 text-gray-500">切换到对照或解读稿模式查看解读与术语。</p>
    </div>
  ) : (
    <KnowledgePanel
      explanations={currentExplanations}
      terms={currentTerms}
      mastery={mastery}
      onFocus={focusExplanation}
      onMaster={toggleMastery}
      onDelete={deleteExplanation}
      onFocusTerm={focusTerm}
    />
  );
  const readingSurface = mode === 'interpretation' ? (
    <DerivedDraft
      document={currentDocument}
      explanations={currentExplanations}
      mastery={mastery}
      onFocus={focusExplanation}
    />
  ) : (
    <ReaderSurface
      document={currentDocument}
      mode={mode}
      explanations={currentExplanations}
      mastery={mastery}
      busyAction={busyAction}
      onSelectionAction={handleSelectionAction}
      onMaster={toggleMastery}
      onDelete={deleteExplanation}
      onFocus={focusExplanation}
      onProgress={persistProgress}
      initialScrollTop={sessions[currentDocument.id]?.scrollTop || 0}
      focusRange={focusRange}
    />
  );

  return (
    <TooltipProvider>
      <main className={`flex min-h-0 flex-col overflow-hidden bg-[#f3f5f4] text-gray-950 ${embedded ? 'h-full' : 'h-dvh min-h-[520px]'}`}>
        <div className="flex min-h-8 shrink-0 items-center gap-2 border-b border-gray-200 bg-[#eef5f2] px-3 text-[11px] leading-4 text-gray-600 sm:px-4">
          <ShieldCheck size={13} className="shrink-0 text-teal-700" aria-hidden="true" />
          <span className="line-clamp-2">
            你的文档、解读与学习记录保存在此浏览器本地。浏览器数据可能被清除，请定期导出备份。数据由你掌控，当前不会上传到云端。仅当你主动生成 AI 解读时，相关内容会发送到所配置模型服务。
          </span>
          <button
            type="button"
            onClick={exportBackup}
            className="ml-auto hidden shrink-0 items-center gap-1 font-medium text-teal-800 hover:text-teal-950 sm:flex"
          >
            <Download size={12} /> 导出
          </button>
        </div>

        <header className="z-20 flex min-h-[62px] shrink-0 items-center gap-3 border-b border-gray-200 bg-white px-3 sm:px-4 lg:px-6">
          <Tooltip content="打开文档库">
            <button
              type="button"
              onClick={() => setLibraryOpen(true)}
              aria-label="打开文档库"
              className={`h-9 w-9 shrink-0 items-center justify-center rounded border border-gray-200 text-gray-600 outline-none hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-gray-400 ${embedded ? 'flex' : 'flex lg:hidden'}`}
            >
              <Menu size={18} />
            </button>
          </Tooltip>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold text-gray-950 sm:text-base">{currentDocument.title}</h1>
            <p className="mt-0.5 flex items-center gap-2 truncate text-[11px] text-gray-500">
              <span>{currentDocument.category}</span>
              <span aria-hidden="true">·</span>
              <span>{currentDocument.readMinutes} 分钟</span>
              <span className="hidden sm:inline" aria-hidden="true">·</span>
              <span className="hidden sm:inline">更新于 {formatDate(currentDocument.updatedAt)}</span>
            </p>
          </div>
          <ToggleGroup
            type="single"
            value={mode}
            onValueChange={changeMode}
            aria-label="阅读模式"
            className="shrink-0"
          >
            {MODES.map((item) => (
              <ToggleGroupItem key={item.id} value={item.id} aria-label={`${item.label}模式`} className="px-2 sm:px-3">
                {item.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Tooltip content="打开知识面板">
            <button
              type="button"
              onClick={() => setKnowledgeOpen(true)}
              aria-label="打开知识面板"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-gray-200 text-gray-600 outline-none hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-gray-400 lg:hidden"
            >
              <PanelRight size={18} />
            </button>
          </Tooltip>
        </header>

        {notice && (
          <div className={`flex min-h-9 shrink-0 items-center gap-2 border-b px-4 text-xs ${notice.type === 'error' ? 'border-red-200 bg-red-50 text-red-700' : notice.type === 'demo' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-teal-200 bg-teal-50 text-teal-800'}`}>
            {notice.type === 'error' ? <TriangleAlert size={14} /> : <CheckCircle2 size={14} />}
            <span className="min-w-0 flex-1 truncate">{notice.message}</span>
            <button type="button" onClick={() => setNotice(null)} className="shrink-0 px-1 font-medium">关闭</button>
          </div>
        )}

        <div className="min-h-0 flex-1">
          {isDesktop ? (
            <ResizablePanelGroup orientation="horizontal" id="reader-lab-layout">
              {!embedded && (
                <>
                  <ResizablePanel id="reader-library" defaultSize="20%" minSize="220px" maxSize="320px">
                    {library}
                  </ResizablePanel>
                  <ResizableHandle />
                </>
              )}
              <ResizablePanel id="reader-content" defaultSize={embedded ? '72%' : '57%'} minSize="420px">
                <section className="h-full min-h-0" aria-label="阅读区">{readingSurface}</section>
              </ResizablePanel>
              <ResizableHandle withHandle />
              <ResizablePanel id="reader-knowledge" defaultSize={embedded ? '28%' : '23%'} minSize="260px" maxSize="440px">
                {knowledge}
              </ResizablePanel>
            </ResizablePanelGroup>
          ) : (
            <section className="h-full min-h-0" aria-label="阅读区">{readingSurface}</section>
          )}
        </div>

        <footer className="flex min-h-8 shrink-0 items-center justify-between border-t border-gray-200 bg-white px-4 text-[11px] text-gray-500">
          <span className="flex min-w-0 items-center gap-1.5 truncate">
            <BookOpen size={13} className="shrink-0" />
            {sessions[currentDocument.id]?.progress || 0}% · {currentExplanations.length} 条解读
          </span>
          <span className="flex items-center gap-1.5">
            <Library size={13} /> 本地工作区
          </span>
        </footer>

        <Sheet open={libraryOpen} onOpenChange={setLibraryOpen}>
          <SheetContent title="文档库" side="left">{library}</SheetContent>
        </Sheet>
        <Sheet open={knowledgeOpen} onOpenChange={setKnowledgeOpen}>
          <SheetContent title="知识面板" side="right">{knowledge}</SheetContent>
        </Sheet>
      </main>
    </TooltipProvider>
  );
}
