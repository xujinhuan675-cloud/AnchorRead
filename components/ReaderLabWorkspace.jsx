'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  Brain,
  CheckCircle2,
  Download,
  EyeOff,
  Library,
  LoaderCircle,
  Menu,
  PanelRight,
  PenTool,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  WandSparkles,
} from 'lucide-react';
import DocumentLibrary from '@/components/reader-lab/DocumentLibrary';
import DocumentDiagramPanel from '@/components/reader-lab/DocumentDiagramPanel';
import DocumentDiagramCanvas from '@/components/reader-lab/DocumentDiagramCanvas';
import { useDocumentDiagram } from '@/components/reader-lab/use-document-diagram';
import ReaderQuickImport from '@/components/reader-lab/ReaderQuickImport';
import KnowledgePanel from '@/components/reader-lab/KnowledgePanel';
import ReaderSurface from '@/components/reader-lab/ReaderSurface';
import HistoryModal from '@/components/HistoryModal';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipProvider } from '@/components/ui/tooltip';
import { getConfig, isConfigValid } from '@/lib/config';
import { createDemoReaderAnalysis } from '@/lib/reader-analysis';
import {
  createReaderDocumentFromFile,
  createReaderDocumentFromPaste,
  createReaderDocumentFromUrl,
  normalizeReaderDocumentContent,
} from '@/lib/reader-document';
import { isEpubFile, parseEpubFile } from '@/lib/epub-import';
import { createCustomAction } from '@/lib/custom-actions';
import CustomActionsManager from '@/components/reader-lab/CustomActionsManager';
import WorkspaceSyncPanel from '@/components/reader-lab/WorkspaceSyncPanel';
import Modal from '@/components/ui/Modal';
import {
  calculateReadingProgress,
  createDemoExplanation,
  createReaderLabAnalysisRecords,
  createReaderLabExplanation,
  createReaderLabSeedDocuments,
  createReaderLabTerms,
  createReviewState,
  listExplainedTerms,
  listMasteredTerms,
  mergeKnownTerm,
  recordsForDocument,
} from '@/lib/reader-lab';
import { workspaceRepository } from '@/lib/local-workspace-db';
import { isDerivationStale } from '@/lib/provenance';
import { flashcardStore } from '@/lib/flashcard-store';
import { historyManager } from '@/lib/history-manager';
import { downloadWorkspaceFile, exportWorkspace } from '@/lib/workspace-file';
import { buildAnkiText, downloadAnkiFile } from '@/lib/anki-export';
import { buildObsidianVaultNotes, downloadObsidianZip } from '@/lib/obsidian-export';

const MODES = Object.freeze([
  { id: 'original', label: '原文' },
  { id: 'comparison', label: '对照' },
  { id: 'interpretation', label: '精准替代' },
]);

