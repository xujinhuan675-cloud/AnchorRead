'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  BookOpen,
  BookMarked,
  Brain,
  CheckCircle2,
  ChevronDown,
  Download,
  Highlighter,
  Home,
  Library,
  LoaderCircle,
  Menu,
  MessageSquareText,
  MoreHorizontal,
  Network,
  PanelRight,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  WandSparkles,
  Waypoints,
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
import { Tooltip, TooltipProvider } from '@/components/ui/tooltip';
import { getConfig, isConfigValid } from '@/lib/config';
import { createDemoReaderAnalysis, readerRoleLayer } from '@/lib/reader-analysis';
import {
  createReaderDocumentFromFile,
  createReaderDocumentFromPaste,
  createReaderDocumentFromUrl,
  normalizeReaderDocumentContent,
} from '@/lib/reader-document';
import { isEpubFile, parseEpubFile } from '@/lib/epub-import';
import { createCustomAction } from '@/lib/custom-actions';
import CustomActionsManager from '@/components/reader-lab/CustomActionsManager';
import GlossaryManager from '@/components/reader-lab/GlossaryManager';
import WorkspaceSyncPanel from '@/components/reader-lab/WorkspaceSyncPanel';
import Modal from '@/components/ui/Modal';
import {
  calculateReadingProgress,
  combineKnownMasteredTerms,
  createDemoExplanation,
  createReaderLabAnalysisRecords,
  createReaderLabExplanation,
  createReaderLabSeedDocuments,
  createReaderLabTerms,
  createReviewState,
  listExplainedTerms,
  listMasteredTerms,
  mergeKnownTerm,
  migrateBatchAnalysisMappings,
  recordsForDocument,
} from '@/lib/reader-lab';
import { workspaceRepository } from '@/lib/local-workspace-db';
import { mergeInboxPayload } from '@/lib/inbox-merge';
import { isDerivationStale } from '@/lib/provenance';
import { flashcardStore } from '@/lib/flashcard-store';
import { historyManager } from '@/lib/history-manager';
import { downloadWorkspaceFile, exportWorkspace } from '@/lib/workspace-file';
import { buildAnkiText, downloadAnkiFile } from '@/lib/anki-export';
import { buildObsidianVaultNotes, downloadObsidianZip } from '@/lib/obsidian-export';

// 阅读辅助都是叠加在原文之上的可选层：多选多生效，全部关闭即纯原文
const AID_OPTIONS = Object.freeze([
  { id: 'explanations', label: '解读' },
  { id: 'diagrams', label: '图表' },
  { id: 'precision', label: '精准替代' },
]);

// 层级化重点可见性：可全部展示，也可只展示某一层（如只看文章层中心论点）
const LAYER_OPTIONS = Object.freeze([
  { id: 'article', label: '文章层 · 中心论点' },
  { id: 'paragraph', label: '段落层 · 分论点' },
  { id: 'sentence', label: '句子层 · 句重点' },
  { id: 'word', label: '词语层 · 中心/金句/成语' },
]);
const DEFAULT_LAYERS = Object.freeze({ article: true, paragraph: true, sentence: true, word: true });

function readStoredLayerVisibility() {
  if (typeof window === 'undefined') return { ...DEFAULT_LAYERS };
  try {
    const stored = JSON.parse(window.localStorage.getItem('anchor-read-layer-visibility') || 'null');
    if (stored && typeof stored === 'object') return { ...DEFAULT_LAYERS, ...stored };
  } catch {
    // 解析失败回退默认全开
  }
  return { ...DEFAULT_LAYERS };
}

// 打开文档的默认形态：原文 + 解读 + 图表，精准替代关闭
const DEFAULT_AIDS = Object.freeze({ explanations: true, diagrams: true, precision: false });

/**
 * 旧版会话只存阅读模式（original/comparison/interpretation），
 * 恢复时翻译成对应的多选辅助状态；新版会话直接读取 aids。
 */
function sessionAids(session) {
  const stored = session?.aids;
  if (stored && typeof stored === 'object') return { ...DEFAULT_AIDS, ...stored };
  if (session?.mode === 'original') return { explanations: false, diagrams: false, precision: false };
  if (session?.mode === 'interpretation') return { ...DEFAULT_AIDS, precision: true };
  return DEFAULT_AIDS;
}

/**
 * 与 AnchorRead 浏览器扩展的 content script 握手，取回它暂存的载荷。
 * 深链 ?via=clipper 表示扩展已暂存载荷；网页无法直接读 chrome.storage，
 * 由页面轮询发起 postMessage 请求，注入在本网页的 content script 回传载荷。
 * 超时或载荷不匹配时返回 null，调用方回退（剪藏回退服务端重抓取，收件箱报错提示）。
 * @param {string} kind - 'clip'：剪藏的已渲染 DOM；'inbox'：原地阅读收件箱
 */
