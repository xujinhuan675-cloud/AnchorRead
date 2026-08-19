import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function readSource(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

const homePage = readSource('../app/page.js');
const readerLabPage = readSource('../app/reader-lab/page.js');
const appTopNav = readSource('../components/AppTopNav.jsx');
const readerLabPageShell = readSource('../components/ReaderLabPageShell.jsx');
const readerLabWorkspace = readSource('../components/ReaderLabWorkspace.jsx');
const documentDiagramPanel = readSource('../components/reader-lab/DocumentDiagramPanel.jsx');
const documentDiagramCanvas = readSource('../components/reader-lab/DocumentDiagramCanvas.jsx');
const mermaidCanvas = readSource('../components/MermaidCanvas.jsx');
const readerQuickImport = readSource('../components/reader-lab/ReaderQuickImport.jsx');
const readerHome = readSource('../components/reader-lab/ReaderHome.jsx');
const knowledgePanel = readSource('../components/reader-lab/KnowledgePanel.jsx');
const readerSurfaceSource = readSource('../components/reader-lab/ReaderSurface.jsx');
const documentLibrary = readSource('../components/reader-lab/DocumentLibrary.jsx');
const sheetUi = readSource('../components/ui/sheet.jsx');
const customActionsLib = readSource('../lib/custom-actions.js');

test('the home reading mode and regression route share ReaderLabWorkspace', () => {
  assert.match(homePage, /import ReaderLabWorkspace from ['"]@\/components\/ReaderLabWorkspace['"]/);
  assert.equal((homePage.match(/<ReaderLabWorkspace\b/g) || []).length, 1);
  assert.match(homePage, /<ReaderLabWorkspace[\s\S]*?layout="home"[\s\S]*?requestedTool=\{mode === 'diagram' \? 'diagram' : 'read'\}/);
  assert.doesNotMatch(homePage, /<ArticlePanel\b/);

  assert.match(readerLabPage, /import ReaderLabPageShell from ['"]@\/components\/ReaderLabPageShell['"]/);
  assert.match(readerLabPage, /<ReaderLabPageShell \/>/);
  // 验证版路由同样挂全局顶栏，工作区保持单一实例；顶栏可跳回首页的两个视图
  assert.match(readerLabPageShell, /<AppTopNav[\s\S]*?activeSlug="reader-lab"/);
  assert.match(readerLabPageShell, /onNavigate=\{handleNavigate\}/);
  assert.match(readerLabPageShell, /router\.push\('\/\?view=diagram'\)/);
  // 顶栏「配置 → 浮动工具栏 / 术语表」都通过广播事件由工作台打开对应弹窗
  assert.match(readerLabPageShell, /onToolbarConfig=\{\(\) => window\.dispatchEvent\(new Event\(OPEN_TOOLBAR_CONFIG_EVENT\)\)\}/);
  assert.match(readerLabPageShell, /onGlossary=\{\(\) => window\.dispatchEvent\(new Event\(OPEN_GLOSSARY_EVENT\)\)\}/);
  assert.match(readerLabPageShell, /import ReaderLabWorkspace, \{ OPEN_GLOSSARY_EVENT, OPEN_TOOLBAR_CONFIG_EVENT \} from ['"]@\/components\/ReaderLabWorkspace['"]/);
  assert.match(homePage, /onToolbarConfig=\{\(\) => window\.dispatchEvent\(new Event\(OPEN_TOOLBAR_CONFIG_EVENT\)\)\}/);
  assert.match(homePage, /onGlossary=\{\(\) => window\.dispatchEvent\(new Event\(OPEN_GLOSSARY_EVENT\)\)\}/);
  assert.match(readerLabWorkspace, /export const OPEN_TOOLBAR_CONFIG_EVENT = ['"]anchor-read:open-toolbar-config['"]/);
  assert.match(readerLabWorkspace, /window\.addEventListener\(OPEN_TOOLBAR_CONFIG_EVENT, handleOpenToolbarConfig\)/);
  assert.match(readerLabWorkspace, /export const OPEN_GLOSSARY_EVENT = ['"]anchor-read:open-glossary['"]/);
  assert.match(readerLabWorkspace, /window\.addEventListener\(OPEN_GLOSSARY_EVENT, handleOpenGlossary\)/);
  // 术语表入口已从工作台「更多」下拉迁出，工作区不再自带该菜单项
  assert.doesNotMatch(readerLabWorkspace, /术语表（AI 背景定义）/);
  assert.equal((readerLabPageShell.match(/<ReaderLabWorkspace\b/g) || []).length, 1);
  assert.match(readerLabPageShell, /<ReaderLabWorkspace layout=['"]reader-lab['"] \/>/);
});

test('route layout controls document navigation while the workspace owns one reading surface', () => {
  assert.match(readerLabWorkspace, /function ReaderLabWorkspace\(\{[\s\S]*?layout = ['"]reader-lab['"]/);
  // 桌面版文档库支持折叠：折叠时左侧面板移出布局，顶栏菜单按钮作为折叠/展开切换入口
  assert.match(readerLabWorkspace, /\{!isHomeLayout && !libraryCollapsed && \([\s\S]*?id="reader-library"/);
  assert.match(readerLabWorkspace, /updateLibraryCollapsed\(!libraryCollapsed\)/);
  // 右栏与文档库对称：桌面开关按钮直接收起/展开整列，状态持久化；文档库按钮换侧边栏样式图标
  assert.match(readerLabWorkspace, /anchor-read-right-collapsed/);
  // 窄屏展开的 Sheet 关闭按钮与顶栏图标按钮同规格：h-9 w-9 + 18px 图标 + 同色系
  assert.match(sheetUi, /h-9 w-9 items-center justify-center rounded text-stone-600 dark:text-stone-400/);
  // 知识面板 Sheet 隐藏绝对定位关闭（改走页签行内联槽位），图解/文档库 Sheet 保留
  assert.match(sheetUi, /hideClose = false/);
  assert.match(readerLabWorkspace, /hideClose=\{rightPanelView !== 'diagram'\}/);
  assert.match(readerLabWorkspace, /<SheetClose/);
  // 独立图解工作区右栏是主界面，不受折叠开关影响；注意正则中 JSX 的字面括号需转义
  assert.match(readerLabWorkspace, /\{\(standaloneDiagram \|\| !rightCollapsed\) && \([\s\S]*?id="reader-knowledge"/);
  // 右栏开关图标全断点统一为带箭头族：展开态 PanelRightClose、收起态 PanelRightOpen，窄屏不再用无箭头 PanelRight
  assert.match(readerLabWorkspace, /rightPanelExpanded \? <PanelRightClose size=\{18\} \/> : <PanelRightOpen size=\{18\} \/>/);
  assert.doesNotMatch(readerLabWorkspace, /<PanelRight size=/);
  assert.match(readerLabWorkspace, /<PanelLeftClose size=\{18\} \/> : <PanelLeftOpen size=\{18\} \/>/);
  assert.doesNotMatch(readerLabWorkspace, /<Menu size=\{18\} \/>/);
  assert.match(readerLabWorkspace, /id="reader-content"/);
  assert.equal((readerLabWorkspace.match(/<ReaderSurface\b/g) || []).length, 1);
  assert.doesNotMatch(readerLabWorkspace, /<DerivedDraft\b/);
  assert.match(readerLabWorkspace, /aria-label=\{t\('workspace\.readingArea'\)\}/);
});

test('home keeps app navigation while diagrams live inside the shared document workspace', () => {
  // 应用导航提升为全局顶栏：所有页面共享，首页/图解/文档库三个入口
  assert.match(appTopNav, /slug: ['"]read['"], label: ['"]首页['"]/);
  assert.match(appTopNav, /slug: ['"]diagram['"], label: ['"]图解['"]/);
  assert.match(appTopNav, /slug: ['"]reader-lab['"], label: ['"]文档库['"]/);
  // 配置齿轮收纳三项入口：模型配置、浮动工具栏与术语表（后两者广播事件由工作台响应）
  assert.match(appTopNav, /onToolbarConfig = \(\) => \{\}/);
  assert.match(appTopNav, /onGlossary = \(\) => \{\}/);
  assert.match(appTopNav, /模型配置/);
  assert.match(appTopNav, /浮动工具栏/);
  assert.match(appTopNav, /术语表/);
  assert.match(homePage, /<AppTopNav/);
  assert.match(homePage, /onNavigate=\{handleHomeNavigate\}/);
  assert.match(homePage, /window\.dispatchEvent\(new Event\(GO_IMPORT_EVENT\)\)/);
  // 跨路由切换：首页消费 ?view=diagram 直达图解视图后清参
  assert.match(homePage, /params\.get\('view'\) !== 'diagram'/);
  assert.match(readerLabWorkspace, /<DocumentDiagramPanel\b/);
    assert.match(readerLabWorkspace, /<DocumentDiagramCanvas\b/);
    // 独立形态：画布头部承接原 header 的身份文案（自由图解 + 创建引导），窄屏对话入口随源码按钮进画布头部
    assert.match(readerLabWorkspace, /<DocumentDiagramCanvas diagram=\{diagramState\} standalone=\{standaloneDiagram\} onOpenChat=/);
    assert.doesNotMatch(readerLabWorkspace, /fixed bottom-12 right-4/);
    assert.match(documentDiagramCanvas, /aria-label=\{t\('diagram\.openChat'\)\}/);
    assert.match(documentDiagramCanvas, /lg:hidden/);
  assert.match(readerLabWorkspace, /rightPanelView === ['"]diagram['"][\s\S]*?diagramCanvas/);
  assert.match(documentDiagramPanel, /<Chat\b/);
  assert.doesNotMatch(documentDiagramPanel, /<CodeEditor\b|<MermaidCanvas\b|<ExcalidrawCanvas\b/);
  assert.match(documentDiagramCanvas, /<CodeEditor\b/);
  assert.match(documentDiagramCanvas, /<MermaidCanvas\b/);
  assert.match(documentDiagramCanvas, /<ExcalidrawCanvas\b/);
  // 源码开关位置：mermaid 下提到画布头部放大按钮右侧（headerActions 插槽），excalidraw 才悬浮右下角
  assert.match(mermaidCanvas, /headerActions = null/);
  assert.match(mermaidCanvas, /\{headerActions\}/);
  // 空态副标题替代「等待源码」：自由图解下传达创建入口语义
  assert.match(mermaidCanvas, /subtitle = null/);
  assert.match(mermaidCanvas, /\(subtitle \|\| t\('diagram\.statusWaiting'\)\)/);
  assert.match(documentDiagramCanvas, /title=\{standalone \? t\('diagram\.freeTitle'\) : t\('diagram\.docTitle'\)\}/);
  assert.match(documentDiagramCanvas, /t\('diagram\.freeSubtitle'\)/);
  assert.match(documentDiagramCanvas, /headerActions=\{\(canToggleCode \|\| onOpenChat\) \? \(/);
  assert.match(documentDiagramCanvas, /engine !== ['"]mermaid['"] && canToggleCode && sourceCodeButton\(['"]float['"]\)/);
  assert.doesNotMatch(homePage, /<Chat\b|<CodeEditor\b|<MermaidCanvas\b|<ExcalidrawCanvas\b/);

  for (const component of [
    'HistoryModal',
    'ConfigManager',
  ]) {
    assert.match(homePage, new RegExp(`<${component}\\b`));
  }
});

test('nav diagram entry opens a standalone free-form diagram workspace', () => {
  const diagramLib = readSource('../lib/diagram-generation.js');
  // 独立图解的保留虚拟文档：自由图解挂在这里，与各文档绑定图解隔离
  assert.match(diagramLib, /export const STANDALONE_DIAGRAM_DOCUMENT_ID = ['"]reader-lab-standalone-diagrams['"]/);
  assert.match(diagramLib, /export function createStandaloneDiagramDocument/);
  assert.match(diagramLib, /if \(document\?\.standaloneDiagram\)/);
  // 导航「图解」进独立工作区；文档内触发的图解仍是文档绑定形态
  assert.match(homePage, /setStandaloneDiagram\(true\)/);
  assert.match(homePage, /standaloneDiagram=\{mode === 'diagram' && standaloneDiagram\}/);
  assert.match(homePage, /if \(tool === 'diagram'\) setStandaloneDiagram\(false\)/);
  // 工作区把图解链路绑到保留虚拟文档，恢复与切换都不丢自由图解
  assert.match(readerLabWorkspace, /const diagramDocumentId = standaloneDiagram \? STANDALONE_DIAGRAM_DOCUMENT_ID : currentDocumentId/);
  assert.match(readerLabWorkspace, /\|\| drawing\.documentId === STANDALONE_DIAGRAM_DOCUMENT_ID/);
  // 独立形态下 header 整行移除（顶栏「图解」已表明视图），下方画布与面板提上来；文档绑定形态保留
  assert.match(readerLabWorkspace, /diagramMode && !standaloneDiagram/);
  assert.match(readerLabWorkspace, /\{!standaloneDiagram && \(\s*<header className="z-20 flex min-h-\[62px\]/);
  assert.match(readerLabWorkspace, /\{!standaloneDiagram && \([\s\S]*?<Tooltip content=\{t\('workspace\.moreTooltip'\)\}>/);
  assert.doesNotMatch(readerLabWorkspace, /不绑定文档 · 在这里自由创建与管理图解/);
  // 面板标题由图解选择器直接替代：切换/删除/新建/历史同行，不再单独留标题与子栏
  assert.match(documentDiagramPanel, /图解选择器直接替代面板标题/);
  assert.match(documentDiagramPanel, /aria-label=\{t\('diagram\.selectAria'\)\}/);
  // 选择器外框表明是下拉，双击名称重命名；数据层提供 renameDrawing 走同一存储通道
  assert.match(documentDiagramPanel, /双击重命名/);
  // 单击延迟开菜单、双击取消：保证双击重命名稳定可触发，不被中间单击干扰
  assert.match(documentDiagramPanel, /event\.detail > 1/);
  assert.match(documentDiagramPanel, /onDoubleClick=\{handleSelectDoubleClick\}/);
  assert.match(documentDiagramPanel, /onRenameDrawing\(activeDrawing\.id, title\)/);
  assert.match(readerLabWorkspace, /const renameDrawing = useCallback/);
  assert.match(readerLabWorkspace, /onRenameDrawing=\{renameDrawing\}/);
  assert.doesNotMatch(documentDiagramPanel, /<h2\b/);
});

test('flashcard review lives in the knowledge panel and inline aids are user selectable', () => {
  // 首页成果卡仅在文案上提及闪卡，不内嵌闪卡复习组件
  assert.doesNotMatch(readerHome, /FlashcardReview|onOpenFlashcards/);
  assert.doesNotMatch(homePage, /FlashcardReview|onOpenFlashcards/);
  assert.doesNotMatch(readerLabWorkspace, /FlashcardReview/);

  assert.match(knowledgePanel, /labelKey: 'panel\.tab\.flashcards'/);
  // Sheet 关闭按钮内联进页签行尾部槽位（closeSlot）：构造上不与页签重叠，桌面不注入槽位
  assert.match(knowledgePanel, /flex flex-1" role="tablist"/);
  assert.match(knowledgePanel, /\{closeSlot\}/);
  assert.match(knowledgePanel, /flashcardStore\.getDueCards/);
  assert.match(knowledgePanel, /flashcardStore\.review\(/);
  assert.match(knowledgePanel, /handleSkip/);
  // 复习会话“跳过”按钮文案走 i18n 键
  assert.match(knowledgePanel, /panel\.quizSkip/);
  assert.match(knowledgePanel, /flashcards-changed/);

  assert.match(readerLabWorkspace, /documentId=\{currentDocument\.id\}/);
  assert.match(readerLabWorkspace, /flashcardSignal=\{flashcardPanelSignal\}/);
  assert.match(readerLabWorkspace, /aria-label=\{t\('workspace\.aidInline'\)\}/);
  assert.match(readerLabWorkspace, /aidVisibility=\{aidVisibility\}/);

  // 阅读不再分互斥模式：原文为底，解读/图表/精准替代均为可多选的叠加层
  assert.doesNotMatch(readerLabWorkspace, /选择阅读模式/);
  assert.doesNotMatch(readerLabWorkspace, /const MODES = /);
  // AID 选项含白话入口；i18n 键化后常量只留 id，label 走 workspace.aid.precision 键
  assert.match(readerLabWorkspace, /\{ id: 'precision' \}/);
  assert.match(readerLabWorkspace, /t\(`workspace\.aid\.\$\{option\.id\}`\)/);
  assert.match(readerLabWorkspace, /const DEFAULT_AIDS = Object\.freeze\(\{ explanations: true, diagrams: true, precision: true \}\)/);
  assert.match(readerLabWorkspace, /function sessionAids\(session\)/);
  assert.match(readerLabWorkspace, /saveSession\(currentDocumentId, \{ aids: nextAids \}\)/);

  assert.match(readerSurfaceSource, /aid\.explanations !== false/);
  assert.match(readerSurfaceSource, /aid\.diagrams !== false/);
  // 白话是叠加层而非互斥视图：不再整体清空装饰，改用文本匹配重锚定命中替换片段
  assert.doesNotMatch(readerSurfaceSource, /if \(aid\.precision\) return DecorationSet\.empty;/);
  assert.match(readerSurfaceSource, /function precisionSubstitutions\(records\)/);
  assert.match(readerSurfaceSource, /resolveRecordRange\(record, doc, substitutions = \[\], revealedKeys = null\)/);
  assert.doesNotMatch(readerSurfaceSource, /mode === 'interpretation'|mode === 'original'/);
});

test('the home route keeps the quick import and parse gate before the shared reader', () => {
    assert.match(homePage, /<ReaderLabWorkspace[\s\S]*?layout="home"/);
  assert.match(readerLabWorkspace, /isHomeLayout && !homeStarted/);
  assert.match(readerLabWorkspace, /<ReaderHome/);
  assert.match(readerHome, /<ReaderQuickImport/);
  assert.match(readerLabWorkspace, /onSubmit=\{parseAndOpenDocument\}/);
  assert.match(readerLabWorkspace, /callReaderAnalysisApi\(document\)/);
  assert.match(readerLabWorkspace, /persistImportedDocument\(document, records\)/);
  assert.match(readerHome, /快速导入一篇文档/);
  // 导入区头部与展示区同构「标题 + 描述」：副标题只讲价值不讲操作，不与下方导入控件重复；
  // 首页三处副标题统一单句结构（中间逗号、结尾句号），与 hero/展示区节奏一致
  assert.match(readerHome, /用熟悉的语言读懂陌生的专业知识，让第一次接触的领域也能越读越明白、越读越熟悉。/);
  // 文档库入口收在最近文档区头部，替换原排序说明文案
  assert.match(readerQuickImport, /打开文档库/);
  assert.match(readerHome, /hasExistingDocuments=\{hasExistingDocuments\}/);
  assert.match(readerQuickImport, /解析并进入阅读/);
  assert.match(readerQuickImport, /accept="\.md,\.markdown,\.txt,\.epub,text\/markdown,text\/plain,application\/epub\+zip"/);
  assert.doesNotMatch(readerQuickImport, /useEditor\(/);
});

test('Reader Lab restores imported documents and wires one shared import and analysis flow', () => {
  assert.match(readerLabWorkspace, /createReaderDocumentFromFile/);
  assert.match(readerLabWorkspace, /createReaderDocumentFromPaste/);
  assert.match(readerLabWorkspace, /document\.readerLab/);
  assert.match(readerLabWorkspace, /<DocumentLibrary[\s\S]*?onImportFile=\{importDocumentFile\}/);
  assert.match(readerLabWorkspace, /onCreateDocument=\{createPastedDocument\}/);
  assert.match(readerLabWorkspace, /onAnalyzeDocument=\{analyzeDocument\}/);
  // 一键生成入口从文档库收进顶栏「更多」下拉置顶，文档库不再承载大黑按钮
  assert.match(readerLabWorkspace, /setMoreMenuOpen\(false\); analyzeDocument\(\);/);
  assert.match(readerLabWorkspace, /t\('workspace\.oneClickTitle'\)/);
  assert.doesNotMatch(documentLibrary, /一键生成/);
  assert.match(readerLabWorkspace, /fetch\(['"]\/api\/reader-analysis['"]/);
  assert.match(readerLabWorkspace, /createReaderLabAnalysisRecords/);
  assert.doesNotMatch(homePage, /createReaderDocumentFromFile|\/api\/reader-analysis/);
});

test('batch analysis replaces old batch records without deleting manual explanations', () => {
  // 重点与解读是两类独立批量（batchKind 区分），替换时只清理同类旧记录，手动解读不受影响
  assert.match(
    readerLabWorkspace,
    /record\.documentId === currentDocument\.id\s*&& record\.batchAnalysis\s*&& \(record\.batchKind \|\| 'inline'\) === kind/
  );
  assert.match(
    readerLabWorkspace,
    /current\.filter\(\(record\) => !\(\s*record\.documentId === currentDocument\.id\s*&& record\.batchAnalysis\s*&& \(\(record\.batchKind \|\| 'inline'\) === kind \|\| overlappedOtherRecords\.some\(\(item\) => item\.id === record\.id\)\)\s*\)\)/
  );
  assert.match(readerLabWorkspace, /runReaderAnalysis\('highlights'\)/);
  assert.match(readerLabWorkspace, /runReaderAnalysis\('inline'\)/);
  // 两类批量来自同一次分析、锚点重合：按锚点键跨批量去重，避免同一锚点出现重复卡片；
  // 历史重复数据在恢复时由 dedupeBatchAnalysisRecords 清理
  assert.match(readerLabWorkspace, /batchAnchorKey/);
  assert.match(readerLabWorkspace, /dedupeBatchAnalysisRecords\(readerExplanationsRaw\)/);
});

test('precision replacement is an optional overlay that keeps bracket markers in the shared reader surface', () => {
  const derivedDraft = readSource('../components/reader-lab/DerivedDraft.jsx');
  const readerSurface = readSource('../components/reader-lab/ReaderSurface.jsx');
  const readerLabLib = readSource('../lib/reader-lab.js');

  assert.match(derivedDraft, /createPrecisionReplacementMarkdown/);
  assert.doesNotMatch(derivedDraft, /return \(/);
  assert.match(readerSurface, /createPrecisionReplacementMarkdown/);
  // 精准替代由 aidVisibility.precision 驱动，替代后的文本自带括号标记
  assert.match(readerSurface, /const precisionEnabled = Boolean\(aidVisibility\?\.precision\)/);
  // 括号标记由替换工具直接写入替代文本，不再依赖内联装饰样式
  assert.match(readerLabLib, /『/);
  assert.match(readerLabLib, /』/);
});

test('precision markers become clickable cloze chips that flip between plain wording and the original term', () => {
  const readerSurface = readSource('../components/reader-lab/ReaderSurface.jsx');
  const derivedDraft = readSource('../components/reader-lab/DerivedDraft.jsx');
  const readerLabLib = readSource('../lib/reader-lab.js');
  const globalsCss = readSource('../app/globals.css');

  // 翻转态参与派生文档计算：已翻开映射回写『原术语』，文档文本即状态
  assert.match(readerLabLib, /export function clozeMappingKey\(mapping\)/);
  assert.match(readerLabLib, /revealedKeys\.has\(clozeMappingKey\(mapping\)\)/);
  assert.match(derivedDraft, /createPrecisionReplacementMarkdown\(document, explanations, revealedKeys = null\)/);
  // 派生文档用合并后的揭示集合（揭示态 + 掌握淡出等效揭示）回写原术语
  assert.match(readerSurface, /createPrecisionReplacementMarkdown\(document, explanations, effectiveRevealed\)/);
  // 点击翻转走内联装饰 + 插件 handleClick，不用不存在的 Decoration.replace
  assert.doesNotMatch(readerSurface, /Decoration\.replace\(/);
  assert.match(readerSurface, /'data-cloze-key': key/);
  assert.match(readerSurface, /callbacks\.onToggleCloze\?\.\(clozeEl\.dataset\.clozeKey\)/);
  // 悬浮预览：chip 携带对侧文本 data-cloze-alt，插件滞回类驱动换显不翻转状态，点击才写入翻转态
  assert.match(readerSurface, /'data-cloze-alt': alt/);
  // 悬浮文案精简且体现“点击=记住”语义：文案走 i18n 键，中文文案含“点击显示并记住”
  assert.match(readerSurface, /reader\.clozeTipPlainReveal/);
  assert.match(readerSurface, /reader\.clozeTipOriginalReveal/);
  assert.match(readSource('../lib/i18n/zh-CN.js'), /点击显示并记住/);
  // 换显由插件滞回类 reader-lab-cloze-swap 驱动（不用 :hover）：宿主折叠空白收掉，
  // 外层高亮沿内联盒自然只包预览=“跳过收起部分”，不整条消失
  assert.match(globalsCss, /\.reader-lab-cloze\.reader-lab-cloze-swap \{[\s\S]*?font-size: 0/);
  assert.match(globalsCss, /\.reader-lab-cloze\.reader-lab-cloze-swap::before/);
  assert.doesNotMatch(globalsCss, /data-cloze-alt\]:hover/);
  assert.doesNotMatch(globalsCss, /:has\(\.reader-lab-cloze/);
  // 滞回：进入时记录原始 footprint 矩形，指针离开才还原，不依赖 :hover（防长原文短预览闪烁）
  assert.match(readerSurface, /reader-lab-cloze-swap/);
  assert.match(readerSurface, /swapTarget\.getBoundingClientRect\(\)/);
  // 整块高亮按白话框选范围拆分逐段绘制，术语区域不被高亮覆盖（视觉“跳过去”）
  assert.match(readerSurface, /splitRangeAroundClozes\(range, clozeRanges\)/);
  assert.match(readerSurface, /collectClozeRanges\(doc, presentation, mappings, revealedKeys\)/);
  // 原文优先呈现：呈现方式收在白话下拉，原文不动框选术语，悬浮换显白话；
  // 点击语义与白话优先一致 = “我需要记住”翻转并持久化揭示（共用同一份揭示态），悬浮不写状态
  assert.match(readerLabWorkspace, /CLOZE_PRESENTATION_OPTIONS/);
  assert.match(readerLabWorkspace, /anchor-read-cloze-presentation/);
  assert.match(readerLabWorkspace, /anchor-read-cloze-revealed/);
  assert.doesNotMatch(readerLabWorkspace, /anchor-read-cloze-lookups/);
  assert.match(readerSurface, /reader-lab-cloze-original/);
  assert.match(readerSurface, /const revealed = revealedKeys\?\.has\(key\)/);
  // 持久揭示 chip 常带换显视觉（宿主折叠+『白话』直显），以后无需再点
  assert.match(readerSurface, /reader-lab-cloze-revealed reader-lab-cloze-swap/);
  // 悬浮记难点与独立难点存储已移除：“记住”只来自明确点击
  assert.doesNotMatch(readerSurface, /onHoverClozeLookup/);
  assert.doesNotMatch(readerSurface, /HOVER_LOOKUP_DELAY_MS/);
  assert.doesNotMatch(globalsCss, /reader-lab-cloze-looked/);
  // 点击回灌术语表：首点揭示并记住，词条以 learning 状态入库（收集层只增），同名（含别名）去重
  assert.match(readerLabWorkspace, /reader-lab-term-\$\{currentDocumentId\}-\$\{now\}-cloze/);
  assert.match(readerLabWorkspace, /status: 'learning'/);
  assert.match(readerLabWorkspace, /await workspaceRepository\.terms\.save\(record\)/);
  // 掌握淡出：术语掌握后清除全工作区揭示态，装饰层不再绘制其框选/替换/chip（词回到正文）
  assert.match(readerLabWorkspace, /fadeRevealedForTerms/);
  assert.match(readerLabWorkspace, /masteredClozeTerms = useMemo/);
  assert.match(readerSurface, /masteredTerms\.has\(source\.trim\(\)\.toLowerCase\(\)\)/);
  assert.match(readerSurface, /masteredClozeTerms\.has\(source\.trim\(\)\.toLowerCase\(\)\)/);
  // 首页宣传该闭环为术语沉淀的核心卖点
  const readerHome = readSource('../components/reader-lab/ReaderHome.jsx');
  assert.match(readerHome, /点击不懂的词自动记入术语表，掌握后白话辅助自动撤下/);
  // 白话 Tab 点击定位原文：面板传词条 id，工作台先取回 term 对象；
  // 原文视图有坐标走 focusRange，无坐标词条走 focusTermSignal 文本匹配定位；
  // 白话替代开启时定位不取消模式，阅读面同时匹配『白话』/『原术语』标记形态
  assert.match(readerLabWorkspace, /onFocusTerm=\{focusTerm\}/);
  assert.match(readerLabWorkspace, /setFocusTermSignal\(\{ term: term\.term, nonce: Date\.now\(\) \}\)/);
  assert.match(readerLabWorkspace, /focusTermSignal=\{focusTermSignal\}/);
  assert.match(readerLabWorkspace, /白话视图里术语文本已被替换、坐标已变/);
  assert.match(readerSurface, /focusTermSignal/);
  assert.match(readerSurface, /candidates\.push\(effectiveRevealed\?\.has\(key\)/);
  // 白话列表独立滚动容器：内容滚动时页签行固定置顶
  assert.match(knowledgePanel, /termsListRef/);
  // 词条卡与解读卡同构：懂了（对号）+ 删除（叉号）；删除走 terms.remove 并清揭示态
  assert.match(knowledgePanel, /onDeleteTerm/);
  assert.match(readerLabWorkspace, /const deleteTerm = useCallback/);
  assert.match(readerLabWorkspace, /onDeleteTerm=\{deleteTerm\}/);
  assert.match(readerLabWorkspace, /await workspaceRepository\.terms\.remove\(term\.id\)/);
  assert.match(readSource('../lib/i18n/zh-CN.js'), /panel\.deleteTerm/);
  // 三形态区分类别：重点=高亮笔触、解读=下划线 bar、白话=圆角卡片框；
  // 白话 chip 常态虚线框提示可翻，翻转态实线框+底色；同一内容多形态重叠时才叠加
  assert.match(globalsCss, /\.reader-lab-cloze \{[\s\S]*?border: 1px solid/);
  assert.doesNotMatch(globalsCss, /underline dashed/);
  assert.match(globalsCss, /\.reader-lab-cloze-original \{[\s\S]*?border-style: dashed/);
  assert.match(globalsCss, /\.reader-lab-cloze \{/);
  assert.match(globalsCss, /\.reader-lab-cloze-revealed \{/);
});

test('hierarchical key points: role layers, word marks and layer visibility controls', () => {
  const readerAnalysis = readSource('../lib/reader-analysis.js');
  const globalsCss = readSource('../app/globals.css');
  // 角色分层：文章层/段落层/句子层 + 词语层标记类型
  assert.match(readerAnalysis, /'subthesis'/);
  assert.match(readerAnalysis, /READER_ANALYSIS_MARK_KINDS = Object\.freeze\(\['center', 'quote', 'idiom'\]\)/);
  assert.match(readerAnalysis, /core: 'article'/);
  assert.match(readerAnalysis, /subthesis: 'paragraph'/);
  assert.match(readerAnalysis, /servesIndex/);
  // 视觉分层：形态区分类别（重点=高亮笔触、解读=下划线）+ importance 调笔触浓淡 + 词语红高亮笔触
  assert.match(globalsCss, /reader-lab-highlight-fill/);
  // 换行安全手段内向 hero 马克笔质感靠拢：垂直内边距撑开绘制区 + 呼吸间隙 + 圆角笔触；
  // 不引入绝对定位装饰层（hero 结构不随换行分裂，正文不可用）
  assert.match(globalsCss, /\.reader-lab-highlight \{[\s\S]*?padding: 0\.12em 1px 0\.16em/);
  assert.match(globalsCss, /\.reader-lab-highlight-fill \{[\s\S]*?border-radius: 3px/);
  // 解读形态 = 3px 圆角胶囊下划线 bar（80% 不透明度对齐首页 hero 柔和质感）；重点笔触上下出头贴近 hero 覆盖感
  assert.match(globalsCss, /\.reader-lab-highlight-explanation \{[\s\S]*?border-bottom: 3px solid rgba\(13, 148, 136, 0\.8\)/);
  assert.match(globalsCss, /\.reader-lab-highlight-fill \{[\s\S]*?background-position: 0 0\.08em/);
  // 重点笔触在基类之上加垂直内边距，覆盖到字形盒上下边（对齐首页 hero 高亮盖住文字上下的饱满感）；
  // 实/淡两档笔触覆盖范围一致
  assert.match(globalsCss, /\.reader-lab-highlight-fill \{[\s\S]*?padding: 0\.2em 1px 0\.26em/);
  assert.match(globalsCss, /\.reader-lab-highlight-fill-soft \{[\s\S]*?padding: 0\.2em 1px 0\.26em/);
  // 低重要性重点淡笔触：color-mix 55% 色量；角色色 200 级对齐 hero 等效色深
  assert.match(globalsCss, /reader-lab-highlight-fill-soft/);
  assert.match(globalsCss, /color-mix\(in srgb, var\(--reader-lab-hl, #99f6e4\) 55%, transparent\)/);
  assert.match(globalsCss, /--reader-lab-hl: #99f6e4/);
  // 渲染层形态分支：解读锚点下划线跟随解读开关（与行间卡一致），重点笔触跟随层级开关；同内容双命中嵌套叠加
  assert.match(readerSurfaceSource, /showExplanations && !isWord && record\.explanation/);
  assert.match(readerSurfaceSource, /record\.role && record\.role !== 'explanation'/);
  assert.match(readerSurfaceSource, /reader-lab-highlight-fill-soft/);
  assert.match(globalsCss, /reader-lab-highlight-core/);
  assert.match(globalsCss, /reader-lab-word-mark/);
  // 词语层用红色高亮笔触（高亮家族专属重点、线条家族专属解读，消解与解读实线的形态重叠）：
  // 中心浅红、金句深红、成语红虚线；不得回退红框/红实线
  assert.match(globalsCss, /\.reader-lab-word-mark \{[\s\S]*?background-image: linear-gradient\(#fecaca/);
  assert.match(globalsCss, /\.reader-lab-word-mark-idiom \{[\s\S]*?border-bottom: 3px dashed #dc2626/);
  // 重点模式下词语笔触垂直覆盖与层级高亮 -fill 完全一致（同等高度、不再偏矮）；
  // 白话圆角框加垂直内边距，与高亮同高、不再贴字显矮小
  assert.match(globalsCss, /\.reader-lab-word-mark \{[\s\S]*?padding: 0\.2em 1px 0\.26em/);
  assert.match(globalsCss, /\.reader-lab-cloze \{[\s\S]*?padding: 0\.2em 3px 0\.26em/);
  assert.doesNotMatch(globalsCss, /border-bottom: 3px solid #dc2626/);
  assert.doesNotMatch(globalsCss, /border: 1\.5px solid #dc2626/);
  assert.match(readerSurfaceSource, /readerRoleLayer\(record\.role\)/);
  assert.match(readerSurfaceSource, /layers\[layer\] === false/);
  // 层级可见性开关：顶栏弹层 + 本地持久化
  assert.match(readerLabWorkspace, /anchor-read-layer-visibility/);
  assert.match(readerLabWorkspace, /LAYER_OPTIONS/);
  assert.match(readerLabWorkspace, /layerVisibility=\{layerVisibility\}/);
  // 重点页签按层分组并渲染 serves 嵌套
  assert.match(knowledgePanel, /\{ id: 'structure', labelKey: 'panel\.tab\.structure' \}/);
  assert.match(knowledgePanel, /servesTo/);
});

test('local demo fallback is removed: AI features require model config; legacy repair and seeds retained', () => {
  const readerAnalysis = readSource('../lib/reader-analysis.js');
  const readerLabLib = readSource('../lib/reader-lab.js');
  const diagramLib = readSource('../lib/diagram-generation.js');
  const useDiagramHook = readSource('../components/reader-lab/use-document-diagram.js');

  // 本地 Demo 兜底全链路移除：未配置模型时统一报错阻断，不再产出假数据；
  // 报错走 i18n 键（workspace.configMissing），由通知条按当前语言渲染
  assert.match(readerLabWorkspace, /throw i18nError\('workspace\.configMissing'\)/);
  assert.match(readerLabWorkspace, /function errorNotice\(error\)/);
  assert.doesNotMatch(readerLabWorkspace, /createDemoReaderAnalysis|createDemoFlashcards|createDemoDocumentDiagram|createDemoCustomActionResult|createDemoExplanation|createDemoAskResponse/);
  assert.doesNotMatch(readerAnalysis, /createDemoReaderAnalysis|DEPTH_DEMO_BLOCKS/);
  assert.doesNotMatch(readerLabLib, /createDemoFlashcards|createDemoExplanation|createDemoAskResponse/);
  assert.doesNotMatch(diagramLib, /createDemoDocumentDiagram/);
  assert.doesNotMatch(customActionsLib, /createDemoCustomActionResult/);
  // 图解 AI 生成未配置时报错；独立画布仍可自由手绘
  assert.match(useDiagramHook, /未配置 LLM：AI 图解不可用，可直接在画布上自由绘制。/);
  assert.doesNotMatch(useDiagramHook, /createDemoDocumentDiagram/);

  // 历史 Demo 词典与占位文案仅保留给恢复期修复链路，不参与任何新生成
  assert.match(readerAnalysis, /READER_DEMO_GLOSSARY = Object\.freeze/);
  assert.match(readerLabLib, /DEMO_PLACEHOLDER_MAPPING_TARGET = '本地示例替换'/);
  assert.match(readerLabLib, /DEMO_PLACEHOLDER_DISPLAY = '本地 Demo 阅读辅助'/);
  assert.doesNotMatch(readerAnalysis, /通俗解读：/);
  assert.doesNotMatch(readerLabLib, /通俗解读：/);
  assert.doesNotMatch(readSource('../components/reader-lab/InlineExplanation.jsx'), /行间解读/);

  // 选区动作入口语义为“浮动工具栏”，不再是“自定义动作”弹窗
  assert.match(readSource('../components/reader-lab/CustomActionsManager.jsx'), /title="浮动工具栏"/);
  // 内置动作（解释/白话/图解）统一进浮动工具栏配置：与自定义动作合并为同一列表，
  // 共用一套开关/排序/编辑表单；模板保持默认时走结构化锚定链路，改过模板后按模板执行
  const toolbarBuiltinsLib = readSource('../lib/toolbar-builtins.js');
  assert.match(toolbarBuiltinsLib, /export function createDefaultToolbarBuiltins/);
  assert.match(toolbarBuiltinsLib, /export function mergeToolbarBuiltins/);
  assert.match(toolbarBuiltinsLib, /export function toToolbarBuiltinOverrides/);
  assert.match(toolbarBuiltinsLib, /export function isDefaultToolbarBuiltinTemplate/);
  assert.match(customActionsLib, /order: Number\.isFinite\(input\.order\)/);
  const customActionsManagerSource = readSource('../components/reader-lab/CustomActionsManager.jsx');
  assert.match(customActionsManagerSource, /内置/);
  assert.match(customActionsManagerSource, /onToggle/);
  assert.match(customActionsManagerSource, /onMove/);
  assert.match(customActionsManagerSource, /onSaveBuiltin/);
  assert.match(readerSurfaceSource, /toolbarActions/);
  // 图解模板被修改后改按模板执行，只有默认模板才走选区锚定链路
  assert.match(readerSurfaceSource, /isDefaultToolbarBuiltinTemplate/);
  assert.match(readerLabWorkspace, /unifiedToolbarActions/);
  assert.match(readerLabWorkspace, /isDefaultToolbarBuiltinTemplate\(builtin\)/);
  assert.match(readerLabWorkspace, /saveBuiltinAction/);
  assert.match(readerLabWorkspace, /anchor-read-toolbar-builtins/);

  // 存量占位数据：恢复时用词典重写旧 Demo 的占位文案，避免“本地示例替换”继续上屏
  assert.match(readerLabLib, /export function repairDemoPlaceholderRecords/);
  assert.match(readerLabLib, /export function repairDemoPlaceholderTerms/);
  assert.match(readerLabWorkspace, /repairDemoPlaceholderRecords\(migratedExplanations\)/);
  assert.match(readerLabWorkspace, /repairDemoPlaceholderTerms\(/);
  // 存量解读记录的“通俗解读：”题头在恢复期剥离，且在 migrate 之前执行
  assert.match(readerLabWorkspace, /stripLegacyExplanationPrefix[\s\S]*?migrateBatchAnalysisMappings\(dePrefixedExplanations\)/);

  // 空列表种子示例条目保留：浮动工具栏与术语表为空时各给一份内置起点
  assert.match(customActionsLib, /export function createDemoCustomActions/);
  assert.match(readerLabLib, /export function createDemoGlossary/);
  assert.match(readerLabWorkspace, /createDemoCustomActions\(/);
  assert.match(readerLabWorkspace, /createDemoGlossary\(/);
});

test('the outline drawer is a reading-scene navigation overlay owned by the reader surface', () => {
  const readerLabLib = readSource('../lib/reader-lab.js');
  // 目录由纯函数从 Markdown 源文提取：跳过围栏代码块，保留层级与纯文本
  assert.match(readerLabLib, /export function extractMarkdownOutline/);
  // 开关收进文档库：与搜索并列，顶栏不再留按钮；持久化开合状态，图解画布下隐藏
  assert.match(readerLabWorkspace, /anchor-read-outline-open/);
  assert.match(readerLabWorkspace, /onToggleOutline=\{toggleOutline\}/);
  assert.match(readerLabWorkspace, /outlineHidden=\{diagramMode\}/);
  assert.match(documentLibrary, /aria-label=\{outlineOpen \? '收起目录' : '打开目录'\}/);
  // 抽屉覆盖在阅读区左侧不挤占布局，点击按 heading 顺序定位；aria-label 走 i18n 键
  assert.match(readerSurfaceSource, /aria-label=\{t\('reader\.outlineNav'\)\}/);
  assert.match(readerSurfaceSource, /scrollToOutlineIndex/);
});

test('diagram view splits article and canvas side by side on wide screens', () => {
  // 宽屏判定：≥1280px 才分栏，窄屏退回整块画布
  assert.match(readerLabWorkspace, /matchMedia\('\(min-width: 1280px\)'\)/);
  assert.match(readerLabWorkspace, /const diagramSplit = diagramMode && !standaloneDiagram && isDesktop && isWide/);
  // 中栏嵌套分栏：左原文右画布，均可拖拽调宽且有最小宽度兜底
  assert.match(readerLabWorkspace, /id="reader-diagram-split"/);
  assert.match(readerLabWorkspace, /id="reader-split-article"/);
  assert.match(readerLabWorkspace, /id="reader-split-canvas"/);
  // 分栏下阅读区仍在，阅读专属控件照常显示；只有整块画布形态才收起
  assert.match(readerLabWorkspace, /\(!diagramMode \|\| diagramSplit\)/);
});

test('selection diagrams stay inline: placeholder first, insert on finish', () => {
  const inlineDiagramCard = readSource('../components/reader-lab/InlineDiagramCard.jsx');
  const useDiagramHook = readSource('../components/reader-lab/use-document-diagram.js');
  // 不跳转：createDrawing 借 inlineDiagramRef 跳过切换到图解画布
  assert.match(readerLabWorkspace, /const stayInline = inlineDiagramRef\.current/);
  assert.match(readerLabWorkspace, /if \(!stayInline\) setRightPanelView\('diagram'\)/);
  // 锚点同帧随参数传入 generate，不等 anchor prop 下一帧生效
  assert.match(useDiagramHook, /anchorOverride = null/);
  assert.match(useDiagramHook, /const effectiveAnchor = anchorOverride \|\| anchor/);
  // 生成中在选区下方挂占位卡，完成后被正式图解卡就地替换
  assert.match(readerLabWorkspace, /setPendingInlineDiagram\(anchor\)/);
  assert.match(readerLabWorkspace, /pendingDiagram=\{pendingInlineDiagram\}/);
  assert.match(inlineDiagramCard, /export function InlineDiagramPlaceholder/);
  assert.match(readerSurfaceSource, /InlineDiagramPlaceholder/);
  assert.match(readerSurfaceSource, /pendingDiagram = null/);
});

test('mermaid is the default diagram engine across hook, panel, history and chat', () => {
  const useDiagramHook = readSource('../components/reader-lab/use-document-diagram.js');
  // 存量图解按自身 engine 恢复，无记录时兜底 mermaid；新建图解默认 mermaid
  assert.match(useDiagramHook, /activeDrawing\?\.engine \|\| 'mermaid'/);
  assert.match(documentDiagramPanel, /engine: 'mermaid'/);
  assert.match(readerLabWorkspace, /history\.engine \|\| 'mermaid'/);
  assert.match(readerLabWorkspace, /historyDrawing\.engine \|\| 'mermaid'/);
  // 密集操作控件（输入模式/引擎/图类型）提到面板头部控制子栏，引擎选项 mermaid 排前
  assert.match(documentDiagramPanel, /控制子栏：输入模式、引擎与图类型集中收纳在头部/);
  assert.match(documentDiagramPanel, /\['mermaid', 'Mermaid'\],\s*\n\s*\['excalidraw', 'Excalidraw'\],/);
  assert.match(documentDiagramPanel, /\['text', t\('diagram\.input\.text'\)\],\s*\n\s*\['file', t\('diagram\.input\.file'\)\],\s*\n\s*\['image', t\('diagram\.input\.image'\)\],/);
  // Chat 走受控模式：tabs 与图类型由面板持有，内部不再重复渲染
  assert.match(documentDiagramPanel, /activeTab=\{inputTab\} onTabChange=\{setInputTab\} chartType=\{chartType\} onChartTypeChange=\{setChartType\}/);
  assert.match(useDiagramHook, /^\s*setChartType,$/m);
});
