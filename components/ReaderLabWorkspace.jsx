'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  Brain,
  CheckCircle2,
  ChevronDown,
  Highlighter,
  Library,
  LoaderCircle,
  MessageSquareText,
  MoreHorizontal,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Sparkles,
  TriangleAlert,
  WandSparkles,
  Waypoints,
} from 'lucide-react';
import DocumentLibrary from '@/components/reader-lab/DocumentLibrary';
import DocumentDiagramPanel from '@/components/reader-lab/DocumentDiagramPanel';
import DocumentDiagramCanvas from '@/components/reader-lab/DocumentDiagramCanvas';
import { useDocumentDiagram } from '@/components/reader-lab/use-document-diagram';
import ReaderHome from '@/components/reader-lab/ReaderHome';
import KnowledgePanel from '@/components/reader-lab/KnowledgePanel';
import ReaderSurface from '@/components/reader-lab/ReaderSurface';
import HistoryModal from '@/components/HistoryModal';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { Sheet, SheetClose, SheetContent } from '@/components/ui/sheet';
import { Tooltip, TooltipProvider } from '@/components/ui/tooltip';
import { getConfig, isConfigValid } from '@/lib/config';
import {
  createDocumentDrawingId,
  createStandaloneDiagramDocument,
  finalizeDiagramSource,
  STANDALONE_DIAGRAM_DOCUMENT_ID,
} from '@/lib/diagram-generation';
import { readerRoleLayer } from '@/lib/reader-analysis';
import {
  createReaderDocumentFromFile,
  createReaderDocumentFromPaste,
  createReaderDocumentFromUrl,
  normalizeReaderDocumentContent,
} from '@/lib/reader-document';
import { isEpubFile, parseEpubFile } from '@/lib/epub-import';
import {
  createCustomAction,
  createDemoCustomActions,
  CUSTOM_ACTION_SELECTION_PLACEHOLDER,
  MAX_CUSTOM_ACTION_NAME_LENGTH,
  MAX_CUSTOM_ACTION_TEMPLATE_LENGTH,
} from '@/lib/custom-actions';
import { isDefaultToolbarBuiltinTemplate, mergeToolbarBuiltins, toToolbarBuiltinOverrides } from '@/lib/toolbar-builtins';
import CustomActionsManager from '@/components/reader-lab/CustomActionsManager';
import GlossaryManager from '@/components/reader-lab/GlossaryManager';
import WorkspaceSyncPanel from '@/components/reader-lab/WorkspaceSyncPanel';
import PrivacyNoticeBar from '@/components/reader-lab/PrivacyNoticeBar';
import Modal from '@/components/ui/Modal';
import { useLocale } from '@/components/LocaleProvider';
import {
  batchAnchorKey,
  calculateReadingProgress,
  combineKnownMasteredTerms,
  createReaderLabAnalysisRecords,
  createReaderLabExplanation,
  createReaderLabSeedDocuments,
  createReaderLabTerms,
  createReviewState,
  dedupeBatchAnalysisRecords,
  listExplainedTerms,
  listMasteredTerms,
  mergeKnownTerm,
  migrateBatchAnalysisMappings,
  recordsForDocument,
  repairDemoPlaceholderRecords,
  repairDemoPlaceholderTerms,
  createDemoGlossary,
} from '@/lib/reader-lab';
import { workspaceRepository } from '@/lib/local-workspace-db';
import { mergeInboxPayload } from '@/lib/inbox-merge';
import { isDerivationStale } from '@/lib/provenance';
import { flashcardStore } from '@/lib/flashcard-store';
import { historyManager } from '@/lib/history-manager';
import { downloadWorkspaceFile, exportWorkspace, supportsSaveFilePicker, saveWorkspaceFileWithPicker } from '@/lib/workspace-file';
import { buildAnkiText, downloadAnkiFile } from '@/lib/anki-export';
import { buildObsidianVaultNotes, downloadObsidianZip, supportsDirectoryPicker, saveObsidianNotesToDirectory } from '@/lib/obsidian-export';
import { createLocalDemoDrawing } from '@/lib/excalidraw-runtime-demo';
import {
  markReaderSampleSeeded,
  READER_DIAGRAM_SAMPLE_SEEDED_KEY,
  READER_DOCUMENT_SAMPLES_SEEDED_KEY,
  shouldSeedReaderSample,
} from '@/lib/reader-sample-seeding';
import { createDiagramGenerationPlan, DIAGRAM_SCOPES } from '@/lib/diagram-product';
import {
  ensureDiagramRouteId,
  isDiagramRouteId,
  normalizeDiagramRouteIds,
} from '@/lib/diagram-route-id';
import { DIAGRAM_AGENT_DRAWING_EVENT } from '@/components/DiagramAgentBridge';
import {
  ensureDocumentRouteId,
  findDocumentByRouteId,
  isDocumentRouteId,
  normalizeDocumentRouteIds,
} from '@/lib/document-route-id';

// 阅读辅助都是叠加在原文之上的可选层：多选多生效，全部关闭即纯原文
// label 渲染时经 i18n 键 workspace.aid.* 取，常量只保留稳定 id
const AID_OPTIONS = Object.freeze([
  { id: 'explanations' },
  { id: 'diagrams' },
  { id: 'precision' },
]);