function requestExtensionPayload(kind = 'clip', { attempts = 8, intervalMs = 400 } = {}) {
  return new Promise((resolve) => {
    const requestId = `${kind}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let timer = null;
    let tries = 0;

    const cleanup = () => {
      window.removeEventListener('message', onMessage);
      if (timer) clearInterval(timer);
    };
    const onMessage = (event) => {
      const data = event.data;
      if (event.source !== window || data?.type !== 'anchorread/clip-response') return;
      if (data.requestId !== requestId) return;
      cleanup();
      resolve(data);
    };
    window.addEventListener('message', onMessage);
    const request = () => window.postMessage({ type: 'anchorread/clip-request', requestId, kind }, '*');
    request();
    timer = setInterval(() => {
      tries += 1;
      if (tries >= attempts) {
        cleanup();
        resolve(null);
        return;
      }
      request();
    }, intervalMs);
  });
}

/** 剪藏载荷校验：归属本次剪藏的网址、载荷新鲜（十分钟内），否则回退重抓取 */
async function requestClipperPayload(sourceUrl) {
  const data = await requestExtensionPayload('clip');
  const clip = data?.clip;
  const fresh = Number.isFinite(clip?.savedAt) && Date.now() - clip.savedAt < 10 * 60 * 1000;
  return clip?.html && clip.url === sourceUrl && fresh ? clip : null;
}

/** 收件箱载荷校验：kind 匹配且载荷新鲜（十分钟内），含解读或术语任一 */
async function requestInboxPayload() {
  const data = await requestExtensionPayload('inbox');
  const inbox = data?.inbox;
  const fresh = Number.isFinite(inbox?.savedAt) && Date.now() - inbox.savedAt < 10 * 60 * 1000;
  const hasContent = Array.isArray(inbox?.inboxItems) && inbox.inboxItems.length > 0 ||
    Array.isArray(inbox?.glossaryTerms) && inbox.glossaryTerms.length > 0;
  return inbox?.kind === 'inbox' && fresh && hasContent ? inbox : null;
}

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
  const [query, setQuery] = useState('');
  const [libraryOpen, setLibraryOpen] = useState(false);
  // 桌面端左侧文档库折叠状态，持久化到本地，刷新后保持用户偏好
  const [libraryCollapsed, setLibraryCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('anchor-read-library-collapsed') === '1';
  });
  const updateLibraryCollapsed = (collapsed) => {
    setLibraryCollapsed(collapsed);
    if (typeof window !== 'undefined') {
      localStorage.setItem('anchor-read-library-collapsed', collapsed ? '1' : '0');
    }
  };
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
  const [aidVisibility, setAidVisibility] = useState({ ...DEFAULT_AIDS });
  // 层级重点可见性偏好持久化，刷新后保持
  const [layerVisibility, setLayerVisibility] = useState(readStoredLayerVisibility);
  const [layerMenuOpen, setLayerMenuOpen] = useState(false);
  // 头部动作分层收纳：生成类与管理类各自一个下拉，互斥展开
  const [generateMenuOpen, setGenerateMenuOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [internalHistoryOpen, setInternalHistoryOpen] = useState(false);
  const [customActions, setCustomActions] = useState([]);
  const [customActionsOpen, setCustomActionsOpen] = useState(false);
  const [glossaryOpen, setGlossaryOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [customActionResult, setCustomActionResult] = useState(null);
  const [glossary, setGlossary] = useState([]);
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

        const [storedSessions, storedExplanations, storedTerms, storedReviews, storedDrawings, storedCustomActions, storedGlossary] = await Promise.all([
          workspaceRepository.readSessions.list({ index: 'updatedAt', direction: 'prev' }),
          workspaceRepository.explanations.list(),
          workspaceRepository.terms.list(),
          workspaceRepository.reviewStates.list(),
          workspaceRepository.drawings.list({ index: 'updatedAt', direction: 'prev' }),
          workspaceRepository.customActions.list(),
          workspaceRepository.glossary.list({ index: 'updatedAt', direction: 'prev' }),
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
        // 旧版全文分析记录缺少 mappings 会让精准替代静默回退原文，恢复时统一迁移并持久化
        const readerExplanations = storedExplanations.filter((record) => record.readerLab || record.id?.startsWith('reader-lab-'));
        const { records: migratedExplanations, migrated } = migrateBatchAnalysisMappings(readerExplanations);
        for (const record of migrated) await workspaceRepository.explanations.save(record);
        setExplanations(migratedExplanations);
        setTerms(storedTerms.filter((term) => term.readerLab || term.id?.startsWith('reader-lab-')));
        setReviewStates(storedReviews.filter((state) => (
          (state.itemType === 'explanation' || state.id?.startsWith('reader-lab-review-')) &&
          byId.has(state.documentId)
        )));
        setDrawings(storedDrawings.filter((drawing) => seedIds.has(drawing.documentId) || byId.has(drawing.documentId)));
        setCustomActions(storedCustomActions.sort((left, right) => left.createdAt - right.createdAt));
        setGlossary(storedGlossary);
        const initialDrawing = storedDrawings.find((drawing) => drawing.documentId === initialId);
        setActiveDrawingId(sessionMap[initialId]?.activeDrawingId || initialDrawing?.id || '');
        setCurrentDocumentId(initialId);
        setAidVisibility(sessionAids(sessionMap[initialId]));
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
  // 术语表载荷：只把用户可见字段发给 AI，作为解读与全文分析的背景交代
  const glossaryPayload = useMemo(
    () => glossary.map(({ term, aliases, explanation }) => ({ term, aliases, explanation })),
    [glossary]
  );
  // 术语表 + 已掌握术语合并后的回灌集合：两者都视为用户已懂，命中即不再解释
  const knownMasteredWithGlossary = useCallback(
    (documentId) => combineKnownMasteredTerms(
      listMasteredTerms(terms, { excludeDocumentId: documentId }),
      glossaryPayload
    ),
    [glossaryPayload, terms]
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
    // 新版会话只持久化多选辅助状态，旧版 mode 字段在读取时由 sessionAids 迁移
    const next = {
      id: sessionId(documentId),
      documentId,
      readerLab: true,
      aids: previous.aids || DEFAULT_AIDS,
      progress: previous.progress || 0,
      scrollTop: previous.scrollTop || 0,
      activeDrawingId: previous.activeDrawingId || '',
      ...changes,
      updatedAt: now,
    };
    sessionsRef.current = { ...sessionsRef.current, [documentId]: next };
    setSessions(sessionsRef.current);
    await workspaceRepository.readSessions.save(next);
  }, []);

  const selectDocument = useCallback((documentId) => {
    setCurrentDocumentId(documentId);
    setAidVisibility(sessionAids(sessions[documentId]));
    setLibraryOpen(false);
    setNotice(null);
    const nextDrawing = drawings.find((drawing) => drawing.documentId === documentId);
    setActiveDrawingId(sessions[documentId]?.activeDrawingId || nextDrawing?.id || '');
    saveSession(documentId, {}).catch(console.error);
  }, [drawings, saveSession, sessions]);

  // 多选辅助开关：任何变更立即持久化到当前文档会话，每篇文档记住自己的阅读组合
  const updateAids = useCallback((nextAids) => {
    setAidVisibility(nextAids);
    if (currentDocumentId) saveSession(currentDocumentId, { aids: nextAids }).catch(console.error);
  }, [currentDocumentId, saveSession]);

  const toggleAid = useCallback((aidId) => {
    updateAids({ ...aidVisibility, [aidId]: !aidVisibility[aidId] });
  }, [aidVisibility, updateAids]);

  const updateLayerVisibility = useCallback((next) => {
    setLayerVisibility(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('anchor-read-layer-visibility', JSON.stringify(next));
    }
  }, []);

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
    // 导入即分析时同样把派生术语写入术语库，保持与工作台「分析」按钮一致的术语沉淀
    const importedTerms = analysisRecords.flatMap((record) => record.terms || []);
    for (const term of importedTerms) await workspaceRepository.terms.save(term);
    setDocuments((current) => [document, ...current.filter((item) => item.id !== document.id)]);
    setExplanations((current) => [
      ...current.filter((record) => record.documentId !== document.id || !record.batchAnalysis),
      ...analysisRecords,
    ]);
    setTerms((current) => [
      ...current.filter((term) => !(term.documentId === document.id && term.batchAnalysis)),
      ...importedTerms,
    ]);
    setCurrentDocumentId(document.id);
    setAidVisibility({ ...DEFAULT_AIDS });
    setLibraryOpen(false);
    setHomeStarted(true);
    await saveSession(document.id, { aids: DEFAULT_AIDS, progress: 0, scrollTop: 0 });
    setNotice({ type: 'success', message: `已导入「${document.title}」，原文保存在此浏览器。` });
  }, [saveSession]);

  // 浏览器扩展深链导入：/?import=<url>；带 via=clipper 时优先接收扩展提取的已渲染 DOM，
  // 避免服务端重抓取失败（纯 JS 渲染、强反爬、内网页面）；握手失败时回退到重抓取
  useEffect(() => {
    if (!ready) return undefined;
    const params = new URLSearchParams(window.location.search);
    const importUrl = params.get('import');
    if (!importUrl || !/^https?:\/\//i.test(importUrl)) return undefined;
    const viaClipper = params.get('via') === 'clipper';
    params.delete('import');
    params.delete('via');
    const nextSearch = params.toString();
    window.history.replaceState(null, '', nextSearch ? `?${nextSearch}` : window.location.pathname);

    let cancelled = false;
    (async () => {
      setBusyAction('parse');
      try {
        const clip = viaClipper ? await requestClipperPayload(importUrl) : null;
        if (cancelled) return;
        const body = clip?.html
          ? { url: importUrl, html: clip.html, title: clip.title || '' }
          : { url: importUrl };
        const response = await fetch('/api/import-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
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

  // 浏览器扩展原地阅读收件箱回流：/?inbox=1&via=clipper。
  // 与剪藏同样走 postMessage 握手取回载荷，合并进工作区（术语表去重并入，解读按来源网址挂到既有文档）
  useEffect(() => {
    if (!ready) return undefined;
    const params = new URLSearchParams(window.location.search);
    if (params.get('inbox') !== '1') return undefined;
    const viaClipper = params.get('via') === 'clipper';
    params.delete('inbox');
    params.delete('via');
    const nextSearch = params.toString();
    window.history.replaceState(null, '', nextSearch ? `?${nextSearch}` : window.location.pathname);
    if (!viaClipper) {
      setNotice({ type: 'error', message: '回流链接缺少扩展交接标记，请从扩展侧边栏重新发起回流。' });
      return undefined;
    }

    let cancelled = false;
    (async () => {
      setBusyAction('inbox');
      try {
        const payload = await requestInboxPayload();
        if (cancelled) return;
        if (!payload) throw new Error('未接收到扩展收件箱，请确认扩展侧边栏已发起回流后重试。');
        const merged = mergeInboxPayload(payload, { documents, glossary, explanations });
        for (const entry of merged.glossaryEntries) await workspaceRepository.glossary.save(entry);
        for (const record of merged.explanationRecords) await workspaceRepository.explanations.save(record);
        if (cancelled) return;
        if (merged.glossaryEntries.length > 0) {
          setGlossary((current) => [...current, ...merged.glossaryEntries]);
        }
        if (merged.explanationRecords.length > 0) {
          setExplanations((current) => [...current, ...merged.explanationRecords]);
        }
        const parts = [];
        if (merged.summary.attachedExplanations > 0) parts.push(`${merged.summary.attachedExplanations} 条解读已挂到对应文档`);
        if (merged.summary.addedTerms > 0) parts.push(`${merged.summary.addedTerms} 个术语已并入术语表`);
        if (merged.summary.unmatchedItems > 0) parts.push(`${merged.summary.unmatchedItems} 条解读因尚未导入对应网页暂未挂载`);
        if (merged.summary.duplicates > 0) parts.push(`${merged.summary.duplicates} 条重复解读已跳过`);
        setNotice({
          type: 'success',
          message: parts.length > 0 ? `已接收扩展采集：${parts.join('，')}。` : '已接收扩展回流，但没有可合并的新内容。',
        });
      } catch (error) {
        if (!cancelled) setNotice({ type: 'error', message: error.message || '扩展收件箱回流失败。' });
      } finally {
        if (!cancelled) setBusyAction('');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, documents, glossary, explanations]);

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
        // 术语表作为背景：告知 AI 哪些术语已有既定定义，不再列为新术语
        glossary: glossaryPayload,
        config: usePassword ? null : config,
      }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `解释请求失败 (${response.status})`);
    }
    return { result: await response.json(), isDemo: false };
  }, [currentDocument, glossaryPayload]);

  const callReaderAnalysisApi = useCallback(async (document = currentDocument) => {
    if (!document) throw new Error('请先导入一篇文档。');
    const config = getConfig();
    const usePassword = hasPasswordMode();
    // 已掌握术语与术语表合并回灌（均视为已懂）：告知 AI 不再解释，驱动"越用越准确"
    const knownMasteredTerms = knownMasteredWithGlossary(document.id);
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
      // 术语表单独交代定义背景：AI 沿用表中既定定义，不另造解释
      glossary: glossaryPayload,
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
  }, [currentDocument, glossaryPayload, knownMasteredWithGlossary, terms, activePromptPresetId]);

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
        knownMasteredTerms: knownMasteredWithGlossary(document.id),
      });
      await persistImportedDocument(document, records);
    } catch (error) {
      setNotice({ type: 'error', message: error.message });
    } finally {
      setBusyAction('');
    }
  }, [callReaderAnalysisApi, documents, knownMasteredWithGlossary, persistImportedDocument, selectDocument]);

  const runReaderAnalysis = useCallback(async (kind = 'inline') => {
    if (!currentDocument || busyAction) return;
    setBusyAction('analysis');
    setNotice(null);
    try {
      const { result, isDemo } = await callReaderAnalysisApi();
      const nextRecords = createReaderLabAnalysisRecords({
        document: currentDocument,
        analysis: result,
        isDemo,
        knownMasteredTerms: knownMasteredWithGlossary(currentDocument.id),
        kind,
      });
      if (nextRecords.length === 0) throw new Error('全文分析没有产生可定位的辅助结果。');

      // 重点与解读是两类独立批量，重新生成时只替换同类旧记录
      const previousBatchRecords = explanations.filter(
        (record) => record.documentId === currentDocument.id
          && record.batchAnalysis
          && (record.batchKind || 'inline') === kind
      );
      const previousBatchTerms = kind === 'inline'
        ? terms.filter((term) => term.documentId === currentDocument.id && term.batchAnalysis)
        : [];
      for (const record of previousBatchRecords) {
        await Promise.all([
          workspaceRepository.explanations.remove(record.id),
          workspaceRepository.reviewStates.remove(reviewId(record.id)),
        ]);
      }
      for (const term of previousBatchTerms) await workspaceRepository.terms.remove(term.id);
      for (const record of nextRecords) await workspaceRepository.explanations.save(record);
      // 批量分析从 mapping 派生的术语同步写入术语库，供知识面板展示与跨文档术语回灌
      const nextBatchTerms = nextRecords.flatMap((record) => record.terms || []);
      for (const term of nextBatchTerms) await workspaceRepository.terms.save(term);

      setExplanations((current) => [
        ...current.filter((record) => !(
          record.documentId === currentDocument.id
          && record.batchAnalysis
          && (record.batchKind || 'inline') === kind
        )),
        ...nextRecords,
      ]);
      setReviewStates((current) => current.filter(
        (state) => !previousBatchRecords.some((record) => record.id === state.itemId)
      ));
      setTerms((current) => [
        ...current.filter((term) => !(term.documentId === currentDocument.id && term.batchAnalysis)),
        ...nextBatchTerms,
      ]);
      // 分析完成后打开解读，让重点与贴行卡可见；其余辅助保持用户自选组合
      updateAids({ ...aidVisibility, explanations: true });
      setNotice({
        type: isDemo ? 'demo' : 'success',
        message: kind === 'highlights'
          ? (isDemo
            ? `已生成 ${nextRecords.length} 条明确标识的本地 Demo 全文重点。`
            : `已在原文中高亮 ${nextRecords.length} 处全文重点。`)
          : (isDemo
            ? `已生成 ${nextRecords.length} 条明确标识的本地 Demo 重点与解读。`
            : `已定位 ${result.anchors.length} 个原文重点，并保存 ${nextRecords.length} 条解读。`),
      });
    } catch (error) {
      setNotice({ type: 'error', message: error.message });
    } finally {
      setBusyAction('');
    }
  }, [aidVisibility, busyAction, callReaderAnalysisApi, currentDocument, explanations, knownMasteredWithGlossary, terms, updateAids]);

  const analyzeHighlights = useCallback(() => runReaderAnalysis('highlights'), [runReaderAnalysis]);
  const analyzeInlineAid = useCallback(() => runReaderAnalysis('inline'), [runReaderAnalysis]);
  // 文档库与精准替代提示条等入口沿用原有行为：一次分析同时生成重点与解读
  const analyzeDocument = useCallback(async () => {
    await runReaderAnalysis('highlights');
    await runReaderAnalysis('inline');
  }, [runReaderAnalysis]);

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
          highlights: currentExplanations
            .filter((record) => record.level !== 'word')
            .map((record) => ({
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
      // 生成后直接切到知识面板的闪卡 tab，不再弹独立窗口
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

  // 一键全文图：切到图表视图并直接发起整篇文档的关系图生成，省去手动输入提示词
  const generateFullDiagram = useCallback(() => {
    if (!currentDocument || diagramState.isGenerating) return;
    setRightPanelView('diagram');
    onToolChange?.('diagram');
    diagramState.generate(
      '请围绕这篇文档的全文内容建模，梳理核心概念与它们之间的关系，生成一张完整的全文关系图',
      'auto',
      'text',
      'mermaid'
    );
  }, [currentDocument, diagramState, onToolChange]);

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
        updateAids({ ...aidVisibility, explanations: true });
        setNotice({
          type: isDemo ? 'demo' : 'success',
          message: isDemo ? '未检测到可用模型配置，已生成明确标识的 Demo 解读。' : '解读已保存到此浏览器。',
        });
      }

      if (selection.action === 'term') {
        // 术语表兜底：命中术语表主术语或别名的返回项不再建档（服务端已过滤，防 AI 不听话）
        const glossaryKeys = new Set(glossary.flatMap((entry) => [
          entry.normalizedTerm,
          ...(Array.isArray(entry.aliases) ? entry.aliases : []),
        ]));
        const nextTerms = createReaderLabTerms({
          documentId: currentDocument.id,
          explanationId: selection.action === 'explain' ? explanation.id : '',
          selectedText: selection.text,
          range: { from: selection.from, to: selection.to },
          terms: result.terms,
          content: currentDocument.content,
          isDemo,
          now,
        })
          .map((term) => ({ ...term, readerLab: true }))
          .filter((term) =>
            !glossaryKeys.has(term.normalizedTerm)
            && !term.aliases.some((alias) => glossaryKeys.has(alias))
          );
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
  }, [aidVisibility, busyAction, callExplainApi, currentDocument, customActions, glossary, terms, updateAids]);

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
    // 定位解读卡需要原文坐标：关闭精准替代并打开解读
    if (aidVisibility.precision || !aidVisibility.explanations) {
      updateAids({ ...aidVisibility, precision: false, explanations: true });
    }
    // 记录所在层被隐藏时先恢复可见，否则高亮/框线装饰不存在，无法定位
    const record = explanations.find((item) => item.id === recordId);
    const layer = record?.level === 'word' ? 'word' : readerRoleLayer(record?.role);
    if (record && layerVisibility[layer] === false) {
      updateLayerVisibility({ ...layerVisibility, [layer]: true });
    }
    window.setTimeout(() => {
      // 行间解读卡优先；词语层记录没有卡片，回退到原文上的框线装饰
      const element = document.getElementById(`reader-note-${recordId}`)
        || document.querySelector(`[data-reader-explanation-id="${recordId}"]`);
      element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      element?.animate?.(
        [{ backgroundColor: '#ccfbf1' }, { backgroundColor: '#f0fdfa' }],
        { duration: 900 }
      );
    }, 100);
    setKnowledgeOpen(false);
  }, [aidVisibility, explanations, layerVisibility, updateAids, updateLayerVisibility]);

  const focusTerm = useCallback((term) => {
    const record = term?.explanationId
      ? explanations.find((item) => item.id === term.explanationId)
      : null;
    if (!term?.range && !record) return;
    // 精准替代视图里的文本坐标已变，定位前先还原原文
    if (aidVisibility.precision) updateAids({ ...aidVisibility, precision: false });
    if (term.range) setFocusRange({ ...term.range, nonce: Date.now() });
    else if (record) focusExplanation(record.id);
    setKnowledgeOpen(false);
  }, [aidVisibility, explanations, focusExplanation, updateAids]);

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

  // 术语表：保存（新建/更新）条目，持久化到本地工作区并立即作为 AI 背景生效
  const saveGlossaryEntry = useCallback(async (input) => {
    const existing = input.id ? glossary.find((entry) => entry.id === input.id) : null;
    const entry = {
      id: input.id || `glossary-${Date.now()}`,
      term: input.term,
      aliases: Array.isArray(input.aliases) ? input.aliases : [],
      explanation: typeof input.explanation === 'string' ? input.explanation : '',
      createdAt: existing?.createdAt,
      updatedAt: Date.now(),
    };
    await workspaceRepository.glossary.save(entry);
    setGlossary((current) => [
      ...current.filter((item) => item.id !== entry.id),
      entry,
    ]);
    setNotice({ type: 'success', message: `术语「${entry.term}」已保存，后续解读将沿用此定义。` });
  }, [glossary]);

  const removeGlossaryEntry = useCallback(async (id) => {
    await workspaceRepository.glossary.remove(id);
    setGlossary((current) => current.filter((entry) => entry.id !== id));
    setNotice({ type: 'success', message: '术语表条目已删除。' });
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
  // 知识面板是派生内容的管理入口，始终可见；辅助开关只控制原文上的叠加显示
  const knowledge = (
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
  // 任一重点层级勾选时重点入口呈点亮态；全部取消勾选即隐藏原文重点
  const anyLayerVisible = LAYER_OPTIONS.some((option) => layerVisibility[option.id] !== false);
  const allLayersVisible = LAYER_OPTIONS.every((option) => layerVisibility[option.id] !== false);
  const readingSurface = (
    <ReaderSurface
      document={currentDocument}
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
      layerVisibility={layerVisibility}
      onMaster={toggleMastery}
      onDelete={deleteExplanation}
      onFocus={focusExplanation}
      onProgress={persistProgress}
      initialScrollTop={sessions[currentDocument.id]?.scrollTop || 0}
      focusRange={focusRange}
      onAnalyzeDocument={analyzeDocument}
      analysisBusy={busyAction === 'analysis'}
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
          {/* 验证版路由没有全局导航，头部提供回首页入口（首页自带导航，不重复渲染） */}
          {!isHomeLayout && (
            <Tooltip content="回到首页（新建/导入文档）">
              <Link
                href="/"
                aria-label="回到首页"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-gray-200 text-gray-600 outline-none hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-gray-400"
              >
                <Home size={18} />
              </Link>
            </Tooltip>
          )}
          <Tooltip content={isDesktop && !isHomeLayout ? (libraryCollapsed ? '展开文档库' : '折叠文档库') : '打开文档库'}>
            <button
              type="button"
              onClick={() => {
                if (isDesktop && !isHomeLayout) updateLibraryCollapsed(!libraryCollapsed);
                else setLibraryOpen(true);
              }}
              aria-label={isDesktop && !isHomeLayout ? (libraryCollapsed ? '展开文档库' : '折叠文档库') : '打开文档库'}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-gray-200 text-gray-600 outline-none hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-gray-400"
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
          {/* 显示组：多选辅助 + 层级可见性常驻可见；生成/管理动作收纳进右侧下拉 */}
          <div className="flex shrink-0 items-center gap-1 rounded-md border border-gray-200 bg-[#fafafa] p-1">
            <div className="flex items-center gap-1" aria-label="内联辅助显示">
              {AID_OPTIONS.map((option) => {
                const active = Boolean(aidVisibility[option.id]);
                const tooltip = option.id === 'precision'
                  ? (active ? '还原原文（关闭精准替代）' : '应用精准替代：把难懂表述替换为易懂释义')
                  : `在原文中${active ? '隐藏' : '显示'}${option.label}`;
                return (
                  <Tooltip key={option.id} content={tooltip}>
                    <button
                      type="button"
                      onClick={() => toggleAid(option.id)}
                      aria-pressed={active}
                      aria-label={`${active ? '关闭' : '打开'}${option.label}`}
                      className={`flex h-8 items-center gap-1.5 rounded border px-2 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-gray-400 ${active ? 'border-gray-300 bg-white text-gray-900 shadow-sm' : 'border-transparent text-gray-400 hover:bg-white'}`}
                    >
                      {option.id === 'explanations'
                        ? <MessageSquareText size={14} />
                        : option.id === 'diagrams'
                          ? <Network size={14} />
                          : <WandSparkles size={14} />}
                      {option.label}
                    </button>
                  </Tooltip>
                );
              })}
            </div>
            <span className="h-5 w-px bg-gray-200" aria-hidden="true" />
            {/* 重点不是一个独立模式：层级是重点的内部选项，在重点下拉里多选叠加 */}
            <div className="relative">
              <Tooltip content="显示原文重点，并选择要叠加展示的重点层级（文章/段落/句子/词语）">
                <button
                  type="button"
                  onClick={() => {
                    setLayerMenuOpen((open) => !open);
                    setGenerateMenuOpen(false);
                    setMoreMenuOpen(false);
                  }}
                  aria-label="重点可见层级"
                  aria-expanded={layerMenuOpen}
                  className={`flex h-8 items-center gap-1.5 rounded border px-2 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-gray-400 ${anyLayerVisible ? 'border-gray-300 bg-white text-gray-900 shadow-sm' : 'border-transparent text-gray-400 hover:bg-white'}`}
                >
                  <Highlighter size={14} />
                  重点
                  <ChevronDown size={12} aria-hidden="true" />
                </button>
              </Tooltip>
              {layerMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" aria-hidden="true" onClick={() => setLayerMenuOpen(false)} />
                  <div className="absolute right-0 top-9 z-50 w-52 rounded-md border border-zinc-200 bg-white p-2 shadow-lg">
                    <p className="px-2 pb-1 text-[11px] text-gray-500">重点层级（多选叠加）</p>
                    {LAYER_OPTIONS.map((option) => (
                      <label
                        key={option.id}
                        className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
                      >
                        <input
                          type="checkbox"
                          checked={layerVisibility[option.id] !== false}
                          onChange={() => updateLayerVisibility({ ...layerVisibility, [option.id]: layerVisibility[option.id] === false })}
                          className="h-3.5 w-3.5 accent-teal-600"
                        />
                        {option.label}
                      </label>
                    ))}
                    <button
                      type="button"
                      onClick={() => updateLayerVisibility(
                        allLayersVisible
                          ? Object.fromEntries(LAYER_OPTIONS.map((option) => [option.id, false]))
                          : { ...DEFAULT_LAYERS }
                      )}
                      className="mt-1 w-full rounded border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
                    >
                      {allLayersVisible ? '全部隐藏' : '全部展示'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
          {/* 生成组：AI 生成动作收纳进一个下拉，入口按钮承载忙碌状态 */}
          <div className="relative shrink-0">
            <Tooltip content="为当前文档生成 AI 辅助（图表/重点/解读/闪卡）">
              <button
                type="button"
                onClick={() => {
                  setGenerateMenuOpen((open) => !open);
                  setLayerMenuOpen(false);
                  setMoreMenuOpen(false);
                }}
                aria-label="生成 AI 辅助"
                className="flex h-9 shrink-0 items-center gap-1.5 rounded border border-gray-200 px-2.5 text-xs font-medium text-gray-600 outline-none hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-gray-400"
              >
                {busyAction || diagramState.isGenerating ? <LoaderCircle size={15} className="animate-spin" /> : <Sparkles size={15} />}
                生成
                <ChevronDown size={13} aria-hidden="true" />
              </button>
            </Tooltip>
            {generateMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" aria-hidden="true" onClick={() => setGenerateMenuOpen(false)} />
                <div className="absolute right-0 top-10 z-50 w-60 rounded-md border border-zinc-200 bg-white p-1.5 shadow-lg">
                  <button
                    type="button"
                    onClick={() => { setGenerateMenuOpen(false); generateFullDiagram(); }}
                    disabled={diagramState.isGenerating}
                    title="梳理全文概念与关系，生成整篇关系图"
                    className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs text-gray-700 outline-none hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-gray-400 disabled:cursor-not-allowed disabled:text-gray-300"
                  >
                    <Waypoints size={14} className="shrink-0" />
                    <span className="min-w-0 flex-1">生成图表</span>
                    {diagramState.isGenerating && <LoaderCircle size={13} className="animate-spin text-gray-400" aria-hidden="true" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setGenerateMenuOpen(false); analyzeHighlights(); }}
                    disabled={Boolean(busyAction)}
                    title="按层级高亮原文重点，不插入行间解读"
                    className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs text-gray-700 outline-none hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-gray-400 disabled:cursor-not-allowed disabled:text-gray-300"
                  >
                    <Highlighter size={14} className="shrink-0" />
                    <span className="min-w-0 flex-1">生成重点</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => { setGenerateMenuOpen(false); analyzeInlineAid(); }}
                    disabled={Boolean(busyAction)}
                    title="在重点旁插入行间解读卡"
                    className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs text-gray-700 outline-none hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-gray-400 disabled:cursor-not-allowed disabled:text-gray-300"
                  >
                    <Sparkles size={14} className="shrink-0" />
                    <span className="min-w-0 flex-1">生成解读</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => { setGenerateMenuOpen(false); generateFlashcards(); }}
                    disabled={Boolean(busyAction)}
                    title="基于重点生成间隔重复闪卡"
                    className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs text-gray-700 outline-none hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-gray-400 disabled:cursor-not-allowed disabled:text-gray-300"
                  >
                    <Brain size={14} className="shrink-0" />
                    <span className="min-w-0 flex-1">生成闪卡</span>
                  </button>
                  {(() => {
                    const presets = getConfig()?.promptPresets || [];
                    if (presets.length === 0) return null;
                    return (
                      <label className="mt-1 block border-t border-gray-100 px-2 pb-1.5 pt-2 text-[11px] text-gray-500">
                        提示词预设（视角/身份）
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
                          className="mt-1 w-full rounded border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700 outline-none focus-visible:ring-2 focus-visible:ring-gray-400"
                        >
                          <option value="">无预设</option>
                          {presets.map((preset) => (
                            <option key={preset.id} value={preset.id}>{preset.name || '未命名预设'}</option>
                          ))}
                        </select>
                      </label>
                    );
                  })()}
                </div>
              </>
            )}
          </div>
          {/* 管理组：自定义动作与术语表收纳进「更多」 */}
          <div className="relative shrink-0">
            <Tooltip content="自定义动作与术语表管理">
              <button
                type="button"
                onClick={() => {
                  setMoreMenuOpen((open) => !open);
                  setLayerMenuOpen(false);
                  setGenerateMenuOpen(false);
                }}
                aria-label="更多管理项"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-gray-200 text-gray-600 outline-none hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-gray-400"
              >
                <MoreHorizontal size={17} />
              </button>
            </Tooltip>
            {moreMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" aria-hidden="true" onClick={() => setMoreMenuOpen(false)} />
                <div className="absolute right-0 top-10 z-50 w-48 rounded-md border border-zinc-200 bg-white p-1.5 shadow-lg">
                  <button
                    type="button"
                    onClick={() => { setMoreMenuOpen(false); setCustomActionsOpen(true); }}
                    className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs text-gray-700 outline-none hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-gray-400"
                  >
                    <WandSparkles size={14} className="shrink-0" />
                    选区自定义动作
                  </button>
                  <button
                    type="button"
                    onClick={() => { setMoreMenuOpen(false); setGlossaryOpen(true); }}
                    className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs text-gray-700 outline-none hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-gray-400"
                  >
                    <BookMarked size={14} className="shrink-0" />
                    术语表（AI 背景定义）
                  </button>
                </div>
              </>
            )}
          </div>
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
              {!isHomeLayout && !libraryCollapsed && (
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
              <ResizableHandle />
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
        <GlossaryManager
          isOpen={glossaryOpen}
          onClose={() => setGlossaryOpen(false)}
          entries={glossary}
          onSave={saveGlossaryEntry}
          onRemove={removeGlossaryEntry}
        />
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