// 内联辅助可逐项开关：用户可按需选择理解方式，而不是一次性全部铺在原文上
const AID_OPTIONS = Object.freeze([
  { id: 'explanations', label: '解读' },
  { id: 'diagrams', label: '图表' },
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

export default function ReaderLabWorkspace({
  layout = 'reader-lab',
  started = false,
  requestedTool = 'read',
  onToolChange,
  onOpenHistory,
  onCurrentDocumentChange,
  historyDrawing,
}) {
  const isHomeLayout = layout === 'home';
  const [homeStarted, setHomeStarted] = useState(!isHomeLayout || started);
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
  const [rightPanelView, setRightPanelView] = useState(requestedTool === 'diagram' ? 'diagram' : 'knowledge');
  const [drawings, setDrawings] = useState([]);
  const [activeDrawingId, setActiveDrawingId] = useState('');
  const [diagramAnchor, setDiagramAnchor] = useState(null);
  const [flashcardPanelSignal, setFlashcardPanelSignal] = useState(0);
  const [aidVisibility, setAidVisibility] = useState({ explanations: true, diagrams: true });
  const [internalHistoryOpen, setInternalHistoryOpen] = useState(false);
  const [customActions, setCustomActions] = useState([]);
  const [customActionsOpen, setCustomActionsOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [customActionResult, setCustomActionResult] = useState(null);
  const [activePromptPresetId, setActivePromptPresetId] = useState(() => {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem('anchor-read-prompt-preset') || '';
  });
  const saveProgressTimerRef = useRef(null);
  const sessionsRef = useRef({});
  const appliedHistoryRef = useRef('');

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    setRightPanelView(requestedTool === 'diagram' ? 'diagram' : 'knowledge');
  }, [requestedTool]);

  // 首页侧边导航切到图表时由外部驱动进入工作区
  useEffect(() => {
    if (started) setHomeStarted(true);
  }, [started]);

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

        const [storedSessions, storedExplanations, storedTerms, storedReviews, storedDrawings, storedCustomActions] = await Promise.all([
          workspaceRepository.readSessions.list({ index: 'updatedAt', direction: 'prev' }),
          workspaceRepository.explanations.list(),
          workspaceRepository.terms.list(),
          workspaceRepository.reviewStates.list(),
          workspaceRepository.drawings.list({ index: 'updatedAt', direction: 'prev' }),
          workspaceRepository.customActions.list(),
        ]);
        if (cancelled) return;

        const readerSessions = storedSessions.filter((session) => session.readerLab);
        const sessionMap = Object.fromEntries(readerSessions.map((session) => [session.documentId, session]));
        const seedIds = new Set(seedDocuments.map((seed) => seed.id));
        const importedDocuments = [...byId.values()]
          .filter((document) => !seedIds.has(document.id) && document.status !== 'archived')
          .sort((left, right) => right.updatedAt - left.updatedAt);
        const nextDocuments = [
          ...importedDocuments,
          ...seedDocuments.map((seed) => byId.get(seed.id)),
        ];
        const initialId = readerSessions[0]?.documentId && byId.has(readerSessions[0].documentId)
          ? readerSessions[0].documentId
          : nextDocuments[0].id;

        setDocuments(nextDocuments);
        setSessions(sessionMap);
        setExplanations(storedExplanations.filter((record) => record.readerLab || record.id?.startsWith('reader-lab-')));
        setTerms(storedTerms.filter((term) => term.readerLab || term.id?.startsWith('reader-lab-')));
        setReviewStates(storedReviews.filter((state) => (
          (state.itemType === 'explanation' || state.id?.startsWith('reader-lab-review-')) &&
          byId.has(state.documentId)
        )));
        setDrawings(storedDrawings.filter((drawing) => seedIds.has(drawing.documentId) || byId.has(drawing.documentId)));
        setCustomActions(storedCustomActions.sort((left, right) => left.createdAt - right.createdAt));
        const initialDrawing = storedDrawings.find((drawing) => drawing.documentId === initialId);
        setActiveDrawingId(sessionMap[initialId]?.activeDrawingId || initialDrawing?.id || '');
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
  useEffect(() => {
    onCurrentDocumentChange?.(currentDocument || null);
  }, [currentDocument, onCurrentDocumentChange]);
  const currentExplanations = useMemo(
    () => recordsForDocument(explanations, currentDocumentId),
    [currentDocumentId, explanations]
  );
  const currentTerms = useMemo(
    () => recordsForDocument(terms, currentDocumentId),
    [currentDocumentId, terms]
  );
  const mastery = useMemo(() => Object.fromEntries(
    reviewStates
      .filter((state) => state.documentId === currentDocumentId && (state.itemType === 'explanation' || state.id?.startsWith('reader-lab-review-')))
      .map((state) => [state.itemId, Boolean(state.mastered)])
  ), [currentDocumentId, reviewStates]);

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
    const nextDrawing = drawings.find((drawing) => drawing.documentId === documentId);
    setActiveDrawingId(sessions[documentId]?.activeDrawingId || nextDrawing?.id || '');
    saveSession(documentId, {}).catch(console.error);
  }, [drawings, saveSession, sessions]);

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

  const persistImportedDocument = useCallback(async (document, analysisRecords = []) => {
    await workspaceRepository.documents.save(document);
    for (const record of analysisRecords) await workspaceRepository.explanations.save(record);
    setDocuments((current) => [document, ...current.filter((item) => item.id !== document.id)]);
    setExplanations((current) => [
      ...current.filter((record) => record.documentId !== document.id || !record.batchAnalysis),
      ...analysisRecords,
    ]);
    setCurrentDocumentId(document.id);
    setMode('comparison');
    setLibraryOpen(false);
    setHomeStarted(true);
    await saveSession(document.id, { mode: 'comparison', progress: 0, scrollTop: 0 });
    setNotice({ type: 'success', message: `已导入「${document.title}」，原文保存在此浏览器。` });
  }, [saveSession]);

  // 浏览器扩展深链导入：/?import=<url>，由扩展把网页发送到本实例自动抽取正文
  useEffect(() => {
    if (!ready) return undefined;
    const params = new URLSearchParams(window.location.search);
    const importUrl = params.get('import');
    if (!importUrl || !/^https?:\/\//i.test(importUrl)) return undefined;
    params.delete('import');
    const nextSearch = params.toString();
    window.history.replaceState(null, '', nextSearch ? `?${nextSearch}` : window.location.pathname);

    let cancelled = false;
    (async () => {
      setBusyAction('parse');
      try {
        const response = await fetch('/api/import-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: importUrl }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.content) {
          throw new Error(payload.error || '网页正文抽取失败，请稍后重试。');
        }
        if (cancelled) return;
        const document = createReaderDocumentFromUrl(
          { title: payload.title || '', content: payload.content, url: payload.sourceUrl || importUrl },
          { existingIds: documents.map((item) => item.id) }
        );
        await persistImportedDocument(document);
        if (cancelled) return;
        setCurrentDocumentId(document.id);
        setNotice({ type: 'success', message: `已从扩展导入：${document.title}` });
      } catch (error) {
        if (!cancelled) setNotice({ type: 'error', message: error.message || '网页导入失败。' });
      } finally {
        if (!cancelled) setBusyAction('');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, documents, persistImportedDocument]);

  const importDocumentFile = useCallback(async (file) => {
    try {
      if (isEpubFile(file)) {
        const { title: epubTitle, content: epubContent } = await parseEpubFile(file);
        const baseTitle = epubTitle || file.name.replace(/\.epub$/iu, '');
        const document = createReaderDocumentFromFile(
          { content: epubContent, name: `${baseTitle}.md`, type: 'text/markdown', title: baseTitle },
          { existingIds: documents.map((item) => item.id) }
        );
        await persistImportedDocument(document);
        return;
      }
      const content = await file.text();
      const document = createReaderDocumentFromFile(
        { content, name: file.name, type: file.type, size: file.size },
        { existingIds: documents.map((item) => item.id) }
      );
      await persistImportedDocument(document);
    } catch (error) {
      setNotice({ type: 'error', message: error.message });
      throw error;
    }
  }, [documents, persistImportedDocument]);

  const createPastedDocument = useCallback(async ({ title, content, sourceType, sourceUrl }) => {
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
      setNotice({ type: 'error', message: error.message });
      throw error;
    }
  }, [documents, persistImportedDocument]);

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

  const callReaderAnalysisApi = useCallback(async (document = currentDocument) => {
    if (!document) throw new Error('请先导入一篇文档。');
    const config = getConfig();
    const usePassword = hasPasswordMode();
    // 收集已掌握术语（排除当前文档），告知 AI 不再解释，驱动"越用越准确"
    const knownMasteredTerms = listMasteredTerms(terms, { excludeDocumentId: document.id });
    // 收集已接触未掌握术语（第二条回灌通道）：告知 AI 仍生成但更简练，不跳过
    const knownExplainedTerms = listExplainedTerms(terms, { excludeDocumentId: document.id });
    // 提示词预设：从当前配置的预设里按选中 id 取正文，未选或缺失则为空
    const promptPresets = Array.isArray(config?.promptPresets) ? config.promptPresets : [];
    const selectedPreset = activePromptPresetId
      ? promptPresets.find((preset) => preset.id === activePromptPresetId)
      : null;
    const promptPreset = selectedPreset ? selectedPreset.body : '';
    const payload = {
      title: document.title,
      content: document.content,
      mode: 'plain',
      knownMasteredTerms,
      knownExplainedTerms,
      userContext: config?.userContext || '',
      promptPreset,
    };
    if (!usePassword && !isConfigValid(config)) {
      return { result: createDemoReaderAnalysis(payload), isDemo: true };
    }

    const headers = { 'Content-Type': 'application/json' };
    if (usePassword) {
      headers['x-access-password'] = localStorage.getItem('smart-excalidraw-access-password');
    }
    const response = await fetch('/api/reader-analysis', {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...payload, config: usePassword ? null : config }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `全文分析失败 (${response.status})`);
    }
    return { result: await response.json(), isDemo: false };
  }, [currentDocument, terms, activePromptPresetId]);

  const parseAndOpenDocument = useCallback(async ({ title, content, file }) => {
    setBusyAction('parse');
    setNotice(null);
    try {
      let finalTitle = title;
      let finalContent = content;
      let sourceUrl = '';
      const trimmedContent = String(content || '').trim();
      // 首页直接粘贴单行网页链接时自动抽取正文，与文档库「网页网址」导入一致
      if (!file && /^https?:\/\/\S+$/i.test(trimmedContent)) {
        const response = await fetch('/api/import-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: trimmedContent }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.content) {
          throw new Error(payload.error || '网页正文抽取失败，请稍后重试。');
        }
        sourceUrl = payload.sourceUrl || trimmedContent;
        finalContent = payload.content;
        if (!String(finalTitle || '').trim()) finalTitle = payload.title || '';
      }
      // 正文与已有文档完全一致时直接打开旧文档，避免示例/重复导入产生副本，
      // 也让图表、解读等派生数据始终附着在同一篇文档上
      const normalizedContent = normalizeReaderDocumentContent(finalContent);
      const existing = documents.find((item) => item.content === normalizedContent);
      if (existing) {
        selectDocument(existing.id);
        setHomeStarted(true);
        setNotice({ type: 'success', message: '检测到相同正文，已直接打开已有文档。' });
        return;
      }
      const options = { existingIds: documents.map((item) => item.id) };
      const document = file
        ? createReaderDocumentFromFile(
          { content: finalContent, name: file.name, type: file.type, size: file.size, title: finalTitle },
          options
        )
        : sourceUrl
          ? createReaderDocumentFromUrl({ title: finalTitle, content: finalContent, url: sourceUrl }, options)
          : createReaderDocumentFromPaste({ title: finalTitle, content: finalContent }, options);
      const { result, isDemo } = await callReaderAnalysisApi(document);
      const records = createReaderLabAnalysisRecords({
        document,
        analysis: result,
        isDemo,
        knownMasteredTerms: listMasteredTerms(terms, { excludeDocumentId: document.id }),
      });
      await persistImportedDocument(document, records);
    } catch (error) {
      setNotice({ type: 'error', message: error.message });
    } finally {
      setBusyAction('');
    }
  }, [callReaderAnalysisApi, documents, persistImportedDocument, selectDocument]);

  const analyzeDocument = useCallback(async () => {
    if (!currentDocument || busyAction) return;
    setBusyAction('analysis');
    setNotice(null);
    try {
      const { result, isDemo } = await callReaderAnalysisApi();
      const nextRecords = createReaderLabAnalysisRecords({
        document: currentDocument,
        analysis: result,
        isDemo,
        knownMasteredTerms: listMasteredTerms(terms, { excludeDocumentId: currentDocument.id }),
      });
      if (nextRecords.length === 0) throw new Error('全文分析没有产生可定位的辅助结果。');

      const previousBatchRecords = explanations.filter(
        (record) => record.documentId === currentDocument.id && record.batchAnalysis
      );
      const previousBatchTerms = terms.filter(
        (term) => term.documentId === currentDocument.id && term.batchAnalysis
      );
      for (const record of previousBatchRecords) {
        await Promise.all([
          workspaceRepository.explanations.remove(record.id),
          workspaceRepository.reviewStates.remove(reviewId(record.id)),
        ]);
      }
      for (const term of previousBatchTerms) await workspaceRepository.terms.remove(term.id);
      for (const record of nextRecords) await workspaceRepository.explanations.save(record);

      setExplanations((current) => [
        ...current.filter((record) => !(record.documentId === currentDocument.id && record.batchAnalysis)),
        ...nextRecords,
      ]);
      setReviewStates((current) => current.filter(
        (state) => !previousBatchRecords.some((record) => record.id === state.itemId)
      ));
      setTerms((current) => [
        ...current.filter((term) => !(term.documentId === currentDocument.id && term.batchAnalysis)),
      ]);
      setMode('comparison');
      await saveSession(currentDocument.id, { mode: 'comparison' });
      setNotice({
        type: isDemo ? 'demo' : 'success',
        message: isDemo
          ? `已生成 ${nextRecords.length} 条明确标识的本地 Demo 重点与贴行辅助。`
          : `已定位 ${result.anchors.length} 个原文重点，并保存 ${nextRecords.length} 条贴行辅助。`,
      });
    } catch (error) {
      setNotice({ type: 'error', message: error.message });
    } finally {
      setBusyAction('');
    }
  }, [busyAction, callReaderAnalysisApi, currentDocument, explanations, saveSession, terms]);

  const generateFlashcards = useCallback(async () => {
    if (!currentDocument || busyAction) return;
    setBusyAction('flashcards');
    setNotice(null);
    try {
      const config = getConfig();
      const usePassword = hasPasswordMode();
      if (!usePassword && !isConfigValid(config)) throw new Error('请先配置 LLM 提供商，或启用访问密码。');
      const headers = { 'Content-Type': 'application/json' };
      if (usePassword) headers['x-access-password'] = localStorage.getItem('smart-excalidraw-access-password');
      const response = await fetch('/api/flashcards', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          article: currentDocument.content,
          highlights: currentExplanations.map((record) => ({
            text: record.selectedText,
            level: record.role || 'core',
          })),
          config: usePassword ? null : config,
        }),
      });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `闪卡生成失败 (${response.status})`);
      const result = await response.json();
      const cards = flashcardStore.addCards(result.cards, currentDocument.title, currentDocument.id);
      setNotice({ type: 'success', message: `已为当前文档生成 ${cards.length} 张闪卡。` });
      // 生成后直接切到知识面板的闪卡复习 tab，不再弹独立窗口
      setRightPanelView('knowledge');
      setFlashcardPanelSignal((signal) => signal + 1);
      onToolChange?.('read');
    } catch (error) {
      setNotice({ type: 'error', message: error.message });
    } finally {
      setBusyAction('');
    }
  }, [busyAction, currentDocument, currentExplanations, onToolChange]);

  // 切换文档时清除未消费的图表锚点，避免错锚到其他文档
  useEffect(() => {
    setDiagramAnchor(null);
  }, [currentDocumentId]);

  const currentDrawings = useMemo(
    () => drawings.filter((drawing) => drawing.documentId === currentDocumentId),
    [currentDocumentId, drawings]
  );
  const activeDrawing = currentDrawings.find((drawing) => drawing.id === activeDrawingId) || currentDrawings[0] || null;

  const selectDrawing = useCallback((drawingId) => {
    setActiveDrawingId(drawingId);
    saveSession(currentDocumentId, { activeDrawingId: drawingId }).catch(console.error);
  }, [currentDocumentId, saveSession]);

  const createDrawing = useCallback(async (drawing) => {
    await workspaceRepository.drawings.save(drawing);
    setDrawings((current) => [drawing, ...current.filter((item) => item.id !== drawing.id)]);
    setActiveDrawingId(drawing.id);
    setRightPanelView('diagram');
    await saveSession(drawing.documentId, { activeDrawingId: drawing.id });
  }, [saveSession]);

  const applyHistoryDrawing = useCallback((history) => {
    if (!currentDocument || !history?.generatedCode) return;
    createDrawing({
      id: `reader-drawing-${currentDocument.id}-${Date.now()}-history`,
      documentId: currentDocument.id,
      title: `历史图表 · ${new Date(history.timestamp || Date.now()).toLocaleString('zh-CN')}`,
      engine: history.engine || 'excalidraw',
      chartType: history.chartType || 'auto',
      source: history.generatedCode,
      prompt: history.userInput || '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }).catch((error) => setNotice({ type: 'error', message: error.message }));
    setInternalHistoryOpen(false);
  }, [createDrawing, currentDocument]);

  useEffect(() => {
    if (!historyDrawing || !currentDocument) return;
    const requestKey = `${historyDrawing.id || ''}:${historyDrawing.nonce || ''}`;
    if (!requestKey || appliedHistoryRef.current === requestKey) return;
    appliedHistoryRef.current = requestKey;
    createDrawing({
      id: `reader-drawing-${currentDocument.id}-${Date.now()}-history`,
      documentId: currentDocument.id,
      title: `历史图表 · ${new Date(historyDrawing.timestamp || Date.now()).toLocaleString('zh-CN')}`,
      engine: historyDrawing.engine || 'excalidraw',
      chartType: historyDrawing.chartType || 'auto',
      source: historyDrawing.generatedCode || '',
      prompt: historyDrawing.userInput || '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }).catch((error) => setNotice({ type: 'error', message: error.message }));
  }, [createDrawing, currentDocument, historyDrawing]);

  const persistDrawing = useCallback(async (drawing) => {
    await workspaceRepository.drawings.save(drawing);
    setDrawings((current) => current.map((item) => item.id === drawing.id ? drawing : item));
  }, []);

  const deleteDrawing = useCallback(async (drawingId) => {
    await workspaceRepository.drawings.remove(drawingId);
    const remaining = currentDrawings.filter((drawing) => drawing.id !== drawingId);
    setDrawings((current) => current.filter((drawing) => drawing.id !== drawingId));
    setActiveDrawingId(remaining[0]?.id || '');
    await saveSession(currentDocumentId, { activeDrawingId: remaining[0]?.id || '' });
  }, [currentDocumentId, currentDrawings, saveSession]);

  const handleDiagramSelection = useCallback((selection) => {
    if (!currentDocument) return;
    setDiagramAnchor({
      documentId: currentDocument.id,
      from: selection.from,
      to: selection.to,
      source: selection.text,
    });
    setRightPanelView('diagram');
    onToolChange?.('diagram');
    setNotice({ type: 'success', message: '图表已锚定到选区，生成后将插入到对应原文下方。' });
  }, [currentDocument, onToolChange]);

  const openDiagram = useCallback((drawingId) => {
    setActiveDrawingId(drawingId);
    saveSession(currentDocumentId, { activeDrawingId: drawingId }).catch(console.error);
    setRightPanelView('diagram');
    onToolChange?.('diagram');
  }, [currentDocumentId, onToolChange, saveSession]);

  const clearDiagramAnchor = useCallback(() => setDiagramAnchor(null), []);

  // 图表状态在画布区与对话区之间共享，只实例化一次
  const diagramState = useDocumentDiagram({
    document: currentDocument,
    activeDrawing,
    anchor: diagramAnchor?.documentId === currentDocument?.id ? diagramAnchor : null,
    onCreateDrawing: createDrawing,
    onPersistDrawing: persistDrawing,
    onClearAnchor: clearDiagramAnchor,
    onNotice: setNotice,
  });

  const handleSelectionAction = useCallback(async (selection) => {
    if (!currentDocument || busyAction) return;
    setBusyAction(selection.action);
    setNotice(null);
    try {
      // 自定义动作：代入模板调用 /api/custom-action，结果弹窗展示
      if (typeof selection.action === 'string' && selection.action.startsWith('custom:')) {
        const actionId = selection.action.slice('custom:'.length);
        const action = customActions.find((item) => item.id === actionId);
        if (!action) throw new Error('自定义动作不存在，请刷新后重试。');
        const config = getConfig();
        const usePassword = hasPasswordMode();
        if (!usePassword && !isConfigValid(config)) {
          setNotice({ type: 'error', message: '未检测到可用模型配置，请先在设置中配置模型。' });
          return;
        }
        const headers = { 'Content-Type': 'application/json' };
        if (usePassword) {
          headers['x-access-password'] = localStorage.getItem('smart-excalidraw-access-password');
        }
        const response = await fetch('/api/custom-action', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            config: usePassword ? null : config,
            action,
            selection: selection.text,
          }),
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error || `自定义动作执行失败 (${response.status})`);
        }
        const payload = await response.json();
        setCustomActionResult({ name: action.name, selection: selection.text, result: payload.result });
        return;
      }

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
          content: currentDocument.content,
          isDemo,
          now,
        }).map((term) => ({ ...term, readerLab: true }));
        // 命中既有同义术语时累积别名而非重复建档，让术语库越用越准
        const mergedTerms = nextTerms.map((term) => {
          const existing = terms.find((item) =>
            item.documentId !== term.documentId
            && item.normalizedTerm === term.normalizedTerm
          );
          return existing ? mergeKnownTerm(existing, term) : term;
        });
        for (const term of mergedTerms) await workspaceRepository.terms.save(term);
        setTerms((current) => {
          const byId = new Map(current.map((item) => [item.id, item]));
          for (const term of mergedTerms) byId.set(term.id, term);
          return [...byId.values()];
        });
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
  }, [busyAction, callExplainApi, currentDocument, customActions, saveSession]);

  const toggleMastery = useCallback(async (record) => {
    const nextState = createReviewState(record, !mastery[record.id]);
    await workspaceRepository.reviewStates.save(nextState);
    setReviewStates((current) => [
      ...current.filter((state) => state.id !== nextState.id),
      nextState,
    ]);
    if (!nextState.mastered || !Array.isArray(record.terms)) return;

    for (const term of record.terms) await workspaceRepository.terms.save(term);
    setTerms((current) => {
      const byId = new Map(current.map((term) => [term.id, term]));
      for (const term of record.terms) byId.set(term.id, term);
      return [...byId.values()];
    });
  }, [mastery]);

  // 术语"懂了"开关：切换 mastered 状态，已掌握的术语跨文档再次出现时不再解释
  const toggleTermMastery = useCallback(async (term) => {
    if (!term) return;
    const nextStatus = term.status === 'mastered' ? 'learning' : 'mastered';
    const nextTerm = { ...term, status: nextStatus, updatedAt: Date.now() };
    await workspaceRepository.terms.save(nextTerm);
    setTerms((current) => current.map((item) => (item.id === term.id ? nextTerm : item)));
  }, []);

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
    const record = term?.explanationId
      ? explanations.find((item) => item.id === term.explanationId)
      : null;
    if (!term?.range && !record) return;
    if (mode === 'interpretation') changeMode('comparison');
    if (term.range) setFocusRange({ ...term.range, nonce: Date.now() });
    else if (record) focusExplanation(record.id);
    setKnowledgeOpen(false);
  }, [changeMode, explanations, focusExplanation, mode]);

  const exportBackup = useCallback(async () => {
    try {
      const payload = await exportWorkspace(workspaceRepository, {
        flashcards: flashcardStore.getAll(),
        diagramHistory: historyManager.getHistories(),
      });
      downloadWorkspaceFile(payload, `anchor-read-backup-${new Date().toISOString().slice(0, 10)}.anchorread`);
      setNotice({ type: 'success', message: 'JSON 备份已开始下载。' });
    } catch (error) {
      setNotice({ type: 'error', message: error.message });
    }
  }, []);

  // 自定义动作：保存（新建/更新）与删除，持久化到本地工作区
  const saveCustomAction = useCallback(async (input) => {
    const existing = input.id ? customActions.find((item) => item.id === input.id) : null;
    const action = createCustomAction({
      ...input,
      id: input.id || undefined,
      createdAt: existing?.createdAt,
    });
    await workspaceRepository.customActions.save(action);
    setCustomActions((current) => {
      const others = current.filter((item) => item.id !== action.id);
      return [...others, action].sort((left, right) => left.createdAt - right.createdAt);
    });
    setNotice({ type: 'success', message: `自定义动作「${action.name}」已保存。` });
  }, [customActions]);

  const removeCustomAction = useCallback(async (id) => {
    await workspaceRepository.customActions.remove(id);
    setCustomActions((current) => current.filter((item) => item.id !== id));
    setNotice({ type: 'success', message: '自定义动作已删除。' });
  }, []);

  // 生态导出：闪卡 → Anki 文本导入文件
  const exportAnki = useCallback(() => {
    try {
      const cards = flashcardStore.getAll();
      if (cards.length === 0) {
        setNotice({ type: 'error', message: '还没有闪卡，先在文档中生成闪卡再导出。' });
        return;
      }
      downloadAnkiFile(buildAnkiText(cards), `anchor-read-flashcards-${new Date().toISOString().slice(0, 10)}.txt`);
      setNotice({ type: 'success', message: `已导出 ${cards.length} 张闪卡，用 Anki「文件 → 导入」打开。` });
    } catch (error) {
      setNotice({ type: 'error', message: error.message });
    }
  }, []);

  // 生态导出：解读/术语/闪卡 → Obsidian 笔记 zip（术语带双链）
  const exportObsidian = useCallback(async () => {
    try {
      const [documents, explanations, terms] = await Promise.all([
        workspaceRepository.list('documents'),
        workspaceRepository.list('explanations'),
        workspaceRepository.list('terms'),
      ]);
      const notes = buildObsidianVaultNotes({
        documents,
        explanations,
        terms,
        flashcards: flashcardStore.getAll(),
      });
      if (notes.length === 0) {
        setNotice({ type: 'error', message: '还没有解读、术语或闪卡，先产生派生内容再导出。' });
        return;
      }
      await downloadObsidianZip(notes, `anchor-read-obsidian-${new Date().toISOString().slice(0, 10)}.zip`);
      setNotice({ type: 'success', message: `已打包 ${notes.length} 篇 Obsidian 笔记，解压后放入你的 vault 即可。` });
    } catch (error) {
      setNotice({ type: 'error', message: error.message });
    }
  }, []);

  // 首页「最近文档」：按会话/文档更新时间倒序取最近几篇，点击直接续读
  const recentDocuments = useMemo(
    () => [...documents]
      .sort((left, right) =>
        (sessions[right.id]?.updatedAt || right.updatedAt) -
        (sessions[left.id]?.updatedAt || left.updatedAt))
      .slice(0, 4),
    [documents, sessions]
  );

  const openRecentDocument = useCallback((documentId) => {
    setCurrentDocumentId(documentId);
    setHomeStarted(true);
  }, []);

  if (!ready) {
    return (
      <main className="flex h-full min-h-0 items-center justify-center bg-[#f5f6f6] text-sm text-gray-500">
        <Sparkles size={17} className="mr-2 animate-pulse text-teal-700" />
        正在打开本地阅读工作区...
      </main>
    );
  }

  if (isHomeLayout && !homeStarted) {
    return (
      <TooltipProvider>
        <main className="flex h-full min-h-0 flex-col overflow-hidden bg-[#f3f5f4] text-gray-950">
          <ReaderQuickImport
            recentDocuments={recentDocuments}
            hasExistingDocuments={documents.length > 0}
            busy={busyAction === 'parse'}
            error={notice?.type === 'error' ? notice.message : ''}
            onSubmit={parseAndOpenDocument}
            onOpenExisting={() => setHomeStarted(true)}
            onOpenDocument={openRecentDocument}
          />
        </main>
      </TooltipProvider>
    );
  }
  if (!currentDocument) {
    return (
      <main className="flex h-full min-h-0 items-center justify-center bg-[#f5f6f6] text-sm text-gray-500">
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
      onExportAnki={exportAnki}
      onExportObsidian={exportObsidian}
      onOpenSync={() => setSyncOpen(true)}
      onImportFile={importDocumentFile}
      onCreateDocument={createPastedDocument}
      onAnalyzeDocument={analyzeDocument}
      analysisBusy={busyAction === 'analysis'}
      analysisDisabled={Boolean(busyAction && busyAction !== 'analysis')}
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
      documentId={currentDocument.id}
      document={currentDocument}
      explanations={currentExplanations}
      terms={currentTerms}
      mastery={mastery}
      onFocus={focusExplanation}
      onMaster={toggleMastery}
      onDelete={deleteExplanation}
      onFocusTerm={focusTerm}
      onMasterTerm={toggleTermMastery}
      isStale={isDerivationStale}
      flashcardSignal={flashcardPanelSignal}
    />
  );
  const readingSurface = (
    <ReaderSurface
      document={currentDocument}
      mode={mode}
      explanations={currentExplanations}
      mastery={mastery}
      busyAction={busyAction}
      customActions={customActions}
      onSelectionAction={handleSelectionAction}
      onDiagramSelection={handleDiagramSelection}
      onOpenDiagram={openDiagram}
      onCreateDrawing={createDrawing}
      onPersistDrawing={persistDrawing}
      onNotice={setNotice}
      drawings={currentDrawings}
      aidVisibility={aidVisibility}
      onMaster={toggleMastery}
      onDelete={deleteExplanation}
      onFocus={focusExplanation}
      onProgress={persistProgress}
      initialScrollTop={sessions[currentDocument.id]?.scrollTop || 0}
      focusRange={focusRange}
    />
  );
  const diagram = (
    <DocumentDiagramPanel
      document={currentDocument}
      drawings={currentDrawings}
      activeDrawing={activeDrawing}
      onSelectDrawing={selectDrawing}
      onCreateDrawing={createDrawing}
      onDeleteDrawing={deleteDrawing}
      onNotice={setNotice}
      anchor={diagramAnchor?.documentId === currentDocument.id ? diagramAnchor : null}
      onClearAnchor={clearDiagramAnchor}
      diagram={diagramState}
      onOpenHistory={() => {
        if (onOpenHistory) onOpenHistory(currentDocument.id);
        else setInternalHistoryOpen(true);
      }}
    />
  );
    const diagramCanvas = <DocumentDiagramCanvas diagram={diagramState} />;
    const rightPanel = rightPanelView === 'diagram' ? diagram : knowledge;

  return (
    <TooltipProvider>
      <main className="flex h-full min-h-0 flex-col overflow-hidden bg-[#f3f5f4] text-gray-950">
        {!isHomeLayout && <div className="flex min-h-8 shrink-0 items-center gap-2 border-b border-gray-200 bg-[#eef5f2] px-3 text-[11px] leading-4 text-gray-600 sm:px-4">
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
        </div>}

        <header className="z-20 flex min-h-[62px] shrink-0 items-center gap-3 border-b border-gray-200 bg-white px-3 sm:px-4 lg:px-6">
          <Tooltip content="打开文档库">
            <button
              type="button"
              onClick={() => setLibraryOpen(true)}
              aria-label="打开文档库"
              className={`h-9 w-9 shrink-0 items-center justify-center rounded border border-gray-200 text-gray-600 outline-none hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-gray-400 ${isHomeLayout ? 'flex' : 'flex lg:hidden'}`}
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
          <ToggleGroup
            type="multiple"
            value={AID_OPTIONS.filter((option) => aidVisibility[option.id]).map((option) => option.id)}
            onValueChange={(value) => setAidVisibility({
              explanations: value.includes('explanations'),
              diagrams: value.includes('diagrams'),
            })}
            aria-label="内联辅助显示"
            title="选择要在原文中显示的理解辅助"
            className="shrink-0"
          >
            {AID_OPTIONS.map((option) => (
              <ToggleGroupItem key={option.id} value={option.id} aria-label={`显示${option.label}辅助`} className="px-2 sm:px-3">
                {option.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <div className="flex shrink-0 items-center rounded border border-gray-200 bg-gray-50 p-0.5" aria-label="理解工具">
            <button type="button" title="知识" onClick={() => { setRightPanelView('knowledge'); onToolChange?.('read'); }} aria-pressed={rightPanelView === 'knowledge'} className={`flex h-8 items-center gap-1.5 rounded px-2 text-xs font-medium ${rightPanelView === 'knowledge' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}><BookOpen size={14} /><span className="hidden xl:inline">知识</span></button>
            <button type="button" title="图表" onClick={() => { setRightPanelView('diagram'); onToolChange?.('diagram'); }} aria-pressed={rightPanelView === 'diagram'} className={`flex h-8 items-center gap-1.5 rounded px-2 text-xs font-medium ${rightPanelView === 'diagram' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}><PenTool size={14} /><span className="hidden xl:inline">图表</span></button>
          </div>
          {(() => {
            const presets = getConfig()?.promptPresets || [];
            if (presets.length === 0) return null;
            return (
              <Tooltip content="选择提示词预设（视角/身份），与输出形态正交">
                <select
                  value={activePromptPresetId && presets.some((p) => p.id === activePromptPresetId) ? activePromptPresetId : ''}
                  onChange={(e) => {
                    const next = e.target.value;
                    setActivePromptPresetId(next);
                    if (typeof window !== 'undefined') {
                      if (next) localStorage.setItem('anchor-read-prompt-preset', next);
                      else localStorage.removeItem('anchor-read-prompt-preset');
                    }
                  }}
                  aria-label="选择提示词预设"
                  className="h-9 max-w-[9rem] shrink-0 rounded border border-gray-200 bg-white px-2 text-xs text-gray-700 outline-none focus-visible:ring-2 focus-visible:ring-gray-400"
                >
                  <option value="">无预设</option>
                  {presets.map((preset) => (
                    <option key={preset.id} value={preset.id}>{preset.name || '未命名预设'}</option>
                  ))}
                </select>
              </Tooltip>
            );
          })()}
          <Tooltip content="为当前文档生成全文重点和贴行辅助">
            <button
              type="button"
              onClick={analyzeDocument}
              disabled={Boolean(busyAction)}
              aria-label="分析当前文档"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-gray-200 text-teal-700 outline-none hover:bg-teal-50 focus-visible:ring-2 focus-visible:ring-teal-600 disabled:cursor-not-allowed disabled:text-gray-300"
            >
              {busyAction === 'analysis'
                ? <LoaderCircle size={17} className="animate-spin" />
                : <Sparkles size={17} />}
            </button>
          </Tooltip>
          <Tooltip content="为当前文档生成闪卡">
            <button type="button" onClick={generateFlashcards} disabled={Boolean(busyAction)} aria-label="为当前文档生成闪卡" className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-gray-200 text-gray-600 outline-none hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-gray-400 disabled:text-gray-300">
              {busyAction === 'flashcards' ? <LoaderCircle size={17} className="animate-spin" /> : <Brain size={17} />}
            </button>
          </Tooltip>
          <Tooltip content="管理选区自定义动作">
            <button
              type="button"
              onClick={() => setCustomActionsOpen(true)}
              aria-label="管理选区自定义动作"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-gray-200 text-gray-600 outline-none hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-gray-400"
            >
              <WandSparkles size={17} />
            </button>
          </Tooltip>
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
              {!isHomeLayout && (
                <>
                  <ResizablePanel id="reader-library" defaultSize="20%" minSize="220px" maxSize="320px">
                    {library}
                  </ResizablePanel>
                  <ResizableHandle />
                </>
              )}
              <ResizablePanel id="reader-content" defaultSize={isHomeLayout ? '72%' : '57%'} minSize="420px">
                {rightPanelView === 'diagram' ? (
                  diagramCanvas
                ) : (
                  <section className="h-full min-h-0" aria-label="阅读区">{readingSurface}</section>
                )}
              </ResizablePanel>
              <ResizableHandle withHandle />
              <ResizablePanel id="reader-knowledge" defaultSize={isHomeLayout ? '28%' : '23%'} minSize="260px" maxSize="440px">
                {rightPanel}
              </ResizablePanel>
            </ResizablePanelGroup>
          ) : (
            <section className="h-full min-h-0" aria-label={rightPanelView === 'diagram' ? '当前文档关系图' : '阅读区'}>
              {rightPanelView === 'diagram' ? diagramCanvas : readingSurface}
            </section>
          )}
        </div>

        <footer className="flex min-h-8 shrink-0 items-center justify-between border-t border-gray-200 bg-white px-4 text-[11px] text-gray-500">
          <span className="flex min-w-0 items-center gap-1.5 truncate">
            <BookOpen size={13} className="shrink-0" />
            {sessions[currentDocument.id]?.progress || 0}% · {currentExplanations.length} 条解读
          </span>
          <button
            type="button"
            onClick={() => setSyncOpen(true)}
            title="打开工作区备份与同步"
            className="flex items-center gap-1.5 transition-colors hover:text-gray-900"
          >
            <Library size={13} /> 本地工作区
          </button>
        </footer>

        <Sheet open={libraryOpen} onOpenChange={setLibraryOpen}>
          <SheetContent title="文档库" side="left">{library}</SheetContent>
        </Sheet>
        <Sheet open={knowledgeOpen} onOpenChange={setKnowledgeOpen}>
          <SheetContent title={rightPanelView === 'diagram' ? '文档关系图' : '知识面板'} side="right">{rightPanel}</SheetContent>
        </Sheet>
        {!onOpenHistory && (
          <HistoryModal
            isOpen={internalHistoryOpen}
            onClose={() => setInternalHistoryOpen(false)}
            onApply={applyHistoryDrawing}
            documentId={currentDocument.id}
          />
        )}
        <WorkspaceSyncPanel isOpen={syncOpen} onClose={() => setSyncOpen(false)} />
        <CustomActionsManager
          isOpen={customActionsOpen}
          onClose={() => setCustomActionsOpen(false)}
          actions={customActions}
          onSave={saveCustomAction}
          onRemove={removeCustomAction}
        />
        <Modal
          isOpen={Boolean(customActionResult)}
          onClose={() => setCustomActionResult(null)}
          title={customActionResult ? `自定义动作 · ${customActionResult.name}` : '自定义动作结果'}
        >
          {customActionResult && (
            <div className="space-y-4 text-sm text-gray-800">
              <div className="rounded border border-gray-200 bg-gray-50 p-3">
                <p className="mb-1 text-[11px] font-medium text-gray-500">选区</p>
                <p className="max-h-24 overflow-auto whitespace-pre-wrap text-xs text-gray-600">{customActionResult.selection}</p>
              </div>
              <div>
                <p className="mb-1 text-[11px] font-medium text-gray-500">结果</p>
                <p className="whitespace-pre-wrap leading-6">{customActionResult.result}</p>
              </div>
            </div>
          )}
        </Modal>
      </main>
    </TooltipProvider>
  );
}