// 层级化重点可见性：可全部展示，也可只展示某一层（如只看文章层中心论点）
const LAYER_OPTIONS = Object.freeze([
  { id: 'article' },
  { id: 'paragraph' },
  { id: 'sentence' },
  { id: 'word' },
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

// 白话解释深度档位：与重点层级同为阅读偏好，localStorage 持久化
// 档位以读者对文档的熟悉度命名：初次接触需要全面拆解，熟练掌握只需点拨生僻处
// 冒号后统一为“解释 + 覆盖范围”的并列结构，与后端提示词档位语义一一对应
const EXPLANATION_DEPTH_OPTIONS = Object.freeze([
  { id: 'deep' },
  { id: 'standard' },
  { id: 'light' },
]);

// 白话呈现方式：两种形态共用同一批映射，只决定“替你看”还是“教你认”；localStorage 持久化
const CLOZE_PRESENTATION_OPTIONS = Object.freeze([
  { id: 'plain' },
  { id: 'original' },
]);

function readStoredClozePresentation() {
  if (typeof window === 'undefined') return 'plain';
  return window.localStorage.getItem('anchor-read-cloze-presentation') === 'original' ? 'original' : 'plain';
}

// 按文档分组的填空揭示态（两种呈现共用）：{ [documentId]: { [mappingKey]: 1 } }
function readStoredClozeMap(storageKey) {
  if (typeof window === 'undefined') return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function readStoredExplanationDepth() {
  if (typeof window === 'undefined') return 'standard';
  const stored = window.localStorage.getItem('anchor-read-explanation-depth') || '';
  return EXPLANATION_DEPTH_OPTIONS.some((option) => option.id === stored) ? stored : 'standard';
}

// 浮动工具栏内置动作偏好（启用/改名）持久化，刷新后保持
function readStoredToolbarBuiltins() {
  if (typeof window === 'undefined') return mergeToolbarBuiltins(null);
  try {
    const stored = JSON.parse(window.localStorage.getItem('anchor-read-toolbar-builtins') || 'null');
    return mergeToolbarBuiltins(stored);
  } catch {
    // 解析失败回退默认内置动作
  }
  return mergeToolbarBuiltins(null);
}

// 打开文档的默认形态：默认分析产出重点、解读与白话替换，三者默认选中；图解开关开启，生成后即显示
const DEFAULT_AIDS = Object.freeze({ explanations: true, diagrams: true, precision: true });

// 所有 AI 能力依赖模型配置：未配置时统一报错阻断，不再提供本地 Demo 兜底
// 错误带 i18n 键：catch 侧经 errorNotice() 转成 messageKey，由通知条按当前语言渲染
function i18nError(messageKey, params) {
  const error = new Error(messageKey);
  error.messageKey = messageKey;
  error.params = params;
  return error;
}

// 错误转通知：带 i18n 键的错误走渲染时翻译，其余保留原文（动态错误信息残差点）
function errorNotice(error) {
  return error?.messageKey
    ? { type: 'error', messageKey: error.messageKey, params: error.params }
    : { type: 'error', message: error.message };
}

// 全局顶栏「配置 → 浮动工具栏」广播：工作台监听后打开浮动工具栏配置弹窗
export const OPEN_TOOLBAR_CONFIG_EVENT = 'anchor-read:open-toolbar-config';

// 全局顶栏「配置 → 术语表」广播：工作台监听后打开术语表管理弹窗
export const OPEN_GLOSSARY_EVENT = 'anchor-read:open-glossary';

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
  // 导航「图解」入口的独立图解工作区：图解挂在保留虚拟文档下，不绑定当前阅读文档
  standaloneDiagram = false,
  requestedDrawingId = '',
  requestedDocumentId = '',
  newDiagramRequestKey = '',
  requestedReaderDocumentId = '',
  readerDocumentRequestKey = '',
  onToolChange,
  onOpenHistory,
  onCurrentDocumentChange,
  historyDrawing,
  headerStatus = null,
  // 首页 Hero 的「新建图解」和最近图解区的图解库入口由宿主页面分别提供
  onCreateDiagram = () => {},
  onOpenDiagram = () => {},
  onDiagramResolved = () => {},
  onDocumentResolved = () => {},
  onOpenDocumentLibrary = null,
}) {
  const { t } = useLocale();
  const isHomeLayout = layout === 'home';
  const [homeStarted, setHomeStarted] = useState(!isHomeLayout || started);

  // 宿主把 started 拉回 false 时（顶栏点「首页」）同步回到首页视图
  useEffect(() => {
    if (isHomeLayout && !started) setHomeStarted(false);
  }, [isHomeLayout, started]);

  // 全局顶栏「配置 → 浮动工具栏」广播事件：在工作台内打开浮动工具栏配置弹窗
  useEffect(() => {
    const handleOpenToolbarConfig = () => setCustomActionsOpen(true);
    window.addEventListener(OPEN_TOOLBAR_CONFIG_EVENT, handleOpenToolbarConfig);
    return () => window.removeEventListener(OPEN_TOOLBAR_CONFIG_EVENT, handleOpenToolbarConfig);
  }, []);

  // 全局顶栏「配置 → 术语表」广播事件：在工作台内打开术语表管理弹窗
  useEffect(() => {
    const handleOpenGlossary = () => setGlossaryOpen(true);
    window.addEventListener(OPEN_GLOSSARY_EVENT, handleOpenGlossary);
    return () => window.removeEventListener(OPEN_GLOSSARY_EVENT, handleOpenGlossary);
  }, []);
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
  // 目录抽屉开关，持久化到本地；目录是当前文档内导航，抽屉覆盖在阅读区左侧，不挤占布局
  const [outlineOpen, setOutlineOpen] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('anchor-read-outline-open') === '1';
  });
  const toggleOutline = () => {
    const next = !outlineOpen;
    setOutlineOpen(next);
    localStorage.setItem('anchor-read-outline-open', next ? '1' : '0');
  };
  const updateLibraryCollapsed = (collapsed) => {
    setLibraryCollapsed(collapsed);
    if (typeof window !== 'undefined') {
      localStorage.setItem('anchor-read-library-collapsed', collapsed ? '1' : '0');
    }
  };
  // 桌面右侧面板折叠状态，持久化到本地，与左侧文档库成左右对称的开关
  const [rightCollapsed, setRightCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('anchor-read-right-collapsed') === '1';
  });
  const updateRightCollapsed = (collapsed) => {
    setRightCollapsed(collapsed);
    if (typeof window !== 'undefined') {
      localStorage.setItem('anchor-read-right-collapsed', collapsed ? '1' : '0');
    }
  };
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const [busyAction, setBusyAction] = useState('');
  const [notice, setNotice] = useState(null);
  const [isDesktop, setIsDesktop] = useState(false);
  const [isWide, setIsWide] = useState(false);
  const [focusRange, setFocusRange] = useState(null);
  // 白话 Tab 定位：无坐标/无关联解读的词条（批量术语、点击回灌词条）交给阅读面按文本匹配定位，
  // nonce 支持重复触发同一条
  const [focusTermSignal, setFocusTermSignal] = useState(null);
  // 左→右定位信号：点击原文高亮/框线后驱动知识面板滚到对应卡片，nonce 支持重复触发同一条
  const [panelFocus, setPanelFocus] = useState(null);
  const [rightPanelView, setRightPanelView] = useState(requestedTool === 'diagram' ? 'diagram' : 'knowledge');
  const [drawings, setDrawings] = useState([]);
  const [activeDrawingId, setActiveDrawingId] = useState('');
  const [diagramAnchor, setDiagramAnchor] = useState(null);
  // 划词图解生成中的锚点：驱动选区下方的占位卡，完成后被正式图解卡替换
  const [pendingInlineDiagram, setPendingInlineDiagram] = useState(null);
  // 划词图解留在原文就地插入的标记：createDrawing 据此跳过切换到图解画布
  const inlineDiagramRef = useRef(false);
  const [flashcardPanelSignal, setFlashcardPanelSignal] = useState(0);
  const [aidVisibility, setAidVisibility] = useState({ ...DEFAULT_AIDS });
  // 层级重点可见性偏好持久化，刷新后保持
  const [layerVisibility, setLayerVisibility] = useState(readStoredLayerVisibility);
  const [layerMenuOpen, setLayerMenuOpen] = useState(false);
  // 白话与重点同形态：入口是带下拉的 tab，档位选择收纳在下拉里
  const [precisionMenuOpen, setPrecisionMenuOpen] = useState(false);
  const [explanationDepth, setExplanationDepth] = useState(readStoredExplanationDepth);
  // 白话呈现方式与填空揭示态：两种呈现共用一份按文档持久化的揭示记录，刷新不丢；
  // 点击 chip = “我需要记住”翻转并持久化揭示，悬浮只做临时换显
  const [clozePresentation, setClozePresentation] = useState(readStoredClozePresentation);
  const [clozeRevealed, setClozeRevealed] = useState(() => readStoredClozeMap('anchor-read-cloze-revealed'));
  // 当前文档的填空揭示集合：装饰层按 Set 判定持久揭示态；
  // hooks 必须位于所有条件提前 return 之前，否则触发 Rules of Hooks 顺序错误
  const revealedClozeKeys = useMemo(() => new Set(Object.keys(clozeRevealed[currentDocumentId] || {})), [clozeRevealed, currentDocumentId]);
  // 已掌握术语名集合（主名+别名，小写）：装饰层据此淡出——框选/替换/chip 都不再绘制，词回到正文
  const masteredClozeTerms = useMemo(() => {
    const names = new Set();
    for (const term of terms) {
      if (term.status !== 'mastered') continue;
      const main = term.term?.trim().toLowerCase();
      if (main) names.add(main);
      for (const alias of term.aliases || []) {
        const normalized = typeof alias === 'string' ? alias.trim().toLowerCase() : '';
        if (normalized) names.add(normalized);
      }
    }
    return names;
  }, [terms]);
  // 头部动作收纳：生成与管理合并进一个下拉，减少顶栏按钮数
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [internalHistoryOpen, setInternalHistoryOpen] = useState(false);
  const [customActions, setCustomActions] = useState([]);
  const [customActionsOpen, setCustomActionsOpen] = useState(false);
  // 浮动工具栏内置动作配置：与自定义动作统一在同一弹窗管理
  const [toolbarBuiltins, setToolbarBuiltins] = useState(readStoredToolbarBuiltins);
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
  const appliedDiagramRequestRef = useRef('');
  const appliedReaderDocumentRequestRef = useRef('');

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

  // 宽屏判定：图解形态下原文与画布分栏并排，窄屏退回整块画布
  useEffect(() => {
    const media = window.matchMedia('(min-width: 1280px)');
    const update = () => setIsWide(media.matches);
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
        const shouldSeedDocuments = shouldSeedReaderSample({
          storage: window.localStorage,
          key: READER_DOCUMENT_SAMPLES_SEEDED_KEY,
          existingCount: storedReaderDocuments.length,
        });
        if (shouldSeedDocuments) {
          for (const seed of seedDocuments) byId.set(seed.id, seed);
        }
        const documentsBeforeRouteMigration = [...byId.values()];
        const normalizedDocuments = normalizeDocumentRouteIds(documentsBeforeRouteMigration);
        const storedDocumentIds = new Set(storedReaderDocuments.map((document) => document.id));
        for (const [index, document] of normalizedDocuments.entries()) {
          if (document !== documentsBeforeRouteMigration[index] || !storedDocumentIds.has(document.id)) {
            await workspaceRepository.documents.save(document);
          }
        }
        byId.clear();
        for (const document of normalizedDocuments) byId.set(document.id, document);
        markReaderSampleSeeded(window.localStorage, READER_DOCUMENT_SAMPLES_SEEDED_KEY);

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

        // 全新工作区只种入一次可编辑图解；用户删除后刷新不再自动补回。
        const localDemoDrawing = storedDrawings.find((drawing) => drawing.isLocalDemo);
        const shouldSeedDiagram = !localDemoDrawing && shouldSeedReaderSample({
          storage: window.localStorage,
          key: READER_DIAGRAM_SAMPLE_SEEDED_KEY,
          existingCount: storedDrawings.length,
        });
        const seededDemoDrawing = shouldSeedDiagram ? createLocalDemoDrawing() : null;
        const drawingsWithDemo = seededDemoDrawing
          ? [seededDemoDrawing, ...storedDrawings]
          : storedDrawings;
        const normalizedDrawings = normalizeDiagramRouteIds(drawingsWithDemo);
        for (const [index, drawing] of normalizedDrawings.entries()) {
          if (drawing !== drawingsWithDemo[index]) await workspaceRepository.drawings.save(drawing);
        }
        markReaderSampleSeeded(window.localStorage, READER_DIAGRAM_SAMPLE_SEEDED_KEY);

        const readerSessions = storedSessions.filter((session) => session.readerLab);
        const sessionMap = Object.fromEntries(readerSessions.map((session) => [session.documentId, session]));
        const seedIds = new Set(seedDocuments.map((seed) => seed.id));
        const importedDocuments = [...byId.values()]
          .filter((document) => !seedIds.has(document.id) && document.status !== 'archived')
          .sort((left, right) => right.updatedAt - left.updatedAt);
        const nextDocuments = [
          ...importedDocuments,
          ...seedDocuments.map((seed) => byId.get(seed.id)).filter(Boolean),
        ];
        const initialId = readerSessions[0]?.documentId && byId.has(readerSessions[0].documentId)
          ? readerSessions[0].documentId
          : (nextDocuments[0]?.id || '');

        setDocuments(nextDocuments);
        setSessions(sessionMap);
        // 重点批量与解读批量来自同一次分析，早期版本会在同一锚点重复建档，
        // 恢复时按锚点去重（解读优先）并从存储里清掉多余记录，保证每个锚点只有一条
        const readerExplanationsRaw = storedExplanations.filter((record) => record.readerLab || record.id?.startsWith('reader-lab-'));
        const { records: readerExplanations, removed: duplicatedBatchRecords } = dedupeBatchAnalysisRecords(readerExplanationsRaw);
        for (const record of duplicatedBatchRecords) {
          await Promise.all([
            workspaceRepository.explanations.remove(record.id),
            workspaceRepository.reviewStates.remove(reviewId(record.id)),
          ]);
        }
        // 旧版全文分析记录缺少 mappings 会让精准替代静默回退原文，恢复时统一迁移并持久化
        // 旧版解读文案带“通俗解读：”题头，现已废弃：恢复时统一剥离 display 与映射目标里的前缀，
        // 必须在 migrate 之前执行，否则整句替换的白话目标还会带着前缀上屏
        const stripLegacyExplanationPrefix = (value) => (
          typeof value === 'string' && value.startsWith('通俗解读：') ? value.slice('通俗解读：'.length) : value
        );
        const dePrefixedExplanations = readerExplanations.map((record) => {
          if (!record.explanation) return record;
          const nextDisplay = stripLegacyExplanationPrefix(record.explanation.display);
          const nextPlain = stripLegacyExplanationPrefix(record.explanation.plainExplanation);
          const nextMappings = Array.isArray(record.explanation.mappings)
            ? record.explanation.mappings.map((mapping) => ({ ...mapping, target: stripLegacyExplanationPrefix(mapping.target) }))
            : record.explanation.mappings;
          if (
            nextDisplay === record.explanation.display
            && nextPlain === record.explanation.plainExplanation
            && nextMappings === record.explanation.mappings
          ) return record;
          return { ...record, explanation: { ...record.explanation, display: nextDisplay, plainExplanation: nextPlain, mappings: nextMappings } };
        });
        const dePrefixChanges = dePrefixedExplanations.filter((record, index) => record !== readerExplanations[index]);
        const { records: migratedExplanations, migrated } = migrateBatchAnalysisMappings(dePrefixedExplanations);
        // 旧 Demo 占位文案（“本地示例替换”“本地 Demo 阅读辅助”）统一重写为真实值
        const { records: repairedExplanations, repaired: repairedRecords } = repairDemoPlaceholderRecords(migratedExplanations);
        for (const record of [...dePrefixChanges, ...migrated, ...repairedRecords]) await workspaceRepository.explanations.save(record);
        setExplanations(repairedExplanations);
        const { terms: repairedTerms, repaired: repairedTermList } = repairDemoPlaceholderTerms(
          storedTerms.filter((term) => term.readerLab || term.id?.startsWith('reader-lab-'))
        );
        for (const term of repairedTermList) await workspaceRepository.terms.save(term);
        setTerms(repairedTerms);
        setReviewStates(storedReviews.filter((state) => (
          (state.itemType === 'explanation' || state.id?.startsWith('reader-lab-review-')) &&
          byId.has(state.documentId)
        )));
        setDrawings(normalizedDrawings.filter((drawing) => (
          seedIds.has(drawing.documentId)
          || byId.has(drawing.documentId)
          // 独立图解工作区的自由图解挂在保留虚拟文档下，恢复时同样保留
          || drawing.documentId === STANDALONE_DIAGRAM_DOCUMENT_ID
        )));
        // 自定义动作与术语表为空时种子内置示例条目，降低上手门槛；执行仍依赖模型配置
        // 排序优先用显式 order 字段，存量数据回退创建时间
        const seededCustomActions = storedCustomActions.length > 0
          ? storedCustomActions.sort((left, right) => (left.order ?? left.createdAt) - (right.order ?? right.createdAt))
          : createDemoCustomActions();
        if (storedCustomActions.length === 0) {
          for (const action of seededCustomActions) await workspaceRepository.customActions.save(action);
        } else if (storedCustomActions.some((action) => !Number.isFinite(action.order))) {
          // 存量数据补齐 order，后续排序不再依赖创建时间
          for (const [index, action] of seededCustomActions.entries()) {
            await workspaceRepository.customActions.save({ ...action, order: index });
          }
        }
        setCustomActions(seededCustomActions);
        const seededGlossary = storedGlossary.length > 0 ? storedGlossary : createDemoGlossary();
        if (storedGlossary.length === 0) {
          for (const entry of seededGlossary) await workspaceRepository.glossary.save(entry);
        }
        setGlossary(seededGlossary);
        const initialDrawing = normalizedDrawings.find((drawing) => drawing.documentId === initialId);
        setActiveDrawingId(sessionMap[initialId]?.activeDrawingId || initialDrawing?.id || '');
        setCurrentDocumentId(initialId);
        setAidVisibility(sessionAids(sessionMap[initialId]));
      } catch (error) {
        console.error('Failed to restore reader lab:', error);
        setNotice({ type: 'error', messageKey: 'workspace.notice.restoreFailed' });
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

  // 独立图解工作区把图解链路（画布/对话/历史）全部绑到保留虚拟文档，
  // 与当前打开文档的绑定图解互不干扰
  const diagramDocumentId = standaloneDiagram ? STANDALONE_DIAGRAM_DOCUMENT_ID : currentDocumentId;
  const diagramDocument = standaloneDiagram ? createStandaloneDiagramDocument() : currentDocument;

  // 切入独立图解工作区时恢复自由图解的活动项，不带入文档绑定图解的 activeDrawingId
  useEffect(() => {
    if (!standaloneDiagram) return;
    setActiveDrawingId(sessionsRef.current[STANDALONE_DIAGRAM_DOCUMENT_ID]?.activeDrawingId || '');
  }, [standaloneDiagram]);
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
    const selectedDocument = documents.find((document) => document.id === documentId);
    if (selectedDocument) onDocumentResolved(selectedDocument);
    setCurrentDocumentId(documentId);
    setAidVisibility(sessionAids(sessions[documentId]));
    setLibraryOpen(false);
    setNotice(null);
    const nextDrawing = drawings.find((drawing) => drawing.documentId === documentId);
    setActiveDrawingId(sessions[documentId]?.activeDrawingId || nextDrawing?.id || '');
    saveSession(documentId, {}).catch(console.error);
    // 在独立图解工作区里选文档意味着回去阅读：退出独立形态，图解回到文档绑定
    if (standaloneDiagram) {
      setRightPanelView('knowledge');
      onToolChange?.('read');
    }
  }, [documents, drawings, onDocumentResolved, onToolChange, saveSession, sessions, standaloneDiagram]);

  useEffect(() => {
    if (!ready || !requestedReaderDocumentId || !readerDocumentRequestKey) return undefined;
    if (appliedReaderDocumentRequestRef.current === readerDocumentRequestKey) return undefined;
    appliedReaderDocumentRequestRef.current = readerDocumentRequestKey;
    let cancelled = false;

    (async () => {
      try {
        let target = findDocumentByRouteId(documents, requestedReaderDocumentId);
        if (!target) target = await workspaceRepository.documents.get(requestedReaderDocumentId);
        if (!target) {
          const storedDocuments = await workspaceRepository.documents.list();
          target = findDocumentByRouteId(storedDocuments, requestedReaderDocumentId);
        }
        if (target && !isDocumentRouteId(target.routeId)) {
          const usedRouteIds = new Set(documents.map((document) => document.routeId).filter(isDocumentRouteId));
          target = ensureDocumentRouteId(target, usedRouteIds);
          await workspaceRepository.documents.save(target);
        }
        if (!target || cancelled) {
          if (!cancelled) onDocumentResolved(null);
          return;
        }
        const targetWasLoaded = documents.some((document) => document.id === target.id);
        setDocuments((current) => current.some((document) => document.id === target.id)
          ? current
          : [target, ...current]);
        if (!targetWasLoaded) onDocumentResolved(target);
        selectDocument(target.id);
        setRightPanelView('knowledge');
        setHomeStarted(true);
      } catch (error) {
        if (!cancelled) setNotice(errorNotice(error));
      }
    })();

    return () => { cancelled = true; };
  }, [documents, onDocumentResolved, readerDocumentRequestKey, ready, requestedReaderDocumentId, selectDocument]);

  // 多选辅助开关：任何变更立即持久化到当前文档会话，每篇文档记住自己的阅读组合
  const updateAids = useCallback((nextAids) => {
    setAidVisibility(nextAids);
    if (currentDocumentId) saveSession(currentDocumentId, { aids: nextAids }).catch(console.error);
  }, [currentDocumentId, saveSession]);

  const toggleAid = useCallback((aidId) => {
    const next = { ...aidVisibility, [aidId]: !aidVisibility[aidId] };
    updateAids(next);
    // 白话关闭时清空当前文档的翻开态，下次开启从“全部盖住”重新开始
    if (aidId === 'precision' && next.precision === false) {
      setClozeRevealed((prev) => {
        if (!prev[currentDocumentId]) return prev;
        const nextMap = { ...prev };
        delete nextMap[currentDocumentId];
        return nextMap;
      });
    }
  }, [aidVisibility, updateAids, currentDocumentId]);

  const updateLayerVisibility = useCallback((next) => {
    setLayerVisibility(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('anchor-read-layer-visibility', JSON.stringify(next));
    }
  }, []);

  // 白话解释深度：切换立即持久化，下次一键分析时随 payload 生效
  const updateExplanationDepth = useCallback((depth) => {
    setExplanationDepth(depth);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('anchor-read-explanation-depth', depth);
    }
  }, []);

  // 白话呈现方式：切换立即持久化，两种形态共用同一批映射数据
  const updateClozePresentation = useCallback((mode) => {
    setClozePresentation(mode);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('anchor-read-cloze-presentation', mode);
    }
  }, []);

  // 填空揭示（两种呈现共用）：点击即“我需要记住”——首点揭示并记住，再点收回并忘掉；
  // 按文档记录并持久化，刷新后已记住的词直接显示另一面；首点同时把术语回灌术语表（收集层只增，
  // 收回只清揭示态，词条保留，删除是术语表里的显式管理动作）
  const toggleCloze = useCallback(async (key) => {
    if (!key) return;
    const alreadyRevealed = Boolean(clozeRevealed[currentDocumentId]?.[key]);
    setClozeRevealed((prev) => {
      const forDoc = { ...(prev[currentDocumentId] || {}) };
      if (forDoc[key]) delete forDoc[key];
      else forDoc[key] = 1;
      return { ...prev, [currentDocumentId]: forDoc };
    });
    if (alreadyRevealed) return;
    const [source = '', target = ''] = key.split('\u0000');
    const normalized = source.trim().toLowerCase();
    if (!normalized) return;
    // 同名术语（含别名）已在表中则不重复入库，状态以术语表为准
    const duplicated = terms.some((item) => (
      item.normalizedTerm === normalized
      || item.term?.trim().toLowerCase() === normalized
      || (item.aliases || []).includes(normalized)
    ));
    if (duplicated) return;
    const now = Date.now();
    const record = {
      id: `reader-lab-term-${currentDocumentId}-${now}-cloze`,
      documentId: currentDocumentId,
      explanationId: '',
      term: source.trim(),
      normalizedTerm: normalized,
      aliases: [],
      status: 'learning',
      explanation: target.trim(),
      readerLab: true,
      createdAt: now,
      updatedAt: now,
    };
    await workspaceRepository.terms.save(record);
    setTerms((current) => [...current, record]);
  }, [currentDocumentId, clozeRevealed, terms]);

  // 掌握淡出：术语标记掌握后清掉其全工作区的持久揭示态——脚手架的存在是为了消失，
  // 已掌握的词回到正文成为普通文本（按主名与别名匹配映射的 source 端）
  const fadeRevealedForTerms = useCallback((list) => {
    const names = new Set();
    for (const term of list || []) {
      const main = term?.term?.trim().toLowerCase();
      if (main) names.add(main);
      for (const alias of term?.aliases || []) {
        const normalized = typeof alias === 'string' ? alias.trim().toLowerCase() : '';
        if (normalized) names.add(normalized);
      }
    }
    if (names.size === 0) return;
    setClozeRevealed((prev) => {
      let changed = false;
      const next = {};
      for (const [docId, map] of Object.entries(prev)) {
        const kept = {};
        for (const [key, value] of Object.entries(map || {})) {
          if (names.has(key.split('\u0000')[0].trim().toLowerCase())) { changed = true; continue; }
          kept[key] = value;
        }
        next[docId] = kept;
      }
      return changed ? next : prev;
    });
  }, []);

  // 填空揭示记录随状态整体落盘：初始挂载的回写幂等，写入成本与术语量同级
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('anchor-read-cloze-revealed', JSON.stringify(clozeRevealed));
    }
  }, [clozeRevealed]);

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
    const usedRouteIds = new Set(documents.map((item) => item.routeId).filter(isDocumentRouteId));
    const nextDocument = ensureDocumentRouteId(document, usedRouteIds);
    await workspaceRepository.documents.save(nextDocument);
    for (const record of analysisRecords) await workspaceRepository.explanations.save(record);
    // 导入即分析时同样把派生术语写入术语库，保持与工作台「分析」按钮一致的术语沉淀
    const importedTerms = analysisRecords.flatMap((record) => record.terms || []);
    for (const term of importedTerms) await workspaceRepository.terms.save(term);
    setDocuments((current) => [nextDocument, ...current.filter((item) => item.id !== nextDocument.id)]);
    setExplanations((current) => [
      ...current.filter((record) => record.documentId !== document.id || !record.batchAnalysis),
      ...analysisRecords,
    ]);
    setTerms((current) => [
      ...current.filter((term) => !(term.documentId === document.id && term.batchAnalysis)),
      ...importedTerms,
    ]);
    setCurrentDocumentId(nextDocument.id);
    onDocumentResolved(nextDocument);
    setAidVisibility({ ...DEFAULT_AIDS });
    setLibraryOpen(false);
    setHomeStarted(true);
    await saveSession(nextDocument.id, { aids: DEFAULT_AIDS, progress: 0, scrollTop: 0 });
    setNotice({ type: 'success', messageKey: 'workspace.notice.imported', params: { title: nextDocument.title } });
  }, [documents, onDocumentResolved, saveSession]);

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
          // 服务端错误信息为动态内容，保留原文；仅回退文案走 i18n
          throw payload.error ? new Error(payload.error) : i18nError('workspace.notice.extractFailed');
        }
        if (cancelled) return;
        const document = createReaderDocumentFromUrl(
          { title: payload.title || '', content: payload.content, url: payload.sourceUrl || importUrl },
          { existingIds: documents.map((item) => item.id) }
        );
        await persistImportedDocument(document);
        if (cancelled) return;
        setCurrentDocumentId(document.id);
        setNotice({ type: 'success', messageKey: 'workspace.notice.importedFromExtension', params: { title: document.title } });
      } catch (error) {
        if (!cancelled) setNotice(error.message ? errorNotice(error) : { type: 'error', messageKey: 'workspace.notice.importFailed' });
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
      setNotice({ type: 'error', messageKey: 'workspace.notice.reflowMarkerMissing' });
      return undefined;
    }

    let cancelled = false;
    (async () => {
      setBusyAction('inbox');
      try {
        const payload = await requestInboxPayload();
        if (cancelled) return;
        if (!payload) throw i18nError('workspace.notice.inboxNotReceived');
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
        // 残差点：回流汇总由四段动态计数拼装，暂保留中文，待后续拆分键化
        setNotice({
          type: 'success',
          message: parts.length > 0 ? `已接收扩展采集：${parts.join('，')}。` : '已接收扩展回流，但没有可合并的新内容。',
        });
      } catch (error) {
        if (!cancelled) setNotice(error.message ? errorNotice(error) : { type: 'error', messageKey: 'workspace.notice.inboxFailed' });
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
      setNotice(errorNotice(error));
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
      setNotice(errorNotice(error));
      throw error;
    }
  }, [documents, persistImportedDocument]);

  const callExplainApi = useCallback(async (selectedText) => {
    const config = getConfig();
    const usePassword = hasPasswordMode();
    if (!usePassword && !isConfigValid(config)) {
      throw i18nError('workspace.configMissing');
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

  // 划词提问：内置提示词选区即触发，回答 + 候选词条一次返回
  const callAskApi = useCallback(async (selectedText) => {
    const config = getConfig();
    const usePassword = hasPasswordMode();
    if (!usePassword && !isConfigValid(config)) {
      throw i18nError('workspace.configMissing');
    }

    const headers = { 'Content-Type': 'application/json' };
    if (usePassword) {
      headers['x-access-password'] = localStorage.getItem('smart-excalidraw-access-password');
    }
    const response = await fetch('/api/ask', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        article: currentDocument.content,
        selectedText,
        // 术语表作为背景：已有定义的术语不会再被列为候选词条
        glossary: glossaryPayload,
        config: usePassword ? null : config,
      }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `提问失败 (${response.status})`);
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
      // 解释深度档位随阅读偏好（白话下拉里选择），控制 mapping 密度与 display 详尽度
      depth: explanationDepth,
      knownMasteredTerms,
      knownExplainedTerms,
      // 术语表单独交代定义背景：AI 沿用表中既定定义，不另造解释
      glossary: glossaryPayload,
      userContext: config?.userContext || '',
      promptPreset,
    };
    if (!usePassword && !isConfigValid(config)) {
      throw i18nError('workspace.configMissing');
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
  }, [currentDocument, glossaryPayload, knownMasteredWithGlossary, terms, activePromptPresetId, explanationDepth]);

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
        setNotice({ type: 'success', messageKey: 'workspace.notice.sameContentOpened' });
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
      const { result } = await callReaderAnalysisApi(document);
      const records = createReaderLabAnalysisRecords({
        document,
        analysis: result,
        isDemo: false,
        knownMasteredTerms: knownMasteredWithGlossary(document.id),
      });
      await persistImportedDocument(document, records);
      // 导入分析随文档自带重点、解读与白话替换：对应开关同步选中，所见即所选
      updateAids({ ...aidVisibility, explanations: true, precision: true });
    } catch (error) {
      setNotice(errorNotice(error));
    } finally {
      setBusyAction('');
    }
  }, [aidVisibility, callReaderAnalysisApi, documents, knownMasteredWithGlossary, persistImportedDocument, selectDocument, updateAids]);

  const runReaderAnalysis = useCallback(async (kind = 'inline') => {
    if (!currentDocument || busyAction) return;
    setBusyAction('analysis');
    setNotice(null);
    try {
      const { result } = await callReaderAnalysisApi();
      const nextRecords = createReaderLabAnalysisRecords({
        document: currentDocument,
        analysis: result,
        isDemo: false,
        knownMasteredTerms: knownMasteredWithGlossary(currentDocument.id),
        kind,
      });
      if (nextRecords.length === 0) throw new Error('全文分析没有产生可定位的辅助结果。');

      // 重点与解读是两类独立批量，重新生成时只替换同类旧记录；
      // 但两类批量来自同一次分析、锚点完全重合，需跨批量去重，否则同一锚点会出现重复卡片：
      // - 解读批量自带高亮，生成后应收编同锚点的纯高亮记录；
      // - 生成重点批量时，若同锚点已有解读记录则跳过，不覆盖也不叠加
      const otherKindRecords = explanations.filter(
        (record) => record.documentId === currentDocument.id
          && record.batchAnalysis
          && (record.batchKind || 'inline') !== kind
      );
      let effectiveRecords = nextRecords;
      let overlappedOtherRecords = [];
      if (kind === 'highlights') {
        const coveredKeys = new Set(otherKindRecords.map(batchAnchorKey));
        effectiveRecords = nextRecords.filter((record) => !coveredKeys.has(batchAnchorKey(record)));
      } else {
        const nextKeys = new Set(nextRecords.map(batchAnchorKey));
        overlappedOtherRecords = otherKindRecords.filter((record) => nextKeys.has(batchAnchorKey(record)));
      }

      const previousBatchRecords = explanations.filter(
        (record) => record.documentId === currentDocument.id
          && record.batchAnalysis
          && (record.batchKind || 'inline') === kind
      );
      const previousBatchTerms = kind === 'inline'
        ? terms.filter((term) => term.documentId === currentDocument.id && term.batchAnalysis)
        : [];
      for (const record of [...previousBatchRecords, ...overlappedOtherRecords]) {
        await Promise.all([
          workspaceRepository.explanations.remove(record.id),
          workspaceRepository.reviewStates.remove(reviewId(record.id)),
        ]);
      }
      for (const term of previousBatchTerms) await workspaceRepository.terms.remove(term.id);
      for (const record of effectiveRecords) await workspaceRepository.explanations.save(record);
      // 批量分析从 mapping 派生的术语同步写入术语库，供知识面板展示与跨文档术语回灌
      const nextBatchTerms = effectiveRecords.flatMap((record) => record.terms || []);
      for (const term of nextBatchTerms) await workspaceRepository.terms.save(term);

      setExplanations((current) => [
        ...current.filter((record) => !(
          record.documentId === currentDocument.id
          && record.batchAnalysis
          && ((record.batchKind || 'inline') === kind || overlappedOtherRecords.some((item) => item.id === record.id))
        )),
        ...effectiveRecords,
      ]);
      setReviewStates((current) => current.filter(
        (state) => !previousBatchRecords.some((record) => record.id === state.itemId)
          && !overlappedOtherRecords.some((record) => record.id === state.itemId)
      ));
      setTerms((current) => [
        ...current.filter((term) => !(term.documentId === currentDocument.id && term.batchAnalysis)),
        ...nextBatchTerms,
      ]);
      // 分析完成后同步选中态：解读批量含重点与贴行卡；解读批量还带白话映射，白话开关一并打开；
      // 重点批量只负责高亮，白话保持用户原状
      updateAids(kind === 'inline'
        ? { ...aidVisibility, explanations: true, precision: true }
        : { ...aidVisibility, explanations: true });
      setNotice(kind === 'highlights'
        ? (effectiveRecords.length === 0
          ? { type: 'success', messageKey: 'workspace.notice.highlightsCovered' }
          : { type: 'success', messageKey: 'workspace.notice.highlightsMarked', params: { count: effectiveRecords.length } })
        : { type: 'success', messageKey: 'workspace.notice.anchorsLocated', params: { anchors: result.anchors.length, records: effectiveRecords.length } });
    } catch (error) {
      setNotice(errorNotice(error));
    } finally {
      setBusyAction('');
    }
  }, [aidVisibility, busyAction, callReaderAnalysisApi, currentDocument, explanations, knownMasteredWithGlossary, terms, updateAids]);

  const analyzeHighlights = useCallback(() => runReaderAnalysis('highlights'), [runReaderAnalysis]);
  const analyzeInlineAid = useCallback(() => runReaderAnalysis('inline'), [runReaderAnalysis]);

  const generateFlashcards = useCallback(async () => {
    if (!currentDocument || busyAction) return;
    setBusyAction('flashcards');
    setNotice(null);
    try {
      const config = getConfig();
      const usePassword = hasPasswordMode();
      if (!usePassword && !isConfigValid(config)) {
        throw i18nError('workspace.configMissing');
      }
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
      setNotice({ type: 'success', messageKey: 'workspace.notice.flashcardsGenerated', params: { count: cards.length } });
      // 生成后直接切到知识面板的闪卡 tab，不再弹独立窗口
      setRightPanelView('knowledge');
      setFlashcardPanelSignal((signal) => signal + 1);
      onToolChange?.('read');
    } catch (error) {
      setNotice(errorNotice(error));
    } finally {
      setBusyAction('');
    }
  }, [busyAction, currentDocument, currentExplanations, onToolChange]);

  // 切换文档时清除未消费的图表锚点，避免错锚到其他文档
  useEffect(() => {
    setDiagramAnchor(null);
  }, [currentDocumentId]);

  const currentDrawings = useMemo(
    () => drawings.filter((drawing) => drawing.documentId === diagramDocumentId),
    [diagramDocumentId, drawings]
  );
  const activeDrawing = currentDrawings.find((drawing) => drawing.id === activeDrawingId) || currentDrawings[0] || null;

  const selectDrawing = useCallback((drawingId) => {
    const drawing = currentDrawings.find((item) => item.id === drawingId);
    if (drawing) onDiagramResolved(drawing);
    setActiveDrawingId(drawingId);
    saveSession(diagramDocumentId, { activeDrawingId: drawingId }).catch(console.error);
  }, [currentDrawings, diagramDocumentId, onDiagramResolved, saveSession]);

  const createDrawing = useCallback(async (drawing) => {
    const usedRouteIds = new Set(
      drawings
        .filter((item) => item.id !== drawing.id && isDiagramRouteId(item.routeId))
        .map((item) => item.routeId)
    );
    const nextDrawing = ensureDiagramRouteId(drawing, usedRouteIds);
    await workspaceRepository.drawings.save(nextDrawing);
    setDrawings((current) => [nextDrawing, ...current.filter((item) => item.id !== nextDrawing.id)]);
    setActiveDrawingId(nextDrawing.id);
    // 划词图解留在原文就地插入，不切到图解画布；其余入口照旧跳转展示
    const stayInline = inlineDiagramRef.current;
    inlineDiagramRef.current = false;
    if (!stayInline) {
      setRightPanelView('diagram');
      onDiagramResolved(nextDrawing);
    }
    await saveSession(nextDrawing.documentId, { activeDrawingId: nextDrawing.id });
  }, [drawings, onDiagramResolved, saveSession]);

  // 图解库通过 URL 传入目标，统一在工作区恢复选择、文档和新建空白图解。
  useEffect(() => {
    if (!ready) return undefined;
    const requestKey = newDiagramRequestKey || `${requestedDrawingId}:${requestedDocumentId}`;
    if (!requestKey || appliedDiagramRequestRef.current === requestKey) return undefined;
    appliedDiagramRequestRef.current = requestKey;
    let cancelled = false;

    const restoreDiagramRequest = async () => {
      try {
        if (newDiagramRequestKey) {
          const now = Date.now();
          await createDrawing({
            id: createDocumentDrawingId(STANDALONE_DIAGRAM_DOCUMENT_ID, now),
            documentId: STANDALONE_DIAGRAM_DOCUMENT_ID,
            title: t('diagram.untitled'),
            engine: 'mermaid',
            renderer: 'mermaid',
            scope: DIAGRAM_SCOPES.freeform,
            intent: 'auto',
            chartType: 'auto',
            source: '',
            variants: {},
            prompt: '',
            createdAt: now,
            updatedAt: now,
          });
          if (!cancelled) setHomeStarted(true);
          return;
        }
        if (!requestedDrawingId) return;
        let drawing = drawings.find((item) => (
          item.id === requestedDrawingId || item.routeId === requestedDrawingId
        ));
        if (!drawing) {
          drawing = await workspaceRepository.drawings.get(requestedDrawingId);
          if (!drawing) {
            const storedDrawings = await workspaceRepository.drawings.list();
            drawing = storedDrawings.find((item) => item.routeId === requestedDrawingId);
          }
          if (drawing && !isDiagramRouteId(drawing.routeId)) {
            const usedRouteIds = new Set(drawings.map((item) => item.routeId).filter(isDiagramRouteId));
            drawing = ensureDiagramRouteId(drawing, usedRouteIds);
            await workspaceRepository.drawings.save(drawing);
          }
          if (drawing && !cancelled) setDrawings((current) => [drawing, ...current.filter((item) => item.id !== drawing.id)]);
        }
        if (!drawing || cancelled) {
          if (!cancelled) onDiagramResolved(null);
          return;
        }
        const drawingDocumentId = drawing.documentId;
        if (drawingDocumentId && drawingDocumentId !== STANDALONE_DIAGRAM_DOCUMENT_ID) {
          let requestedDocument = documents.find((item) => item.id === drawingDocumentId);
          if (!requestedDocument) requestedDocument = await workspaceRepository.documents.get(drawingDocumentId);
          if (requestedDocument && !cancelled) {
            setDocuments((current) => current.some((item) => item.id === requestedDocument.id)
              ? current
              : [requestedDocument, ...current]);
            setCurrentDocumentId(requestedDocument.id);
          }
          setRightPanelView('diagram');
        }
        if (!cancelled) {
          setActiveDrawingId(drawing.id);
          setHomeStarted(true);
          onDiagramResolved(drawing);
          saveSession(drawing.documentId, { activeDrawingId: drawing.id }).catch(console.error);
        }
      } catch (error) {
        if (!cancelled) setNotice(errorNotice(error));
      }
    };

    restoreDiagramRequest();
    return () => { cancelled = true; };
  }, [createDrawing, documents, drawings, newDiagramRequestKey, onDiagramResolved, ready, requestedDocumentId, requestedDrawingId, saveSession, t]);

  const applyHistoryDrawing = useCallback((history) => {
    if (!diagramDocument || !history?.generatedCode) return;
    createDrawing({
      id: `reader-drawing-${diagramDocument.id}-${Date.now()}-history`,
      documentId: diagramDocument.id,
      title: `历史图解 · ${new Date(history.timestamp || Date.now()).toLocaleString('zh-CN')}`,
      engine: history.engine || 'mermaid',
      chartType: history.chartType || 'auto',
      source: history.generatedCode,
      prompt: history.userInput || '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }).catch((error) => setNotice(errorNotice(error)));
    setInternalHistoryOpen(false);
  }, [createDrawing, diagramDocument]);

  useEffect(() => {
    if (!historyDrawing || !diagramDocument) return;
    const requestKey = `${historyDrawing.id || ''}:${historyDrawing.nonce || ''}`;
    if (!requestKey || appliedHistoryRef.current === requestKey) return;
    appliedHistoryRef.current = requestKey;
    createDrawing({
      id: `reader-drawing-${diagramDocument.id}-${Date.now()}-history`,
      documentId: diagramDocument.id,
      title: `历史图解 · ${new Date(historyDrawing.timestamp || Date.now()).toLocaleString('zh-CN')}`,
      engine: historyDrawing.engine || 'mermaid',
      chartType: historyDrawing.chartType || 'auto',
      source: historyDrawing.generatedCode || '',
      prompt: historyDrawing.userInput || '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }).catch((error) => setNotice(errorNotice(error)));
  }, [createDrawing, diagramDocument, historyDrawing]);

  const persistDrawing = useCallback(async (drawing) => {
    await workspaceRepository.drawings.save(drawing);
    setDrawings((current) => current.map((item) => item.id === drawing.id ? drawing : item));
  }, []);

  // 全局浏览器桥接已把命令落到 IndexedDB；工作台只同步内存状态，避免任何文件中转。
  useEffect(() => {
    const handleDrawing = (event) => {
      const drawing = event.detail?.drawing;
      if (!drawing?.id) return;
      setDrawings((current) => [drawing, ...current.filter((item) => item.id !== drawing.id)]);
      if (event.detail?.open) {
        setActiveDrawingId(drawing.id);
        setHomeStarted(true);
        setRightPanelView('diagram');
      }
    };
    window.addEventListener(DIAGRAM_AGENT_DRAWING_EVENT, handleDrawing);
    return () => window.removeEventListener(DIAGRAM_AGENT_DRAWING_EVENT, handleDrawing);
  }, []);

  // 重命名图解：只改标题与更新时间，走与 persistDrawing 同一存储通道
  const renameDrawing = useCallback(async (drawingId, title) => {
    const target = currentDrawings.find((drawing) => drawing.id === drawingId);
    if (!target || !title) return;
    const next = { ...target, title, updatedAt: Date.now() };
    await workspaceRepository.drawings.save(next);
    setDrawings((current) => current.map((item) => (item.id === drawingId ? next : item)));
  }, [currentDrawings]);

  const deleteDrawing = useCallback(async (drawingId) => {
    await workspaceRepository.drawings.remove(drawingId);
    const remaining = currentDrawings.filter((drawing) => drawing.id !== drawingId);
    setDrawings((current) => current.filter((drawing) => drawing.id !== drawingId));
    setActiveDrawingId(remaining[0]?.id || '');
    onDiagramResolved(remaining[0] || null);
    await saveSession(diagramDocumentId, { activeDrawingId: remaining[0]?.id || '' });
  }, [currentDrawings, diagramDocumentId, onDiagramResolved, saveSession]);

  const openDiagram = useCallback((drawingId) => {
    const drawing = currentDrawings.find((item) => item.id === drawingId);
    if (drawing) onDiagramResolved(drawing);
    setActiveDrawingId(drawingId);
    saveSession(diagramDocumentId, { activeDrawingId: drawingId }).catch(console.error);
    setRightPanelView('diagram');
    onToolChange?.('diagram');
  }, [currentDrawings, diagramDocumentId, onDiagramResolved, onToolChange, saveSession]);

  const clearDiagramAnchor = useCallback(() => setDiagramAnchor(null), []);

  // 图表状态在画布区与对话区之间共享，只实例化一次
  const diagramState = useDocumentDiagram({
    document: diagramDocument,
    activeDrawing,
    anchor: diagramAnchor?.documentId === diagramDocument?.id ? diagramAnchor : null,
    onCreateDrawing: createDrawing,
    onPersistDrawing: persistDrawing,
    onClearAnchor: clearDiagramAnchor,
    onNotice: setNotice,
  });

  // 划词图解不跳转：留在原文直接生成，锚点随参数传入 generate（不等 anchor prop 下一帧生效）；
  // 生成中在选区下方挂占位卡，完成后图解卡就地插入
  const handleDiagramSelection = useCallback(async (selection) => {
    if (!currentDocument) return;
    if (diagramState.isGenerating) {
      setNotice({ type: 'demo', messageKey: 'workspace.notice.diagramGenerating' });
      return;
    }
    const anchor = {
      documentId: currentDocument.id,
      from: selection.from,
      to: selection.to,
      source: selection.text,
    };
    setDiagramAnchor(anchor);
    updateAids({ ...aidVisibility, diagrams: true });
    setPendingInlineDiagram(anchor);
    inlineDiagramRef.current = true;
    setNotice({ type: 'success', messageKey: 'workspace.notice.diagramStarted' });
    const plan = createDiagramGenerationPlan({
      scope: DIAGRAM_SCOPES.selection,
      content: selection.text,
    });
    await diagramState.generate(
      plan.prompt,
      plan.intent,
      'text',
      plan.renderer,
      anchor,
      plan
    );
    inlineDiagramRef.current = false;
    setPendingInlineDiagram(null);
  }, [aidVisibility, currentDocument, diagramState, updateAids]);

  const generateArticleDiagram = useCallback((scope) => {
    if (!currentDocument || diagramState.isGenerating) return;
    const plan = createDiagramGenerationPlan({ scope, content: currentDocument.content });
    setRightPanelView('diagram');
    onToolChange?.('diagram');
    diagramState.generate(
      plan.prompt,
      plan.intent,
      'text',
      plan.renderer,
      null,
      plan
    );
  }, [currentDocument, diagramState, onToolChange]);

  const generateFullDiagram = useCallback(
    () => generateArticleDiagram(DIAGRAM_SCOPES.articleOverview),
    [generateArticleDiagram]
  );

  const generateDeepDiagram = useCallback(
    () => generateArticleDiagram(DIAGRAM_SCOPES.articleDeep),
    [generateArticleDiagram]
  );

  // 一键生成全部：重点 → 解读（含白话）→ 闪卡 → 图解，均依赖模型配置
  const analyzeDocument = useCallback(async () => {
    await runReaderAnalysis('highlights');
    await runReaderAnalysis('inline');
    try { await generateFlashcards(); } catch { /* 单步失败不阻断后续生成 */ }
    generateFullDiagram();
  }, [runReaderAnalysis, generateFlashcards, generateFullDiagram]);

  const handleSelectionAction = useCallback(async (selection) => {
    if (!currentDocument || busyAction) return;
    setBusyAction(selection.action);
    setNotice(null);
    try {
      // 提示词模板动作执行：代入模板调用 /api/custom-action，结果弹窗展示（自定义动作与改过模板的内置动作共用）
      const runTemplateAction = async (action) => {
        const config = getConfig();
        const usePassword = hasPasswordMode();
        if (!usePassword && !isConfigValid(config)) {
          throw i18nError('workspace.configMissing');
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
          throw new Error(body.error || `浮动工具栏动作执行失败 (${response.status})`);
        }
        const payload = await response.json();
        setCustomActionResult({ name: action.name, selection: selection.text, result: payload.result });
      };

      // 内置动作改过模板后不再走结构化锚定链路，改按用户模板执行
      const builtin = toolbarBuiltins.find((item) => item.id === selection.action);
      if (builtin && !isDefaultToolbarBuiltinTemplate(builtin)) {
        await runTemplateAction(builtin);
        return;
      }

      // 浮动工具栏自定义动作：代入模板调用，结果弹窗展示
      if (typeof selection.action === 'string' && selection.action.startsWith('custom:')) {
        const actionId = selection.action.slice('custom:'.length);
        const action = customActions.find((item) => item.id === actionId);
        if (!action) throw new Error('浮动工具栏动作不存在，请检查配置。');
        await runTemplateAction(action);
        return;
      }

      // 划词提问：内置提示词直出，回答锚定原文存为解读记录，候选词条以 pending 态挂上等待审阅入库
      if (selection.action === 'ask') {
        const { result } = await callAskApi(selection.text);
        const now = Date.now();
        const explanation = createReaderLabExplanation({
          id: `reader-lab-explanation-${currentDocument.id}-${now}`,
          document: currentDocument,
          selection,
          response: { plainExplanation: result.answer, context: result.context, terms: [] },
          isDemo: false,
          now,
        });
        explanation.readerLab = true;
        explanation.ask = true;
        explanation.glossaryCandidates = (result.candidates || []).map((candidate) => ({ ...candidate, status: 'pending' }));
        await workspaceRepository.explanations.save(explanation);
        setExplanations((current) => [...current, explanation]);
        updateAids({ ...aidVisibility, explanations: true });
        setNotice({ type: 'success', messageKey: 'workspace.notice.answerSaved' });
        return;
      }

      const { result } = await callExplainApi(selection.text);
      const now = Date.now();
      const explanation = createReaderLabExplanation({
        id: `reader-lab-explanation-${currentDocument.id}-${now}`,
        document: currentDocument,
        selection,
        response: result,
        isDemo: false,
        now,
      });
      explanation.readerLab = true;

      if (selection.action === 'explain') {
        await workspaceRepository.explanations.save(explanation);
        setExplanations((current) => [...current, explanation]);
        updateAids({ ...aidVisibility, explanations: true });
        setNotice({ type: 'success', messageKey: 'workspace.notice.explanationSaved' });
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
          isDemo: false,
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
        setNotice({ type: 'success', messageKey: 'workspace.notice.precisionAttached', params: { count: nextTerms.length } });
      }
    } catch (error) {
      setNotice(errorNotice(error));
    } finally {
      setBusyAction('');
    }
  }, [aidVisibility, busyAction, callAskApi, callExplainApi, currentDocument, customActions, glossary, terms, toolbarBuiltins, updateAids]);

  // 提问候选词条审阅：入库即新建/更新术语表条目并立刻作为 AI 背景生效；忽略只改候选状态
  const reviewGlossaryCandidate = useCallback(async (recordId, candidateIndex, decision) => {
    const record = explanations.find((item) => item.id === recordId);
    const candidate = record?.glossaryCandidates?.[candidateIndex];
    if (!record || !candidate || candidate.status !== 'pending') return;
    if (decision === 'register') {
      const termKey = candidate.term.toLowerCase();
      const existing = glossary.find((entry) => entry.term.toLowerCase() === termKey);
      // 撞既有词条时合并别名而非重复建档，与术语库的累积策略保持一致
      const aliases = existing
        ? [...new Set([...(existing.aliases || []), ...(candidate.aliases || [])])].slice(0, 8)
        : (candidate.aliases || []);
      const entry = {
        id: existing?.id || `glossary-${Date.now()}`,
        term: candidate.term,
        aliases,
        explanation: candidate.explanation,
        createdAt: existing?.createdAt,
        updatedAt: Date.now(),
      };
      await workspaceRepository.glossary.save(entry);
      setGlossary((current) => [...current.filter((item) => item.id !== entry.id), entry]);
    }
    const glossaryCandidates = record.glossaryCandidates.map((item, index) => (
      index === candidateIndex ? { ...item, status: decision === 'register' ? 'saved' : 'dismissed' } : item
    ));
    const updated = { ...record, glossaryCandidates, updatedAt: Date.now() };
    await workspaceRepository.explanations.save(updated);
    setExplanations((current) => current.map((item) => (item.id === recordId ? updated : item)));
    setNotice(decision === 'register'
      ? { type: 'success', messageKey: 'workspace.notice.termRegistered', params: { term: candidate.term } }
      : { type: 'success', messageKey: 'workspace.notice.termDismissed', params: { term: candidate.term } });
  }, [explanations, glossary]);

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
    // 解读掌握连带其术语掌握：同步触发填空揭示淡出
    fadeRevealedForTerms(record.terms);
  }, [mastery, fadeRevealedForTerms]);

  // 术语"懂了"开关：切换 mastered 状态，已掌握的术语跨文档再次出现时不再解释，
  // 同时触发填空揭示淡出（正文里的白话辅助撤下，词回到原文）
  const toggleTermMastery = useCallback(async (term) => {
    if (!term) return;
    const nextStatus = term.status === 'mastered' ? 'learning' : 'mastered';
    const nextTerm = { ...term, status: nextStatus, updatedAt: Date.now() };
    await workspaceRepository.terms.save(nextTerm);
    setTerms((current) => current.map((item) => (item.id === term.id ? nextTerm : item)));
    if (nextStatus === 'mastered') fadeRevealedForTerms([nextTerm]);
  }, [fadeRevealedForTerms]);

  // 词条删除：术语表里的显式管理动作——词条移出落盘，同时清掉其全工作区持久揭示态
  // （删掉的词不应再占着白话替换/揭示位）；正文白话映射来自批量分析记录，不受影响
  const deleteTerm = useCallback(async (term) => {
    if (!term) return;
    await workspaceRepository.terms.remove(term.id);
    setTerms((current) => current.filter((item) => item.id !== term.id));
    fadeRevealedForTerms([term]);
    setNotice({ type: 'success', messageKey: 'workspace.notice.termDeleted' });
  }, [fadeRevealedForTerms]);

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
    setNotice({ type: 'success', messageKey: 'workspace.notice.explanationDeleted' });
  }, [terms]);

  const focusExplanation = useCallback((recordId, options = {}) => {
    // 定位需要原文坐标：先关闭精准替代；从重点面板定位时不强制展开解读卡，保持解读开关原状
    const openCard = options.openCard !== false;
    if (aidVisibility.precision || (openCard && !aidVisibility.explanations)) {
      updateAids({ ...aidVisibility, precision: false, explanations: openCard || aidVisibility.explanations });
    }
    // 记录所在层被隐藏时先恢复可见，否则高亮/框线装饰不存在，无法定位
    const record = explanations.find((item) => item.id === recordId);
    const layer = record?.level === 'word' ? 'word' : readerRoleLayer(record?.role);
    if (record && layerVisibility[layer] === false) {
      updateLayerVisibility({ ...layerVisibility, [layer]: true });
    }
    window.setTimeout(() => {
      // 解读卡开启时优先滚到行间解读卡；未开启时解读卡被 CSS 隐藏（滚动无效），
      // 改定位原文上的高亮/框线装饰
      const card = document.getElementById(`reader-note-${recordId}`);
      const mark = document.querySelector(`[data-reader-explanation-id="${recordId}"]`);
      const element = openCard ? card || mark : mark || card;
      element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      element?.animate?.(
        [{ backgroundColor: '#ccfbf1' }, { backgroundColor: '#f0fdfa' }],
        { duration: 900 }
      );
    }, 100);
    setKnowledgeOpen(false);
  }, [aidVisibility, explanations, layerVisibility, updateAids, updateLayerVisibility]);

  // 左侧原文标记点击→右侧面板定位：切回知识视图，移动端开面板，再滚动到对应卡片
  const focusPanelFromMark = useCallback((recordId) => {
    if (!recordId) return;
    setRightPanelView('knowledge');
    if (!isDesktop) setKnowledgeOpen(true);
    setPanelFocus({ id: recordId, nonce: Date.now() });
  }, [isDesktop]);

  // 白话 Tab 点击定位原文：面板传来的是词条 id，先取回 term 对象（此前按对象处理字符串导致永远提前返回）；
  // 白话替代开启时不取消模式——定位保持当前视图，由阅读面按文本/『白话』标记匹配
  const focusTerm = useCallback((termOrId) => {
    const term = typeof termOrId === 'string'
      ? terms.find((item) => item.id === termOrId)
      : termOrId;
    if (!term) return;
    const record = term.explanationId
      ? explanations.find((item) => item.id === term.explanationId)
      : null;
    if (aidVisibility.precision) {
      // 白话视图里术语文本已被替换、坐标已变：统一走文本匹配信号，视图模式保持不变
      setFocusTermSignal({ term: term.term, nonce: Date.now() });
    } else if (term.range) {
      // 原文视图 + 自带坐标（划词术语）：精准定位
      setFocusRange({ ...term.range, nonce: Date.now() });
    } else if (!record) {
      // 批量术语与点击回灌词条没有坐标也没有关联解读：交给阅读面按术语文本匹配定位
      setFocusTermSignal({ term: term.term, nonce: Date.now() });
    } else {
      focusExplanation(record.id);
    }
    setKnowledgeOpen(false);
  }, [aidVisibility, explanations, focusExplanation, terms]);

  const exportBackup = useCallback(async () => {
    try {
      const payload = await exportWorkspace(workspaceRepository, {
        flashcards: flashcardStore.getAll(),
        diagramHistory: historyManager.getHistories(),
      });
      const suggested = `anchor-read-backup-${new Date().toISOString().slice(0, 10)}.anchorread`;
      // 优先用保存对话框让用户自选位置落盘单个备份文件，不支持时回退浏览器下载
      if (supportsSaveFilePicker()) {
        const savedName = await saveWorkspaceFileWithPicker(payload, suggested);
        setNotice({ type: 'success', messageKey: 'workspace.notice.backupSaved', params: { name: savedName } });
        return;
      }
      downloadWorkspaceFile(payload, suggested);
      setNotice({ type: 'success', messageKey: 'workspace.notice.backupStarted' });
    } catch (error) {
      if (error?.name === 'AbortError') return; // 用户在对话框取消，不提示
      setNotice(errorNotice(error));
    }
  }, []);

  // 浮动工具栏：保存（新建/更新）与删除，持久化到本地工作区
  const saveCustomAction = useCallback(async (input) => {
    const existing = input.id ? customActions.find((item) => item.id === input.id) : null;
    const action = createCustomAction({
      ...input,
      id: input.id || undefined,
      createdAt: existing?.createdAt,
      // 编辑保持原位置；新建追加到列表末尾
      order: existing?.order ?? customActions.length,
    });
    await workspaceRepository.customActions.save(action);
    setCustomActions((current) => {
      // 编辑保持原位置；新建追加到列表末尾
      if (current.some((item) => item.id === action.id)) {
        return current.map((item) => (item.id === action.id ? action : item));
      }
      return [...current, action];
    });
    setNotice({ type: 'success', messageKey: 'workspace.notice.actionSaved', params: { name: action.name } });
  }, [customActions]);

  const removeCustomAction = useCallback(async (id) => {
    await workspaceRepository.customActions.remove(id);
    setCustomActions((current) => current.filter((item) => item.id !== id));
    setNotice({ type: 'success', messageKey: 'workspace.notice.actionDeleted' });
  }, []);

  // 浮动工具栏自定义动作：启用/停用切换，持久化到本地工作区
  const toggleCustomAction = useCallback(async (action) => {
    const next = { ...action, enabled: action.enabled === false, updatedAt: Date.now() };
    await workspaceRepository.customActions.save(next);
    setCustomActions((current) => current.map((item) => (item.id === next.id ? next : item)));
  }, []);

  // 浮动工具栏内置动作：更新名称/说明/模板/启用状态，持久化覆盖项到本地
  const updateToolbarBuiltin = useCallback((id, patch) => {
    setToolbarBuiltins((current) => {
      const next = current.map((item) => {
        if (item.id !== id) return item;
        const merged = { ...item, ...patch };
        if (typeof patch.name === 'string') merged.name = patch.name.trim() || item.name;
        if (typeof patch.description === 'string') merged.description = patch.description.trim();
        if (typeof patch.promptTemplate === 'string') merged.promptTemplate = patch.promptTemplate.trim() || item.promptTemplate;
        return merged;
      });
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('anchor-read-toolbar-builtins', JSON.stringify(toToolbarBuiltinOverrides(next)));
      }
      return next;
    });
  }, []);

  // 浮动工具栏内置动作：与自定义动作同款的保存校验（名称/模板/占位符）
  const saveBuiltinAction = useCallback((id, input) => {
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    const description = typeof input.description === 'string' ? input.description.trim() : '';
    const promptTemplate = typeof input.promptTemplate === 'string' ? input.promptTemplate.trim() : '';
    if (!name) throw new Error('动作名称不能为空。');
    if (name.length > MAX_CUSTOM_ACTION_NAME_LENGTH) {
      throw new Error(`动作名称不能超过 ${MAX_CUSTOM_ACTION_NAME_LENGTH} 个字符。`);
    }
    if (!promptTemplate) throw new Error('提示词模板不能为空。');
    if (promptTemplate.length > MAX_CUSTOM_ACTION_TEMPLATE_LENGTH) {
      throw new Error(`提示词模板不能超过 ${MAX_CUSTOM_ACTION_TEMPLATE_LENGTH} 个字符。`);
    }
    if (!promptTemplate.includes(CUSTOM_ACTION_SELECTION_PLACEHOLDER)) {
      throw new Error(`提示词模板必须包含 ${CUSTOM_ACTION_SELECTION_PLACEHOLDER} 占位符，用于插入选中文本。`);
    }
    // 残差点：动作保存表单的校验错误抛给配置弹窗展示，归入管理弹窗层键化
    updateToolbarBuiltin(id, { name, description, promptTemplate });
    setNotice({ type: 'success', messageKey: 'workspace.notice.actionSaved', params: { name } });
  }, [updateToolbarBuiltin]);

  // 浮动工具栏统一列表：内置动作与自定义动作按统一 order 合并，配置弹窗共用一套开关与排序
  const unifiedToolbarActions = useMemo(() => {
    const builtins = toolbarBuiltins.map((item) => ({ ...item, builtin: true }));
    return [...builtins, ...customActions].sort(
      (left, right) => (left.order ?? left.createdAt ?? 0) - (right.order ?? right.createdAt ?? 0)
    );
  }, [customActions, toolbarBuiltins]);

  // 浮动工具栏动作：启用/停用切换（内置走本地偏好，自定义持久化到工作区）
  const toggleToolbarAction = useCallback((action) => {
    if (action.builtin) {
      updateToolbarBuiltin(action.id, { enabled: action.enabled === false });
      return;
    }
    toggleCustomAction(action);
  }, [toggleCustomAction, updateToolbarBuiltin]);

  // 浮动工具栏动作：上移/下移，统一重排后分别持久化内置覆盖项与自定义动作
  const moveToolbarAction = useCallback(async (id, direction) => {
    const list = unifiedToolbarActions;
    const index = list.findIndex((item) => item.id === id);
    const target = direction === 'up' ? index - 1 : index + 1;
    if (index < 0 || target < 0 || target >= list.length) return;
    const next = [...list];
    [next[index], next[target]] = [next[target], next[index]];
    const ordered = next.map((item, position) => ({ ...item, order: position }));
    setToolbarBuiltins(ordered.filter((item) => item.builtin));
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(
        'anchor-read-toolbar-builtins',
        JSON.stringify(toToolbarBuiltinOverrides(ordered.filter((item) => item.builtin)))
      );
    }
    const customs = ordered.filter((item) => !item.builtin);
    for (const item of customs) await workspaceRepository.customActions.save(item);
    setCustomActions(customs);
  }, [unifiedToolbarActions]);

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
    setNotice({ type: 'success', messageKey: 'workspace.notice.glossarySaved', params: { term: entry.term } });
  }, [glossary]);

  const removeGlossaryEntry = useCallback(async (id) => {
    await workspaceRepository.glossary.remove(id);
    setGlossary((current) => current.filter((entry) => entry.id !== id));
    setNotice({ type: 'success', messageKey: 'workspace.notice.glossaryDeleted' });
  }, []);

  // 生态导出：闪卡 → Anki 文本导入文件
  const exportAnki = useCallback(() => {
    try {
      const cards = flashcardStore.getAll();
      if (cards.length === 0) {
        setNotice({ type: 'error', messageKey: 'workspace.notice.noFlashcards' });
        return;
      }
      downloadAnkiFile(buildAnkiText(cards), `anchor-read-flashcards-${new Date().toISOString().slice(0, 10)}.txt`);
      setNotice({ type: 'success', messageKey: 'workspace.notice.flashcardsExported', params: { count: cards.length } });
    } catch (error) {
      setNotice(errorNotice(error));
    }
  }, []);

  // 生态导出：解读/术语/闪卡 → Obsidian 笔记（术语带双链），优先直接写入所选文件夹
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
        setNotice({ type: 'error', messageKey: 'workspace.notice.noDerived' });
        return;
      }
      const subFolder = `anchor-read-${new Date().toISOString().slice(0, 10)}`;
      if (supportsDirectoryPicker()) {
        const { folderName, count } = await saveObsidianNotesToDirectory(notes, subFolder);
        setNotice({ type: 'success', messageKey: 'workspace.notice.obsidianWritten', params: { count, folder: folderName } });
        return;
      }
      // Firefox/Safari 等不支持目录选择的浏览器，回退为 zip 下载
      await downloadObsidianZip(notes, `anchor-read-obsidian-${new Date().toISOString().slice(0, 10)}.zip`);
      setNotice({ type: 'success', messageKey: 'workspace.notice.obsidianZipped', params: { count: notes.length } });
    } catch (error) {
      if (error?.name === 'AbortError') return; // 用户在选择器取消，不提示
      setNotice(errorNotice(error));
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

  const recentDrawings = useMemo(
    () => [...drawings]
      .sort((left, right) => (right.updatedAt || right.createdAt || 0) - (left.updatedAt || left.createdAt || 0))
      .slice(0, 4),
    [drawings]
  );

  const openRecentDocument = useCallback((documentId) => {
    selectDocument(documentId);
    setHomeStarted(true);
  }, [selectDocument]);

  const openRecentDrawing = useCallback((drawing) => {
    if (!drawing?.id || !drawing.documentId) return;
    setActiveDrawingId(drawing.id);
    setHomeStarted(true);
    saveSession(drawing.documentId, { activeDrawingId: drawing.id }).catch(console.error);
    onDiagramResolved(drawing);
    if (drawing.documentId === STANDALONE_DIAGRAM_DOCUMENT_ID) {
      return;
    }
    setCurrentDocumentId(drawing.documentId);
    setRightPanelView('diagram');
    onToolChange?.('diagram');
  }, [onDiagramResolved, onToolChange, saveSession]);

  if (!ready) {
    return (
      <main className="flex h-full min-h-0 items-center justify-center bg-[#f5f7f6] text-sm text-stone-500 dark:bg-stone-950 dark:text-stone-400">
        <Sparkles size={17} className="mr-2 animate-pulse text-stone-950 dark:text-stone-100" />
        {t('workspace.loading')}
      </main>
    );
  }

  if (isHomeLayout && !homeStarted) {
    return (
      <TooltipProvider>
        <main className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-stone-950 dark:text-stone-100">
          {/* 隐私提示全局常驻：首页同样显示 */}
          <PrivacyNoticeBar onExport={exportBackup} />
          <ReaderHome
            recentDocuments={recentDocuments}
            recentDrawings={recentDrawings}
            hasExistingDocuments={documents.length > 0}
            busy={busyAction === 'parse'}
            error={notice?.type === 'error' ? notice.message : ''}
            onSubmit={parseAndOpenDocument}
            onOpenExisting={onOpenDocumentLibrary || (() => setHomeStarted(true))}
            onOpenDocument={openRecentDocument}
            onOpenDrawing={openRecentDrawing}
            onCreateDiagram={onCreateDiagram}
            onOpenDiagram={onOpenDiagram}
          />
        </main>
      </TooltipProvider>
    );
  }
  if (!currentDocument) {
    return (
      <main className="flex h-full min-h-0 items-center justify-center bg-[#f5f7f6] text-sm text-stone-500 dark:bg-stone-950 dark:text-stone-400">
        <Sparkles size={17} className="mr-2 animate-pulse text-stone-950 dark:text-stone-100" />
        {t('workspace.loading')}
      </main>
    );
  }

  // 图解画布形态：阅读区不渲染，解读/白话/重点等阅读专属控件随之收起
  const diagramMode = rightPanelView === 'diagram';
  // 分栏形态：宽屏下原文与图解画布并排，边读边看；窄屏退回整块画布
  const diagramSplit = diagramMode && !standaloneDiagram && isDesktop && isWide;
  // 右栏展开态跨断点统一：桌面看折叠开关，窄屏看 Sheet 开合；顶栏图标因此全断点同款
  const rightPanelExpanded = isDesktop ? !rightCollapsed : knowledgeOpen;

  const library = (
    <DocumentLibrary
      documents={documents}
      homeHref={isHomeLayout ? null : '/'}
      onHome={isHomeLayout ? () => setHomeStarted(false) : null}
      outlineOpen={outlineOpen}
      onToggleOutline={toggleOutline}
      outlineHidden={diagramMode}
      currentDocumentId={currentDocument.id}
      sessions={sessions}
      query={query}
      onQueryChange={setQuery}
      onSelect={selectDocument}
      onImportFile={importDocumentFile}
      onCreateDocument={createPastedDocument}
    />
  );
  // 知识面板是派生内容的管理入口，始终可见；辅助开关只控制原文上的叠加显示
  // 桌面与 Sheet 共用同一面板：Sheet 形态额外注入内联关闭按钮槽位
  const renderKnowledge = (closeSlot = null) => (
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
      onDeleteTerm={deleteTerm}
      onExportAnki={exportAnki}
      onExportObsidian={exportObsidian}
      isStale={isDerivationStale}
      flashcardSignal={flashcardPanelSignal}
      panelFocus={panelFocus}
      closeSlot={closeSlot}
    />
  );
  const knowledge = renderKnowledge();
  // Sheet 内联关闭按钮：进页签行尾部槽位；图标与顶栏收起开关同一族（带箭头面板图标），不用叉号
  const sheetInlineClose = (
    <SheetClose
      aria-label={t('workspace.closePanel')}
      className="mr-1 flex h-9 w-9 shrink-0 items-center justify-center self-center rounded text-stone-600 dark:text-stone-400 outline-none hover:bg-stone-100 dark:hover:bg-white/10 hover:text-stone-900 dark:hover:text-stone-100 focus-visible:ring-2 focus-visible:ring-stone-400"
    >
      <PanelRightClose size={18} aria-hidden="true" />
    </SheetClose>
  );
  // 任一重点层级勾选时重点入口呈点亮态；全部取消勾选即隐藏原文重点
  const anyLayerVisible = LAYER_OPTIONS.some((option) => layerVisibility[option.id] !== false);
  const allLayersVisible = LAYER_OPTIONS.every((option) => layerVisibility[option.id] !== false);
  const readingSurface = (
    <ReaderSurface
      document={currentDocument}
      outlineOpen={outlineOpen}
      explanations={currentExplanations}
      mastery={mastery}
      busyAction={busyAction}
      toolbarActions={unifiedToolbarActions}
      onSelectionAction={handleSelectionAction}
      onDiagramSelection={handleDiagramSelection}
      onOpenDiagram={openDiagram}
      onCreateDrawing={createDrawing}
      onPersistDrawing={persistDrawing}
      onNotice={setNotice}
      drawings={currentDrawings}
      pendingDiagram={pendingInlineDiagram}
      aidVisibility={aidVisibility}
      layerVisibility={layerVisibility}
      clozePresentation={clozePresentation}
      revealedClozes={revealedClozeKeys}
      masteredClozeTerms={masteredClozeTerms}
      onToggleCloze={toggleCloze}
      onMaster={toggleMastery}
      onDelete={deleteExplanation}
      onRegisterCandidate={(record, index) => reviewGlossaryCandidate(record.id, index, 'register')}
      onDismissCandidate={(record, index) => reviewGlossaryCandidate(record.id, index, 'dismiss')}
      onFocus={focusPanelFromMark}
      onProgress={persistProgress}
      initialScrollTop={sessions[currentDocument.id]?.scrollTop || 0}
      focusRange={focusRange}
      focusTermSignal={focusTermSignal}
      onAnalyzeDocument={analyzeDocument}
      analysisBusy={Boolean(busyAction)}
    />
  );
  const diagram = (
    <DocumentDiagramPanel
      document={diagramDocument}
      standalone={standaloneDiagram}
      drawings={currentDrawings}
      activeDrawing={activeDrawing}
      onSelectDrawing={selectDrawing}
      onCreateDrawing={createDrawing}
      onDeleteDrawing={deleteDrawing}
      onRenameDrawing={renameDrawing}
      onNotice={setNotice}
      anchor={diagramAnchor?.documentId === diagramDocument.id ? diagramAnchor : null}
      onClearAnchor={clearDiagramAnchor}
      diagram={diagramState}
      onOpenHistory={() => {
        if (onOpenHistory) onOpenHistory(diagramDocument.id);
        else setInternalHistoryOpen(true);
      }}
      onToggleSidebar={() => {
        if (isDesktop) updateRightCollapsed(true);
        else setKnowledgeOpen(false);
      }}
    />
  );
    const diagramCanvas = <DocumentDiagramCanvas diagram={diagramState} standalone={standaloneDiagram} onOpenChat={standaloneDiagram ? () => setKnowledgeOpen(true) : null} />;
    const rightPanel = rightPanelView === 'diagram' ? diagram : knowledge;
  // 图解画布形态：阅读区不渲染，解读/白话/重点等阅读专属控件随之收起，顶栏只留图解相关动作

  return (
    <TooltipProvider>
      <main className="flex h-full min-h-0 flex-col overflow-hidden bg-[#f3f5f4] text-stone-950 dark:bg-stone-950 dark:text-stone-100">
        <PrivacyNoticeBar onExport={exportBackup} />

        {/* 独立图解工作区：顶栏「图解」已表明当前视图，header 行只剩标题太浪费，
            整行移除让下方画布与面板直接提上来；文档绑定形态照常保留 header */}
        {!standaloneDiagram && (
        <header className="z-20 flex min-h-[62px] shrink-0 items-center gap-3 border-b border-stone-200 dark:border-stone-800 bg-white px-3 sm:px-4 lg:px-6 dark:bg-stone-900">
          {/* 文档库入口只在文档绑定形态有意义 */}
          {!standaloneDiagram && (
          <Tooltip content={isDesktop && !isHomeLayout ? (libraryCollapsed ? t('workspace.libraryExpand') : t('workspace.libraryCollapse')) : t('workspace.libraryOpen')}>
            <button
              type="button"
              onClick={() => {
                if (isDesktop && !isHomeLayout) updateLibraryCollapsed(!libraryCollapsed);
                else setLibraryOpen(true);
              }}
              aria-label={isDesktop && !isHomeLayout ? (libraryCollapsed ? t('workspace.libraryExpand') : t('workspace.libraryCollapse')) : t('workspace.libraryOpen')}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded text-stone-600 dark:text-stone-400 outline-none hover:bg-stone-100 dark:hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-stone-400"
            >
              {/* 侧边栏样式图标：展开态点按收起，收起/窄屏态点按展开 */}
              {isDesktop && !isHomeLayout && !libraryCollapsed ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
            </button>
          </Tooltip>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold text-stone-950 dark:text-stone-100 sm:text-base">{currentDocument.title}</h1>
            <p className="mt-0.5 flex items-center gap-2 truncate text-[11px] text-stone-500 dark:text-stone-400">
              <span>{currentDocument.category}</span>
              <span aria-hidden="true">·</span>
              <span>{t('workspace.readMinutes', { minutes: currentDocument.readMinutes })}</span>
              <span className="hidden sm:inline" aria-hidden="true">·</span>
              <span className="hidden sm:inline">{t('workspace.updatedAt', { date: formatDate(currentDocument.updatedAt) })}</span>
            </p>
          </div>
          {/* 显示组：多选辅助 + 层级可见性常驻可见；生成/管理动作收纳进右侧下拉；整块画布下阅读区不存在，整组收起（分栏形态下阅读区可见，控件保留） */}
          {(!diagramMode || diagramSplit) && (
          <div className="flex shrink-0 items-center gap-1 rounded-md border border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-white/5 p-1">
            <div className="flex items-center gap-1" aria-label={t('workspace.aidInline')}>
              {AID_OPTIONS.filter((option) => option.id !== 'precision').map((option) => {
                const active = Boolean(aidVisibility[option.id]);
                const label = t(`workspace.aid.${option.id}`);
                const tooltip = t(active ? 'workspace.aidHide' : 'workspace.aidShow', { label });
                return (
                  <Tooltip key={option.id} content={tooltip}>
                    <button
                      type="button"
                      onClick={() => toggleAid(option.id)}
                      aria-pressed={active}
                      aria-label={t(active ? 'workspace.aidTurnOff' : 'workspace.aidTurnOn', { label })}
                      className={`flex h-8 items-center gap-1.5 rounded px-2 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-stone-400 ${active ? 'bg-white text-stone-900 shadow-sm dark:bg-white/10 dark:text-stone-100' : 'text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100'}`}
                    >
                      {option.id === 'explanations'
                        ? <MessageSquareText size={14} />
                        : <Network size={14} />}
                      {label}
                    </button>
                  </Tooltip>
                );
              })}
            </div>
            <span className="h-5 w-px bg-stone-200 dark:bg-white/15" aria-hidden="true" />
            {/* 白话与重点同形态：入口是带下拉的 tab，开关与解释深度档位收纳在下拉里 */}
            <div className="relative">
              <Tooltip content={t('workspace.precisionTooltip')}>
                <button
                  type="button"
                  onClick={() => {
                    setPrecisionMenuOpen((open) => !open);
                    setLayerMenuOpen(false);
                    setMoreMenuOpen(false);
                  }}
                  aria-label={t('workspace.precisionAria')}
                  aria-expanded={precisionMenuOpen}
                  className={`flex h-8 items-center gap-1.5 rounded px-2 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-stone-400 ${aidVisibility.precision ? 'bg-white text-stone-900 shadow-sm dark:bg-white/10 dark:text-stone-100' : 'text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100'}`}
                >
                  <WandSparkles size={14} />
                  {t('workspace.aid.precision')}
                  <ChevronDown size={12} aria-hidden="true" />
                </button>
              </Tooltip>
              {precisionMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" aria-hidden="true" onClick={() => setPrecisionMenuOpen(false)} />
                  <div className="absolute right-0 top-9 z-50 w-60 rounded-md border border-zinc-200 bg-white p-2 shadow-lg dark:border-stone-700 dark:bg-stone-900">
                    <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs text-stone-700 dark:text-stone-300 hover:bg-stone-50 dark:bg-white/5">
                      <input
                        type="checkbox"
                        checked={Boolean(aidVisibility.precision)}
                        onChange={() => toggleAid('precision')}
                        className="h-3.5 w-3.5 accent-stone-950 dark:accent-stone-100"
                      />
                      {aidVisibility.precision ? t('workspace.precisionRestore') : t('workspace.precisionApply')}
                    </label>
                    <p className="px-2 pb-1 pt-1.5 text-[11px] text-stone-500 dark:text-stone-400">{t('workspace.presentationMode')}</p>
                    {CLOZE_PRESENTATION_OPTIONS.map((option) => (
                      <label
                        key={option.id}
                        className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs text-stone-700 dark:text-stone-300 hover:bg-stone-50 dark:bg-white/5"
                      >
                        <input
                          type="radio"
                          name="cloze-presentation"
                          checked={clozePresentation === option.id}
                          onChange={() => updateClozePresentation(option.id)}
                          className="h-3.5 w-3.5 accent-stone-950 dark:accent-stone-100"
                        />
                        {t(`workspace.cloze.${option.id}`)}
                      </label>
                    ))}
                    <p className="px-2 pb-1 pt-1.5 text-[11px] text-stone-500 dark:text-stone-400">{t('workspace.depthHeading')}</p>
                    {EXPLANATION_DEPTH_OPTIONS.map((option) => (
                      <label
                        key={option.id}
                        className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs text-stone-700 dark:text-stone-300 hover:bg-stone-50 dark:bg-white/5"
                      >
                        <input
                          type="radio"
                          name="explanation-depth"
                          checked={explanationDepth === option.id}
                          onChange={() => updateExplanationDepth(option.id)}
                          className="h-3.5 w-3.5 accent-stone-950 dark:accent-stone-100"
                        />
                        {t(`workspace.depth.${option.id}`)}
                      </label>
                    ))}
                  </div>
                </>
              )}
            </div>
            <span className="h-5 w-px bg-stone-200 dark:bg-white/15" aria-hidden="true" />
            {/* 重点不是一个独立模式：层级是重点的内部选项，在重点下拉里多选叠加 */}
            <div className="relative">
              <Tooltip content={t('workspace.layerTooltip')}>
                <button
                  type="button"
                  onClick={() => {
                    setLayerMenuOpen((open) => !open);
                    setMoreMenuOpen(false);
                    setPrecisionMenuOpen(false);
                  }}
                  aria-label={t('workspace.layerAria')}
                  aria-expanded={layerMenuOpen}
                  className={`flex h-8 items-center gap-1.5 rounded px-2 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-stone-400 ${anyLayerVisible ? 'bg-white text-stone-900 shadow-sm dark:bg-white/10 dark:text-stone-100' : 'text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100'}`}
                >
                  <Highlighter size={14} />
                  {t('workspace.layerTitle')}
                  <ChevronDown size={12} aria-hidden="true" />
                </button>
              </Tooltip>
              {layerMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" aria-hidden="true" onClick={() => setLayerMenuOpen(false)} />
                  <div className="absolute right-0 top-9 z-50 w-52 rounded-md border border-zinc-200 bg-white p-2 shadow-lg dark:border-stone-700 dark:bg-stone-900">
                    <p className="px-2 pb-1 text-[11px] text-stone-500 dark:text-stone-400">{t('workspace.layerHint')}</p>
                    {LAYER_OPTIONS.map((option) => (
                      <label
                        key={option.id}
                        className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs text-stone-700 dark:text-stone-300 hover:bg-stone-50 dark:bg-white/5"
                      >
                        <input
                          type="checkbox"
                          checked={layerVisibility[option.id] !== false}
                          onChange={() => updateLayerVisibility({ ...layerVisibility, [option.id]: layerVisibility[option.id] === false })}
                          className="h-3.5 w-3.5 accent-stone-950 dark:accent-stone-100"
                        />
                        {t(`workspace.layer.${option.id}`)}
                      </label>
                    ))}
                    <button
                      type="button"
                      onClick={() => updateLayerVisibility(
                        allLayersVisible
                          ? Object.fromEntries(LAYER_OPTIONS.map((option) => [option.id, false]))
                          : { ...DEFAULT_LAYERS }
                      )}
                      className="mt-1 w-full rounded border border-stone-200 dark:border-stone-800 px-2 py-1 text-xs text-stone-600 dark:text-stone-400 hover:bg-stone-50 dark:bg-white/5"
                    >
                      {allLayersVisible ? t('workspace.hideAll') : t('workspace.showAll')}
                    </button>
                    {/* 标记规则说明：划线/高亮与框线的区分依据，避免用户困惑 */}
                    <p className="mt-1.5 border-t border-stone-100 dark:border-stone-800 px-2 pt-1.5 text-[10px] leading-4 text-stone-400">
                      {t('workspace.markRule')}
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>
          )}
          {/* 图解画布下提供返回阅读的显式出口，不靠刷新页面回阅读视图；独立图解工作区用导航「阅读」返回 */}
          {diagramMode && !standaloneDiagram && (
            <button
              type="button"
              onClick={() => {
                setRightPanelView('knowledge');
                onToolChange?.('read');
              }}
              aria-label={t('workspace.backToReading')}
              className="flex h-9 shrink-0 items-center gap-1.5 rounded border border-stone-200 dark:border-stone-800 px-2.5 text-xs font-medium text-stone-600 dark:text-stone-400 outline-none hover:bg-stone-50 dark:bg-white/5 focus-visible:ring-2 focus-visible:ring-stone-400"
            >
              <BookOpen size={15} aria-hidden="true" />
              {t('workspace.backToReading')}
            </button>
          )}
          {/* 更多：生成动作与管理项合并收纳，减少顶栏按钮；图解画布下仅保留生成图解；独立图解工作区的动作都在右侧面板，整个下拉收起 */}
          {!standaloneDiagram && (
          <div className="relative shrink-0">
            <Tooltip content={t('workspace.moreTooltip')}>
              <button
                type="button"
                onClick={() => {
                  setMoreMenuOpen((open) => !open);
                  setLayerMenuOpen(false);
                  setPrecisionMenuOpen(false);
                }}
                aria-label={t('workspace.more')}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded text-stone-600 dark:text-stone-400 outline-none hover:bg-stone-100 dark:hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-stone-400"
              >
                {busyAction || diagramState.isGenerating ? <LoaderCircle size={17} className="animate-spin" /> : <MoreHorizontal size={17} />}
              </button>
            </Tooltip>
            {moreMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" aria-hidden="true" onClick={() => setMoreMenuOpen(false)} />
                <div className="absolute right-0 top-10 z-50 w-52 rounded-md border border-zinc-200 bg-white p-1.5 shadow-lg dark:border-stone-700 dark:bg-stone-900">
                  {/* 一键生成从文档库收进下拉：复合动作置顶，与单项生成用分隔线区隔 */}
                  <button
                    type="button"
                    onClick={() => { setMoreMenuOpen(false); analyzeDocument(); }}
                    disabled={Boolean(busyAction)}
                    title={t('workspace.oneClickTitle')}
                    className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs text-stone-700 dark:text-stone-300 outline-none hover:bg-stone-50 dark:bg-white/5 focus-visible:ring-2 focus-visible:ring-stone-400 disabled:cursor-not-allowed disabled:text-stone-300 dark:text-stone-600"
                  >
                    <WandSparkles size={14} className="shrink-0" />
                    <span className="min-w-0 flex-1">{t('workspace.oneClick')}</span>
                    {busyAction && <LoaderCircle size={13} className="animate-spin text-stone-400" aria-hidden="true" />}
                  </button>
                  <div className="mx-2 my-1.5 border-t border-stone-100 dark:border-stone-800" aria-hidden="true" />
                  <button
                    type="button"
                    onClick={() => { setMoreMenuOpen(false); generateFullDiagram(); }}
                    disabled={diagramState.isGenerating}
                    title={t('workspace.genOverviewTitle')}
                    className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs text-stone-700 dark:text-stone-300 outline-none hover:bg-stone-50 dark:bg-white/5 focus-visible:ring-2 focus-visible:ring-stone-400 disabled:cursor-not-allowed disabled:text-stone-300 dark:text-stone-600"
                  >
                    <Waypoints size={14} className="shrink-0" />
                    <span className="min-w-0 flex-1">{t('workspace.genOverview')}</span>
                    <span className="text-[10px] text-stone-400">Mermaid</span>
                    {diagramState.isGenerating && <LoaderCircle size={13} className="animate-spin text-stone-400" aria-hidden="true" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setMoreMenuOpen(false); generateDeepDiagram(); }}
                    disabled={diagramState.isGenerating}
                    title={t('workspace.genDeepDiagramTitle')}
                    className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs text-stone-700 dark:text-stone-300 outline-none hover:bg-stone-50 dark:bg-white/5 focus-visible:ring-2 focus-visible:ring-stone-400 disabled:cursor-not-allowed disabled:text-stone-300 dark:text-stone-600"
                  >
                    <Network size={14} className="shrink-0" />
                    <span className="min-w-0 flex-1">{t('workspace.genDeepDiagram')}</span>
                    <span className="text-[10px] text-stone-400">Excalidraw</span>
                    {diagramState.isGenerating && <LoaderCircle size={13} className="animate-spin text-stone-400" aria-hidden="true" />}
                  </button>
                  {/* 生成重点/解读/闪卡属于阅读场景能力，整块画布下只保留生成图解（分栏形态下阅读区可见，保留全部）；
                      术语表管理已移到全局顶栏「配置」下拉 */}
                  {(!diagramMode || diagramSplit) && (
                  <>
                  <button
                    type="button"
                    onClick={() => { setMoreMenuOpen(false); analyzeHighlights(); }}
                    disabled={Boolean(busyAction)}
                    title={t('workspace.genHighlightTitle')}
                    className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs text-stone-700 dark:text-stone-300 outline-none hover:bg-stone-50 dark:bg-white/5 focus-visible:ring-2 focus-visible:ring-stone-400 disabled:cursor-not-allowed disabled:text-stone-300 dark:text-stone-600"
                  >
                    <Highlighter size={14} className="shrink-0" />
                    <span className="min-w-0 flex-1">{t('workspace.genHighlight')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => { setMoreMenuOpen(false); analyzeInlineAid(); }}
                    disabled={Boolean(busyAction)}
                    title={t('workspace.genExplainTitle')}
                    className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs text-stone-700 dark:text-stone-300 outline-none hover:bg-stone-50 dark:bg-white/5 focus-visible:ring-2 focus-visible:ring-stone-400 disabled:cursor-not-allowed disabled:text-stone-300 dark:text-stone-600"
                  >
                    <Sparkles size={14} className="shrink-0" />
                    <span className="min-w-0 flex-1">{t('workspace.genExplain')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => { setMoreMenuOpen(false); generateFlashcards(); }}
                    disabled={Boolean(busyAction)}
                    title={t('workspace.genFlashcardTitle')}
                    className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs text-stone-700 dark:text-stone-300 outline-none hover:bg-stone-50 dark:bg-white/5 focus-visible:ring-2 focus-visible:ring-stone-400 disabled:cursor-not-allowed disabled:text-stone-300 dark:text-stone-600"
                  >
                    <Brain size={14} className="shrink-0" />
                    <span className="min-w-0 flex-1">{t('workspace.genFlashcard')}</span>
                  </button>
                  {(() => {
                    const presets = getConfig()?.promptPresets || [];
                    if (presets.length === 0) return null;
                    return (
                      <label className="mt-1 block border-t border-stone-100 dark:border-stone-800 px-2 pb-1.5 pt-2 text-[11px] text-stone-500 dark:text-stone-400">
                        {t('workspace.presetHeading')}
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
                          aria-label={t('workspace.presetAria')}
                          className="mt-1 w-full rounded border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 px-2 py-1.5 text-xs text-stone-700 dark:text-stone-300 outline-none focus-visible:ring-2 focus-visible:ring-stone-400"
                        >
                          <option value="">{t('workspace.noPreset')}</option>
                          {presets.map((preset) => (
                            <option key={preset.id} value={preset.id}>{preset.name || t('workspace.unnamedPreset')}</option>
                          ))}
                        </select>
                      </label>
                    );
                  })()}
                  </>
                  )}
                </div>
              </>
            )}
          </div>
          )}
          {headerStatus}
          {/* 右侧面板开关：桌面直接收起/展开整列，窄屏保持打开 Sheet 的原行为；图标全断点统一为带箭头族 */}
          <Tooltip content={rightPanelExpanded ? t('workspace.collapseRightPanel') : t('workspace.expandRightPanel')}>
            <button
              type="button"
              onClick={() => { if (isDesktop) updateRightCollapsed(!rightCollapsed); else setKnowledgeOpen(true); }}
              aria-label={rightPanelExpanded ? t('workspace.collapseRightPanel') : t('workspace.expandRightPanel')}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded text-stone-600 dark:text-stone-400 outline-none hover:bg-stone-100 dark:hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-stone-400"
            >
              {rightPanelExpanded ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}
            </button>
          </Tooltip>
        </header>
        )}

        {notice && (
          <div className={`flex min-h-9 shrink-0 items-center gap-2 border-b px-4 text-xs ${notice.type === 'error' ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300' : notice.type === 'demo' ? 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300' : 'border-stone-200 dark:border-stone-700 bg-stone-100 dark:bg-white/10 text-stone-900 dark:text-stone-200'}`}>
            {notice.type === 'error' ? <TriangleAlert size={14} /> : <CheckCircle2 size={14} />}
            {/* 通知支持 messageKey：回调里只存 i18n 键，此处按当前语言渲染，切换语言即时生效 */}
            <span className="min-w-0 flex-1 truncate">{notice.messageKey ? t(notice.messageKey, notice.params) : notice.message}</span>
            <button type="button" onClick={() => setNotice(null)} className="shrink-0 px-1 font-medium">{t('common.close')}</button>
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
                <div className="relative h-full min-h-0">
                  {diagramSplit ? (
                    <ResizablePanelGroup orientation="horizontal" id="reader-diagram-split">
                      <ResizablePanel id="reader-split-article" defaultSize="55%" minSize="320px">
                        <section className="h-full min-h-0" aria-label={t('workspace.readingArea')}>{readingSurface}</section>
                      </ResizablePanel>
                      <ResizableHandle />
                      <ResizablePanel id="reader-split-canvas" defaultSize="45%" minSize="320px">
                        {diagramCanvas}
                      </ResizablePanel>
                    </ResizablePanelGroup>
                  ) : rightPanelView === 'diagram' ? (
                    diagramCanvas
                  ) : (
                    <section className="h-full min-h-0" aria-label={t('workspace.readingArea')}>{readingSurface}</section>
                  )}
                  {standaloneDiagram && rightCollapsed ? (
                    <button
                      type="button"
                      onClick={() => updateRightCollapsed(false)}
                      title={t('workspace.expandRightPanel')}
                      aria-label={t('workspace.expandRightPanel')}
                      className="absolute right-3 top-3 z-20 flex h-9 w-9 items-center justify-center rounded border border-stone-200 bg-white/95 text-stone-600 shadow-sm outline-none hover:bg-stone-100 hover:text-stone-900 focus-visible:ring-2 focus-visible:ring-stone-400 dark:border-stone-700 dark:bg-stone-900/95 dark:text-stone-400 dark:hover:bg-white/10 dark:hover:text-stone-100"
                    >
                      <PanelRightOpen size={18} aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
              </ResizablePanel>
              {/* 右栏折叠时整列移出布局，主区自动占满；独立图解收起后由画布内按钮恢复。 */}
              {!rightCollapsed && (
                <>
                  <ResizableHandle />
                  <ResizablePanel id="reader-knowledge" defaultSize={isHomeLayout ? '28%' : '23%'} minSize="260px" maxSize="440px">
                    {rightPanel}
                  </ResizablePanel>
                </>
              )}
            </ResizablePanelGroup>
          ) : (
            <section className="h-full min-h-0" aria-label={rightPanelView === 'diagram' ? (standaloneDiagram ? t('workspace.freeDiagramCanvas') : t('workspace.docDiagramArea')) : t('workspace.readingArea')}>
              {rightPanelView === 'diagram' ? diagramCanvas : readingSurface}
            </section>
          )}
        </div>

        <footer className="flex min-h-8 shrink-0 items-center justify-between border-t border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 px-4 text-[11px] text-stone-500 dark:text-stone-400">
          <span className="flex min-w-0 items-center gap-1.5 truncate">
            <BookOpen size={13} className="shrink-0" />
            {standaloneDiagram
              ? t('workspace.freeDiagramCount', { count: currentDrawings.length })
              : t('workspace.progressSummary', { progress: sessions[currentDocument.id]?.progress || 0, count: currentExplanations.length })}
          </span>
          <button
            type="button"
            onClick={() => setSyncOpen(true)}
            title={t('workspace.openSync')}
            className="flex items-center gap-1.5 transition-colors hover:text-stone-900 dark:hover:text-stone-100"
          >
            <Library size={13} /> {t('workspace.localBadge')}
          </button>
        </footer>

        <Sheet open={libraryOpen} onOpenChange={setLibraryOpen}>
          <SheetContent title={t('workspace.librarySheet')} side="left">{library}</SheetContent>
        </Sheet>
        <Sheet open={knowledgeOpen} onOpenChange={setKnowledgeOpen}>
          <SheetContent
            title={rightPanelView === 'diagram' ? (standaloneDiagram ? t('workspace.freeDiagram') : t('workspace.docRelationDiagram')) : t('workspace.knowledgePanel')}
            side="right"
            hideClose={rightPanelView !== 'diagram'}
          >
            {rightPanelView === 'diagram' ? diagram : renderKnowledge(sheetInlineClose)}
          </SheetContent>
        </Sheet>
        {!onOpenHistory && (
          <HistoryModal
            isOpen={internalHistoryOpen}
            onClose={() => setInternalHistoryOpen(false)}
            onApply={applyHistoryDrawing}
            documentId={diagramDocumentId}
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
          actions={unifiedToolbarActions}
          onSave={saveCustomAction}
          onSaveBuiltin={saveBuiltinAction}
          onRemove={removeCustomAction}
          onToggle={toggleToolbarAction}
          onMove={moveToolbarAction}
        />
        <Modal
          isOpen={Boolean(customActionResult)}
          onClose={() => setCustomActionResult(null)}
          title={customActionResult ? t('workspace.toolbarResultNamed', { name: customActionResult.name }) : t('workspace.toolbarResult')}
        >
          {customActionResult && (
            <div className="space-y-4 text-sm text-stone-800 dark:text-stone-200">
              <div className="rounded border border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-white/5 p-3">
                <p className="mb-1 text-[11px] font-medium text-stone-500">{t('workspace.selection')}</p>
                <p className="max-h-24 overflow-auto whitespace-pre-wrap text-xs text-stone-600 dark:text-stone-400">{customActionResult.selection}</p>
              </div>
              <div>
                <p className="mb-1 text-[11px] font-medium text-stone-500">{t('workspace.result')}</p>
                <p className="whitespace-pre-wrap leading-6">{customActionResult.result}</p>
              </div>
            </div>
          )}
        </Modal>
      </main>
    </TooltipProvider>
  );
}
