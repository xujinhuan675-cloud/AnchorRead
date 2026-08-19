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
  PanelRight,
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
import { Sheet, SheetContent } from '@/components/ui/sheet';
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

// 阅读辅助都是叠加在原文之上的可选层：多选多生效，全部关闭即纯原文
const AID_OPTIONS = Object.freeze([
  { id: 'explanations', label: '解读' },
  { id: 'diagrams', label: '图解' },
  { id: 'precision', label: '白话' },
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

// 白话解释深度档位：与重点层级同为阅读偏好，localStorage 持久化
// 档位以读者对文档的熟悉度命名：初次接触需要全面拆解，熟练掌握只需点拨生僻处
// 冒号后统一为“解释 + 覆盖范围”的并列结构，与后端提示词档位语义一一对应
const EXPLANATION_DEPTH_OPTIONS = Object.freeze([
  { id: 'deep', label: '初次接触：解释术语、复杂句式与背景知识' },
  { id: 'standard', label: '有所接触：解释术语与专业表达' },
  { id: 'light', label: '熟练掌握：只解释生僻术语与缩写' },
]);

// 白话呈现方式：两种形态共用同一批映射，只决定“替你看”还是“教你认”；localStorage 持久化
const CLOZE_PRESENTATION_OPTIONS = Object.freeze([
  { id: 'plain', label: '白话优先：替换后悬浮看原文' },
  { id: 'original', label: '原文优先：框出术语悬浮看白话' },
]);

function readStoredClozePresentation() {
  if (typeof window === 'undefined') return 'plain';
  return window.localStorage.getItem('anchor-read-cloze-presentation') === 'original' ? 'original' : 'plain';
}

// 按文档分组的填空记录（翻开态 / 难点标记）：{ [documentId]: { [mappingKey]: timestamp } }
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
const CONFIG_MISSING_ERROR = '未检测到可用模型配置，请先在设置中配置模型后再使用 AI 功能。';

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
  onToolChange,
  onOpenHistory,
  onCurrentDocumentChange,
  historyDrawing,
  headerStatus = null,
  // 首页（无限画布风格）Hero 的「打开图解」：由宿主页面切到独立图解工作区
  onOpenDiagram = () => {},
}) {
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
  // 白话呈现方式与填空记录：翻开态（白话优先）与难点标记（原文优先）都按文档持久化，刷新不丢
  const [clozePresentation, setClozePresentation] = useState(readStoredClozePresentation);
  const [clozeRevealed, setClozeRevealed] = useState(() => readStoredClozeMap('anchor-read-cloze-revealed'));
  const [clozeLookups, setClozeLookups] = useState(() => readStoredClozeMap('anchor-read-cloze-lookups'));
  // 当前文档的填空状态集合：装饰层按 Set 判定翻开态与难点标记；
  // hooks 必须位于所有条件提前 return 之前，否则触发 Rules of Hooks 顺序错误
  const revealedClozeKeys = useMemo(() => new Set(Object.keys(clozeRevealed[currentDocumentId] || {})), [clozeRevealed, currentDocumentId]);
  const clozeLookupKeys = useMemo(() => new Set(Object.keys(clozeLookups[currentDocumentId] || {})), [clozeLookups, currentDocumentId]);
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
        setDrawings(storedDrawings.filter((drawing) => (
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
  }, [drawings, onToolChange, saveSession, sessions, standaloneDiagram]);

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

  // 填空翻开（白话优先）：按文档记录，刷新后保持已翻开状态
  const toggleCloze = useCallback((key) => {
    if (!key) return;
    setClozeRevealed((prev) => {
      const forDoc = { ...(prev[currentDocumentId] || {}) };
      if (forDoc[key]) delete forDoc[key];
      else forDoc[key] = 1;
      return { ...prev, [currentDocumentId]: forDoc };
    });
  }, [currentDocumentId]);

  // 原文优先：悬浮满阈值即记难点（已记录不重复写，避免重渲染）；点击可手动切换纠正误记
  const recordClozeLookup = useCallback((key) => {
    if (!key) return;
    setClozeLookups((prev) => {
      const forDoc = prev[currentDocumentId] || {};
      if (forDoc[key]) return prev;
      return { ...prev, [currentDocumentId]: { ...forDoc, [key]: Date.now() } };
    });
  }, [currentDocumentId]);

  const toggleClozeLookup = useCallback((key) => {
    if (!key) return;
    setClozeLookups((prev) => {
      const forDoc = { ...(prev[currentDocumentId] || {}) };
      if (forDoc[key]) delete forDoc[key];
      else forDoc[key] = Date.now();
      return { ...prev, [currentDocumentId]: forDoc };
    });
  }, [currentDocumentId]);

  // 两个填空记录随状态整体落盘：初始挂载的回写幂等，写入成本与术语量同级
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('anchor-read-cloze-revealed', JSON.stringify(clozeRevealed));
    }
  }, [clozeRevealed]);
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('anchor-read-cloze-lookups', JSON.stringify(clozeLookups));
    }
  }, [clozeLookups]);

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
      throw new Error(CONFIG_MISSING_ERROR);
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
      throw new Error(CONFIG_MISSING_ERROR);
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
      throw new Error(CONFIG_MISSING_ERROR);
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
      setNotice({ type: 'error', message: error.message });
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
      setNotice({
        type: 'success',
        message: kind === 'highlights'
          ? (effectiveRecords.length === 0
            ? '当前锚点已有解读记录覆盖，重点高亮不再重复叠加。'
            : `已在原文中高亮 ${effectiveRecords.length} 处全文重点。`)
          : `已定位 ${result.anchors.length} 个原文重点，并保存 ${effectiveRecords.length} 条解读。`,
      });
    } catch (error) {
      setNotice({ type: 'error', message: error.message });
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
        throw new Error(CONFIG_MISSING_ERROR);
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
    () => drawings.filter((drawing) => drawing.documentId === diagramDocumentId),
    [diagramDocumentId, drawings]
  );
  const activeDrawing = currentDrawings.find((drawing) => drawing.id === activeDrawingId) || currentDrawings[0] || null;

  const selectDrawing = useCallback((drawingId) => {
    setActiveDrawingId(drawingId);
    saveSession(diagramDocumentId, { activeDrawingId: drawingId }).catch(console.error);
  }, [diagramDocumentId, saveSession]);

  const createDrawing = useCallback(async (drawing) => {
    await workspaceRepository.drawings.save(drawing);
    setDrawings((current) => [drawing, ...current.filter((item) => item.id !== drawing.id)]);
    setActiveDrawingId(drawing.id);
    // 划词图解留在原文就地插入，不切到图解画布；其余入口照旧跳转展示
    const stayInline = inlineDiagramRef.current;
    inlineDiagramRef.current = false;
    if (!stayInline) setRightPanelView('diagram');
    await saveSession(drawing.documentId, { activeDrawingId: drawing.id });
  }, [saveSession]);

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
    }).catch((error) => setNotice({ type: 'error', message: error.message }));
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
    }).catch((error) => setNotice({ type: 'error', message: error.message }));
  }, [createDrawing, diagramDocument, historyDrawing]);

  const persistDrawing = useCallback(async (drawing) => {
    await workspaceRepository.drawings.save(drawing);
    setDrawings((current) => current.map((item) => item.id === drawing.id ? drawing : item));
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
    await saveSession(diagramDocumentId, { activeDrawingId: remaining[0]?.id || '' });
  }, [currentDrawings, diagramDocumentId, saveSession]);

  const openDiagram = useCallback((drawingId) => {
    setActiveDrawingId(drawingId);
    saveSession(diagramDocumentId, { activeDrawingId: drawingId }).catch(console.error);
    setRightPanelView('diagram');
    onToolChange?.('diagram');
  }, [diagramDocumentId, onToolChange, saveSession]);

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
      setNotice({ type: 'demo', message: '图解正在生成中，请稍候再试。' });
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
    setNotice({ type: 'success', message: '正在为选区生成图解，完成后插入原文下方。' });
    await diagramState.generate(
      '请围绕这段原文建模，梳理其中的核心概念与它们之间的关系，生成一张图解',
      'auto',
      'text',
      'mermaid',
      anchor
    );
    inlineDiagramRef.current = false;
    setPendingInlineDiagram(null);
  }, [aidVisibility, currentDocument, diagramState, updateAids]);

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
          throw new Error(CONFIG_MISSING_ERROR);
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
        setNotice({ type: 'success', message: '回答已保存到此浏览器。' });
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
        setNotice({ type: 'success', message: '解读已保存到此浏览器。' });
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
        setNotice({ type: 'success', message: `${nextTerms.length} 条白话已附着到当前文档。` });
      }
    } catch (error) {
      setNotice({ type: 'error', message: error.message });
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
    setNotice({
      type: 'success',
      message: decision === 'register'
        ? `术语「${candidate.term}」已入术语表，后续解读将沿用此定义。`
        : `候选词条「${candidate.term}」已忽略。`,
    });
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
      const suggested = `anchor-read-backup-${new Date().toISOString().slice(0, 10)}.anchorread`;
      // 优先用保存对话框让用户自选位置落盘单个备份文件，不支持时回退浏览器下载
      if (supportsSaveFilePicker()) {
        const savedName = await saveWorkspaceFileWithPicker(payload, suggested);
        setNotice({ type: 'success', message: `备份已保存为「${savedName}」。` });
        return;
      }
      downloadWorkspaceFile(payload, suggested);
      setNotice({ type: 'success', message: 'JSON 备份已开始下载。' });
    } catch (error) {
      if (error?.name === 'AbortError') return; // 用户在对话框取消，不提示
      setNotice({ type: 'error', message: error.message });
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
    setNotice({ type: 'success', message: `浮动工具栏动作「${action.name}」已保存。` });
  }, [customActions]);

  const removeCustomAction = useCallback(async (id) => {
    await workspaceRepository.customActions.remove(id);
    setCustomActions((current) => current.filter((item) => item.id !== id));
    setNotice({ type: 'success', message: '浮动工具栏动作已删除。' });
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
    updateToolbarBuiltin(id, { name, description, promptTemplate });
    setNotice({ type: 'success', message: `浮动工具栏动作「${name}」已保存。` });
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
        setNotice({ type: 'error', message: '还没有解读、白话或闪卡，先产生派生内容再导出。' });
        return;
      }
      const subFolder = `anchor-read-${new Date().toISOString().slice(0, 10)}`;
      if (supportsDirectoryPicker()) {
        const { folderName, count } = await saveObsidianNotesToDirectory(notes, subFolder);
        setNotice({ type: 'success', message: `${count} 篇 Obsidian 笔记已写入「${folderName}」文件夹，直接纳入你的 vault 即可。` });
        return;
      }
      // Firefox/Safari 等不支持目录选择的浏览器，回退为 zip 下载
      await downloadObsidianZip(notes, `anchor-read-obsidian-${new Date().toISOString().slice(0, 10)}.zip`);
      setNotice({ type: 'success', message: `当前浏览器不支持直接写文件夹，已打包 ${notes.length} 篇笔记，解压后放入你的 vault 即可。` });
    } catch (error) {
      if (error?.name === 'AbortError') return; // 用户在选择器取消，不提示
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
      <main className="flex h-full min-h-0 items-center justify-center bg-[#f5f7f6] text-sm text-stone-500">
        <Sparkles size={17} className="mr-2 animate-pulse text-stone-950 dark:text-stone-100" />
        正在打开本地阅读工作区...
      </main>
    );
  }

  if (isHomeLayout && !homeStarted) {
    return (
      <TooltipProvider>
        <main className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-stone-950">
          {/* 隐私提示全局常驻：首页同样显示 */}
          <PrivacyNoticeBar onExport={exportBackup} />
          <ReaderHome
            recentDocuments={recentDocuments}
            hasExistingDocuments={documents.length > 0}
            busy={busyAction === 'parse'}
            error={notice?.type === 'error' ? notice.message : ''}
            onSubmit={parseAndOpenDocument}
            onOpenExisting={() => setHomeStarted(true)}
            onOpenDocument={openRecentDocument}
            onOpenDiagram={onOpenDiagram}
          />
        </main>
      </TooltipProvider>
    );
  }
  if (!currentDocument) {
    return (
      <main className="flex h-full min-h-0 items-center justify-center bg-[#f5f7f6] text-sm text-stone-500">
        <Sparkles size={17} className="mr-2 animate-pulse text-stone-950 dark:text-stone-100" />
        正在打开本地阅读工作区...
      </main>
    );
  }

  // 图解画布形态：阅读区不渲染，解读/白话/重点等阅读专属控件随之收起
  const diagramMode = rightPanelView === 'diagram';
  // 分栏形态：宽屏下原文与图解画布并排，边读边看；窄屏退回整块画布
  const diagramSplit = diagramMode && !standaloneDiagram && isDesktop && isWide;

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
      onAnalyzeDocument={analyzeDocument}
      analysisBusy={Boolean(busyAction)}
      analysisDisabled={Boolean(busyAction && busyAction !== 'analysis' && busyAction !== 'flashcards')}
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
      onExportAnki={exportAnki}
      onExportObsidian={exportObsidian}
      isStale={isDerivationStale}
      flashcardSignal={flashcardPanelSignal}
      panelFocus={panelFocus}
    />
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
      clozeLookups={clozeLookupKeys}
      onToggleCloze={toggleCloze}
      onToggleClozeLookup={toggleClozeLookup}
      onHoverClozeLookup={recordClozeLookup}
      onMaster={toggleMastery}
      onDelete={deleteExplanation}
      onRegisterCandidate={(record, index) => reviewGlossaryCandidate(record.id, index, 'register')}
      onDismissCandidate={(record, index) => reviewGlossaryCandidate(record.id, index, 'dismiss')}
      onFocus={focusPanelFromMark}
      onProgress={persistProgress}
      initialScrollTop={sessions[currentDocument.id]?.scrollTop || 0}
      focusRange={focusRange}
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
    />
  );
    const diagramCanvas = <DocumentDiagramCanvas diagram={diagramState} standalone={standaloneDiagram} onOpenChat={standaloneDiagram ? () => setKnowledgeOpen(true) : null} />;
    const rightPanel = rightPanelView === 'diagram' ? diagram : knowledge;
  // 图解画布形态：阅读区不渲染，解读/白话/重点等阅读专属控件随之收起，顶栏只留图解相关动作

  return (
    <TooltipProvider>
      <main className="flex h-full min-h-0 flex-col overflow-hidden bg-[#f3f5f4] text-stone-950 dark:text-stone-100">
        <PrivacyNoticeBar onExport={exportBackup} />

        {/* 独立图解工作区：顶栏「图解」已表明当前视图，header 行只剩标题太浪费，
            整行移除让下方画布与面板直接提上来；文档绑定形态照常保留 header */}
        {!standaloneDiagram && (
        <header className="z-20 flex min-h-[62px] shrink-0 items-center gap-3 border-b border-stone-200 dark:border-stone-800 bg-white px-3 sm:px-4 lg:px-6">
          {/* 文档库入口只在文档绑定形态有意义 */}
          {!standaloneDiagram && (
          <Tooltip content={isDesktop && !isHomeLayout ? (libraryCollapsed ? '展开文档库' : '折叠文档库') : '打开文档库'}>
            <button
              type="button"
              onClick={() => {
                if (isDesktop && !isHomeLayout) updateLibraryCollapsed(!libraryCollapsed);
                else setLibraryOpen(true);
              }}
              aria-label={isDesktop && !isHomeLayout ? (libraryCollapsed ? '展开文档库' : '折叠文档库') : '打开文档库'}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded text-stone-600 dark:text-stone-400 outline-none hover:bg-stone-100 dark:hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-stone-400"
            >
              {/* 侧边栏样式图标：展开态点按收起，收起/窄屏态点按展开 */}
              {isDesktop && !isHomeLayout && !libraryCollapsed ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
            </button>
          </Tooltip>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold text-stone-950 dark:text-stone-100 sm:text-base">{currentDocument.title}</h1>
            <p className="mt-0.5 flex items-center gap-2 truncate text-[11px] text-stone-500">
              <span>{currentDocument.category}</span>
              <span aria-hidden="true">·</span>
              <span>{currentDocument.readMinutes} 分钟</span>
              <span className="hidden sm:inline" aria-hidden="true">·</span>
              <span className="hidden sm:inline">更新于 {formatDate(currentDocument.updatedAt)}</span>
            </p>
          </div>
          {/* 显示组：多选辅助 + 层级可见性常驻可见；生成/管理动作收纳进右侧下拉；整块画布下阅读区不存在，整组收起（分栏形态下阅读区可见，控件保留） */}
          {(!diagramMode || diagramSplit) && (
          <div className="flex shrink-0 items-center gap-1 rounded-md border border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-white/5 p-1">
            <div className="flex items-center gap-1" aria-label="内联辅助显示">
              {AID_OPTIONS.filter((option) => option.id !== 'precision').map((option) => {
                const active = Boolean(aidVisibility[option.id]);
                const tooltip = `在原文中${active ? '隐藏' : '显示'}${option.label}`;
                return (
                  <Tooltip key={option.id} content={tooltip}>
                    <button
                      type="button"
                      onClick={() => toggleAid(option.id)}
                      aria-pressed={active}
                      aria-label={`${active ? '关闭' : '打开'}${option.label}`}
                      className={`flex h-8 items-center gap-1.5 rounded px-2 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-stone-400 ${active ? 'bg-white text-stone-900 shadow-sm dark:bg-white/10 dark:text-stone-100' : 'text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100'}`}
                    >
                      {option.id === 'explanations'
                        ? <MessageSquareText size={14} />
                        : <Network size={14} />}
                      {option.label}
                    </button>
                  </Tooltip>
                );
              })}
            </div>
            <span className="h-5 w-px bg-stone-200 dark:bg-white/15" aria-hidden="true" />
            {/* 白话与重点同形态：入口是带下拉的 tab，开关与解释深度档位收纳在下拉里 */}
            <div className="relative">
              <Tooltip content="应用白话：把难懂表述换成易懂说法，并选择解释深度档位">
                <button
                  type="button"
                  onClick={() => {
                    setPrecisionMenuOpen((open) => !open);
                    setLayerMenuOpen(false);
                    setMoreMenuOpen(false);
                  }}
                  aria-label="白话与解释深度"
                  aria-expanded={precisionMenuOpen}
                  className={`flex h-8 items-center gap-1.5 rounded px-2 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-stone-400 ${aidVisibility.precision ? 'bg-white text-stone-900 shadow-sm dark:bg-white/10 dark:text-stone-100' : 'text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100'}`}
                >
                  <WandSparkles size={14} />
                  白话
                  <ChevronDown size={12} aria-hidden="true" />
                </button>
              </Tooltip>
              {precisionMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" aria-hidden="true" onClick={() => setPrecisionMenuOpen(false)} />
                  <div className="absolute right-0 top-9 z-50 w-60 rounded-md border border-zinc-200 bg-white p-2 shadow-lg">
                    <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs text-stone-700 dark:text-stone-300 hover:bg-stone-50 dark:bg-white/5">
                      <input
                        type="checkbox"
                        checked={Boolean(aidVisibility.precision)}
                        onChange={() => toggleAid('precision')}
                        className="h-3.5 w-3.5 accent-stone-950 dark:accent-stone-100"
                      />
                      {aidVisibility.precision ? '还原原文（关闭白话）' : '应用白话替换'}
                    </label>
                    <p className="px-2 pb-1 pt-1.5 text-[11px] text-stone-500">呈现方式</p>
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
                        {option.label}
                      </label>
                    ))}
                    <p className="px-2 pb-1 pt-1.5 text-[11px] text-stone-500">解释深度（下次一键生成时生效）</p>
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
                        {option.label}
                      </label>
                    ))}
                  </div>
                </>
              )}
            </div>
            <span className="h-5 w-px bg-stone-200 dark:bg-white/15" aria-hidden="true" />
            {/* 重点不是一个独立模式：层级是重点的内部选项，在重点下拉里多选叠加 */}
            <div className="relative">
              <Tooltip content="显示原文重点，并选择要叠加展示的重点层级（文章/段落/句子/词语）">
                <button
                  type="button"
                  onClick={() => {
                    setLayerMenuOpen((open) => !open);
                    setMoreMenuOpen(false);
                    setPrecisionMenuOpen(false);
                  }}
                  aria-label="重点可见层级"
                  aria-expanded={layerMenuOpen}
                  className={`flex h-8 items-center gap-1.5 rounded px-2 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-stone-400 ${anyLayerVisible ? 'bg-white text-stone-900 shadow-sm dark:bg-white/10 dark:text-stone-100' : 'text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100'}`}
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
                    <p className="px-2 pb-1 text-[11px] text-stone-500">重点层级（多选叠加，只影响重点标记，不影响解读/图解）</p>
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
                      className="mt-1 w-full rounded border border-stone-200 dark:border-stone-800 px-2 py-1 text-xs text-stone-600 dark:text-stone-400 hover:bg-stone-50 dark:bg-white/5"
                    >
                      {allLayersVisible ? '全部隐藏' : '全部展示'}
                    </button>
                    {/* 标记规则说明：划线/高亮与框线的区分依据，避免用户困惑 */}
                    <p className="mt-1.5 border-t border-stone-100 dark:border-stone-800 px-2 pt-1.5 text-[10px] leading-4 text-stone-400">
                      标记规则：重要性 ≥ 4 的重点叠加高亮底色，其余仅划线；颜色对应角色。词语层用红框，成语为虚线框。
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
              aria-label="返回阅读"
              className="flex h-9 shrink-0 items-center gap-1.5 rounded border border-stone-200 dark:border-stone-800 px-2.5 text-xs font-medium text-stone-600 dark:text-stone-400 outline-none hover:bg-stone-50 dark:bg-white/5 focus-visible:ring-2 focus-visible:ring-stone-400"
            >
              <BookOpen size={15} aria-hidden="true" />
              返回阅读
            </button>
          )}
          {/* 更多：生成动作与管理项合并收纳，减少顶栏按钮；图解画布下仅保留生成图解；独立图解工作区的动作都在右侧面板，整个下拉收起 */}
          {!standaloneDiagram && (
          <div className="relative shrink-0">
            <Tooltip content="生成 AI 辅助与管理项">
              <button
                type="button"
                onClick={() => {
                  setMoreMenuOpen((open) => !open);
                  setLayerMenuOpen(false);
                  setPrecisionMenuOpen(false);
                }}
                aria-label="更多"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded text-stone-600 dark:text-stone-400 outline-none hover:bg-stone-100 dark:hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-stone-400"
              >
                {busyAction || diagramState.isGenerating ? <LoaderCircle size={17} className="animate-spin" /> : <MoreHorizontal size={17} />}
              </button>
            </Tooltip>
            {moreMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" aria-hidden="true" onClick={() => setMoreMenuOpen(false)} />
                <div className="absolute right-0 top-10 z-50 w-52 rounded-md border border-zinc-200 bg-white p-1.5 shadow-lg">
                  <button
                    type="button"
                    onClick={() => { setMoreMenuOpen(false); generateFullDiagram(); }}
                    disabled={diagramState.isGenerating}
                    title="梳理全文概念与关系，生成整篇关系图"
                    className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs text-stone-700 dark:text-stone-300 outline-none hover:bg-stone-50 dark:bg-white/5 focus-visible:ring-2 focus-visible:ring-stone-400 disabled:cursor-not-allowed disabled:text-stone-300 dark:text-stone-600"
                  >
                    <Waypoints size={14} className="shrink-0" />
                    <span className="min-w-0 flex-1">生成图解</span>
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
                    title="按层级高亮原文重点，不插入行间解读"
                    className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs text-stone-700 dark:text-stone-300 outline-none hover:bg-stone-50 dark:bg-white/5 focus-visible:ring-2 focus-visible:ring-stone-400 disabled:cursor-not-allowed disabled:text-stone-300 dark:text-stone-600"
                  >
                    <Highlighter size={14} className="shrink-0" />
                    <span className="min-w-0 flex-1">生成重点</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => { setMoreMenuOpen(false); analyzeInlineAid(); }}
                    disabled={Boolean(busyAction)}
                    title="在重点旁插入行间解读卡"
                    className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs text-stone-700 dark:text-stone-300 outline-none hover:bg-stone-50 dark:bg-white/5 focus-visible:ring-2 focus-visible:ring-stone-400 disabled:cursor-not-allowed disabled:text-stone-300 dark:text-stone-600"
                  >
                    <Sparkles size={14} className="shrink-0" />
                    <span className="min-w-0 flex-1">生成解读</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => { setMoreMenuOpen(false); generateFlashcards(); }}
                    disabled={Boolean(busyAction)}
                    title="基于重点生成间隔重复闪卡"
                    className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs text-stone-700 dark:text-stone-300 outline-none hover:bg-stone-50 dark:bg-white/5 focus-visible:ring-2 focus-visible:ring-stone-400 disabled:cursor-not-allowed disabled:text-stone-300 dark:text-stone-600"
                  >
                    <Brain size={14} className="shrink-0" />
                    <span className="min-w-0 flex-1">生成闪卡</span>
                  </button>
                  {(() => {
                    const presets = getConfig()?.promptPresets || [];
                    if (presets.length === 0) return null;
                    return (
                      <label className="mt-1 block border-t border-stone-100 dark:border-stone-800 px-2 pb-1.5 pt-2 text-[11px] text-stone-500">
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
                          className="mt-1 w-full rounded border border-stone-200 dark:border-stone-800 bg-white px-2 py-1.5 text-xs text-stone-700 dark:text-stone-300 outline-none focus-visible:ring-2 focus-visible:ring-stone-400"
                        >
                          <option value="">无预设</option>
                          {presets.map((preset) => (
                            <option key={preset.id} value={preset.id}>{preset.name || '未命名预设'}</option>
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
          {/* 右侧面板开关：桌面直接收起/展开整列，窄屏保持打开 Sheet 的原行为 */}
          <Tooltip content={isDesktop ? (rightCollapsed ? '展开右侧面板' : '收起右侧面板') : '打开知识面板'}>
            <button
              type="button"
              onClick={() => { if (isDesktop) updateRightCollapsed(!rightCollapsed); else setKnowledgeOpen(true); }}
              aria-label={isDesktop ? (rightCollapsed ? '展开右侧面板' : '收起右侧面板') : '打开知识面板'}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded text-stone-600 dark:text-stone-400 outline-none hover:bg-stone-100 dark:hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-stone-400"
            >
              {isDesktop
                ? (rightCollapsed ? <PanelRightOpen size={18} /> : <PanelRightClose size={18} />)
                : <PanelRight size={18} />}
            </button>
          </Tooltip>
        </header>
        )}

        {notice && (
          <div className={`flex min-h-9 shrink-0 items-center gap-2 border-b px-4 text-xs ${notice.type === 'error' ? 'border-red-200 bg-red-50 text-red-700' : notice.type === 'demo' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-stone-200 dark:border-stone-700 bg-stone-100 dark:bg-white/10 text-stone-900 dark:text-stone-200'}`}>
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
                {diagramSplit ? (
                  <ResizablePanelGroup orientation="horizontal" id="reader-diagram-split">
                    <ResizablePanel id="reader-split-article" defaultSize="55%" minSize="320px">
                      <section className="h-full min-h-0" aria-label="阅读区">{readingSurface}</section>
                    </ResizablePanel>
                    <ResizableHandle />
                    <ResizablePanel id="reader-split-canvas" defaultSize="45%" minSize="320px">
                      {diagramCanvas}
                    </ResizablePanel>
                  </ResizablePanelGroup>
                ) : rightPanelView === 'diagram' ? (
                  diagramCanvas
                ) : (
                  <section className="h-full min-h-0" aria-label="阅读区">{readingSurface}</section>
                )}
              </ResizablePanel>
              {/* 右栏折叠时整列移出布局，主区自动占满；与左侧文档库折叠同一模式；
                  独立图解工作区没有 header 开关，右栏是唯一输入入口，强制保持展开 */}
              {(standaloneDiagram || !rightCollapsed) && (
                <>
                  <ResizableHandle />
                  <ResizablePanel id="reader-knowledge" defaultSize={isHomeLayout ? '28%' : '23%'} minSize="260px" maxSize="440px">
                    {rightPanel}
                  </ResizablePanel>
                </>
              )}
            </ResizablePanelGroup>
          ) : (
            <section className="h-full min-h-0" aria-label={rightPanelView === 'diagram' ? (standaloneDiagram ? '自由图解画布' : '当前文档关系图') : '阅读区'}>
              {rightPanelView === 'diagram' ? diagramCanvas : readingSurface}
            </section>
          )}
        </div>

        <footer className="flex min-h-8 shrink-0 items-center justify-between border-t border-stone-200 dark:border-stone-800 bg-white px-4 text-[11px] text-stone-500">
          <span className="flex min-w-0 items-center gap-1.5 truncate">
            <BookOpen size={13} className="shrink-0" />
            {standaloneDiagram
              ? `${currentDrawings.length} 张自由图解`
              : `${sessions[currentDocument.id]?.progress || 0}% · ${currentExplanations.length} 条解读`}
          </span>
          <button
            type="button"
            onClick={() => setSyncOpen(true)}
            title="打开工作区备份与同步"
            className="flex items-center gap-1.5 transition-colors hover:text-stone-900 dark:text-stone-100"
          >
            <Library size={13} /> 本地工作区
          </button>
        </footer>

        <Sheet open={libraryOpen} onOpenChange={setLibraryOpen}>
          <SheetContent title="文档库" side="left">{library}</SheetContent>
        </Sheet>
        <Sheet open={knowledgeOpen} onOpenChange={setKnowledgeOpen}>
          <SheetContent title={rightPanelView === 'diagram' ? (standaloneDiagram ? '自由图解' : '文档关系图') : '知识面板'} side="right">{rightPanel}</SheetContent>
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
          title={customActionResult ? `浮动工具栏 · ${customActionResult.name}` : '浮动工具栏动作结果'}
        >
          {customActionResult && (
            <div className="space-y-4 text-sm text-stone-800 dark:text-stone-200">
              <div className="rounded border border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-white/5 p-3">
                <p className="mb-1 text-[11px] font-medium text-stone-500">选区</p>
                <p className="max-h-24 overflow-auto whitespace-pre-wrap text-xs text-stone-600 dark:text-stone-400">{customActionResult.selection}</p>
              </div>
              <div>
                <p className="mb-1 text-[11px] font-medium text-stone-500">结果</p>
                <p className="whitespace-pre-wrap leading-6">{customActionResult.result}</p>
              </div>
            </div>
          )}
        </Modal>
      </main>
    </TooltipProvider>
  );
}
