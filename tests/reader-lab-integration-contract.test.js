import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function readSource(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

const homePage = readSource('../app/page.js');
const readerLabPage = readSource('../app/reader-lab/page.js');
const readerLabWorkspace = readSource('../components/ReaderLabWorkspace.jsx');
const documentDiagramPanel = readSource('../components/reader-lab/DocumentDiagramPanel.jsx');
const documentDiagramCanvas = readSource('../components/reader-lab/DocumentDiagramCanvas.jsx');
const readerQuickImport = readSource('../components/reader-lab/ReaderQuickImport.jsx');
const knowledgePanel = readSource('../components/reader-lab/KnowledgePanel.jsx');
const readerSurfaceSource = readSource('../components/reader-lab/ReaderSurface.jsx');
const workspaceNav = readSource('../components/WorkspaceNav.jsx');
const customActionsLib = readSource('../lib/custom-actions.js');

test('the home reading mode and regression route share ReaderLabWorkspace', () => {
  assert.match(homePage, /import ReaderLabWorkspace from ['"]@\/components\/ReaderLabWorkspace['"]/);
  assert.equal((homePage.match(/<ReaderLabWorkspace\b/g) || []).length, 1);
  assert.match(homePage, /<ReaderLabWorkspace[\s\S]*?layout="home"[\s\S]*?requestedTool=\{mode === 'diagram' \? 'diagram' : 'read'\}/);
  assert.doesNotMatch(homePage, /<ArticlePanel\b/);

  assert.match(readerLabPage, /import ReaderLabWorkspace from ['"]@\/components\/ReaderLabWorkspace['"]/);
  assert.match(readerLabPage, /<ReaderLabWorkspace layout=['"]reader-lab['"] \/>/);
});

test('route layout controls document navigation while the workspace owns one reading surface', () => {
  assert.match(readerLabWorkspace, /function ReaderLabWorkspace\(\{[\s\S]*?layout = ['"]reader-lab['"]/);
  // 桌面版文档库支持折叠：折叠时左侧面板移出布局，顶栏菜单按钮作为折叠/展开切换入口
  assert.match(readerLabWorkspace, /\{!isHomeLayout && !libraryCollapsed && \([\s\S]*?id="reader-library"/);
  assert.match(readerLabWorkspace, /updateLibraryCollapsed\(!libraryCollapsed\)/);
  assert.match(readerLabWorkspace, /id="reader-content"/);
  assert.equal((readerLabWorkspace.match(/<ReaderSurface\b/g) || []).length, 1);
  assert.doesNotMatch(readerLabWorkspace, /<DerivedDraft\b/);
  assert.match(readerLabWorkspace, /aria-label="阅读区"/);
});

test('home keeps app navigation while diagrams live inside the shared document workspace', () => {
  assert.match(workspaceNav, /label: ['"]阅读['"],[\s\S]*?onModeChange\(['"]article['"]\)/);
  assert.match(workspaceNav, /label: ['"]图解['"],[\s\S]*?mode === ['"]diagram['"][\s\S]*?onModeChange\(['"]diagram['"]\)/);
  assert.match(readerLabWorkspace, /<DocumentDiagramPanel\b/);
  assert.match(readerLabWorkspace, /<DocumentDiagramCanvas\b/);
  assert.match(readerLabWorkspace, /rightPanelView === ['"]diagram['"][\s\S]*?diagramCanvas/);
  assert.match(documentDiagramPanel, /<Chat\b/);
  assert.doesNotMatch(documentDiagramPanel, /<CodeEditor\b|<MermaidCanvas\b|<ExcalidrawCanvas\b/);
  assert.match(documentDiagramCanvas, /<CodeEditor\b/);
  assert.match(documentDiagramCanvas, /<MermaidCanvas\b/);
  assert.match(documentDiagramCanvas, /<ExcalidrawCanvas\b/);
  assert.doesNotMatch(homePage, /<Chat\b|<CodeEditor\b|<MermaidCanvas\b|<ExcalidrawCanvas\b/);

  for (const component of [
    'HistoryModal',
    'ConfigManager',
  ]) {
    assert.match(homePage, new RegExp(`<${component}\\b`));
  }
});

test('flashcard review lives in the knowledge panel and inline aids are user selectable', () => {
  assert.doesNotMatch(workspaceNav, /闪卡/);
  assert.doesNotMatch(homePage, /FlashcardReview|onOpenFlashcards/);
  assert.doesNotMatch(readerLabWorkspace, /FlashcardReview/);

  assert.match(knowledgePanel, /label: ['"]闪卡['"]/);
  assert.match(knowledgePanel, /flashcardStore\.getDueCards/);
  assert.match(knowledgePanel, /flashcardStore\.review\(/);
  assert.match(knowledgePanel, /handleSkip/);
  assert.match(knowledgePanel, /跳过/);
  assert.match(knowledgePanel, /flashcards-changed/);

  assert.match(readerLabWorkspace, /documentId=\{currentDocument\.id\}/);
  assert.match(readerLabWorkspace, /flashcardSignal=\{flashcardPanelSignal\}/);
  assert.match(readerLabWorkspace, /aria-label="内联辅助显示"/);
  assert.match(readerLabWorkspace, /aidVisibility=\{aidVisibility\}/);

  // 阅读不再分互斥模式：原文为底，解读/图表/精准替代均为可多选的叠加层
  assert.doesNotMatch(readerLabWorkspace, /选择阅读模式/);
  assert.doesNotMatch(readerLabWorkspace, /const MODES = /);
  assert.match(readerLabWorkspace, /\{ id: 'precision', label: '白话' \}/);
  assert.match(readerLabWorkspace, /const DEFAULT_AIDS = Object\.freeze\(\{ explanations: true, diagrams: true, precision: false \}\)/);
  assert.match(readerLabWorkspace, /function sessionAids\(session\)/);
  assert.match(readerLabWorkspace, /saveSession\(currentDocumentId, \{ aids: nextAids \}\)/);

  assert.match(readerSurfaceSource, /aid\.explanations !== false/);
  assert.match(readerSurfaceSource, /aid\.diagrams !== false/);
  // 白话是叠加层而非互斥视图：不再整体清空装饰，改用文本匹配重锚定命中替换片段
  assert.doesNotMatch(readerSurfaceSource, /if \(aid\.precision\) return DecorationSet\.empty;/);
  assert.match(readerSurfaceSource, /function precisionSubstitutions\(records\)/);
  assert.match(readerSurfaceSource, /resolveRecordRange\(record, doc, substitutions = \[\]\)/);
  assert.doesNotMatch(readerSurfaceSource, /mode === 'interpretation'|mode === 'original'/);
});

test('the home route keeps the quick import and parse gate before the shared reader', () => {
  assert.match(homePage, /<ReaderLabWorkspace[\s\S]*?key=\{readerWorkspaceVersion\}[\s\S]*?layout="home"/);
  assert.match(readerLabWorkspace, /isHomeLayout && !homeStarted/);
  assert.match(readerLabWorkspace, /<ReaderQuickImport/);
  assert.match(readerLabWorkspace, /onSubmit=\{parseAndOpenDocument\}/);
  assert.match(readerLabWorkspace, /callReaderAnalysisApi\(document\)/);
  assert.match(readerLabWorkspace, /persistImportedDocument\(document, records\)/);
  assert.match(readerQuickImport, /快速导入一篇文档/);
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

test('hierarchical key points: role layers, word marks and layer visibility controls', () => {
  const readerAnalysis = readSource('../lib/reader-analysis.js');
  const globalsCss = readSource('../app/globals.css');
  // 角色分层：文章层/段落层/句子层 + 词语层标记类型
  assert.match(readerAnalysis, /'subthesis'/);
  assert.match(readerAnalysis, /READER_ANALYSIS_MARK_KINDS = Object\.freeze\(\['center', 'quote', 'idiom'\]\)/);
  assert.match(readerAnalysis, /core: 'article'/);
  assert.match(readerAnalysis, /subthesis: 'paragraph'/);
  assert.match(readerAnalysis, /servesIndex/);
  // 视觉分层：角色配色 + importance>=4 背景填充 + 词语红框
  assert.match(globalsCss, /reader-lab-highlight-fill/);
  assert.match(globalsCss, /reader-lab-highlight-core/);
  assert.match(globalsCss, /reader-lab-word-mark/);
  assert.match(readerSurfaceSource, /readerRoleLayer\(record\.role\)/);
  assert.match(readerSurfaceSource, /layers\[layer\] === false/);
  // 层级可见性开关：顶栏弹层 + 本地持久化
  assert.match(readerLabWorkspace, /anchor-read-layer-visibility/);
  assert.match(readerLabWorkspace, /LAYER_OPTIONS/);
  assert.match(readerLabWorkspace, /layerVisibility=\{layerVisibility\}/);
  // 重点页签按层分组并渲染 serves 嵌套
  assert.match(knowledgePanel, /\{ id: 'structure', label: '重点' \}/);
  assert.match(knowledgePanel, /servesTo/);
});

test('no-LLM demo chain produces real values for replacement, flashcards and diagrams', () => {
  const readerAnalysis = readSource('../lib/reader-analysis.js');
  const readerLabLib = readSource('../lib/reader-lab.js');
  const diagramLib = readSource('../lib/diagram-generation.js');
  const useDiagramHook = readSource('../components/reader-lab/use-document-diagram.js');
  // 精准替代：内置术语词典给出真实大白话替换，源码不再包含占位示例文案
  assert.match(readerAnalysis, /READER_DEMO_GLOSSARY = Object\.freeze/);
  assert.doesNotMatch(readerAnalysis, /本地示例替换/);
  assert.doesNotMatch(readerAnalysis, /本地 Demo 阅读辅助/);
  // 解读文案直接是内容本身，不再带“通俗解读：”题头；行间解读卡不再带固定标签
  assert.doesNotMatch(readerAnalysis, /通俗解读：/);
  assert.doesNotMatch(readerLabLib, /通俗解读：/);
  assert.doesNotMatch(readSource('../components/reader-lab/InlineExplanation.jsx'), /行间解读/);
  // 词标只取完整连续汉字段，不再用滑窗切出“业知识库”这类断义碎片
  assert.match(readerAnalysis, /for \(const run of clause\.matchAll/);
  assert.doesNotMatch(readerAnalysis, /\{2,8\}\)\)/);
  // 闪卡：从分析记录提取真实角色与术语内容，无配置时不再阻断
  assert.match(readerLabLib, /export function createDemoFlashcards/);
  assert.match(readerLabWorkspace, /createDemoFlashcards\(currentExplanations, currentDocument\.title\)/);
  // 图表：按文档真实结构本地生成 Mermaid 脑图，无配置时不再阻断
  assert.match(diagramLib, /export function createDemoDocumentDiagram/);
  assert.match(useDiagramHook, /createDemoDocumentDiagram\(document\)/);
  assert.match(useDiagramHook, /engine: 'mermaid'/);
  // 图解开关打开却无图时，工作区自动种子一张本地脑图，保证图解层始终可见
  assert.match(readerLabWorkspace, /createDemoDocumentDiagram\(currentDocument\)/);
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
  // 选区自定义动作与术语表也有内置 Demo，无 LLM 配置时不阻断
  assert.match(customActionsLib, /export function createDemoCustomActions/);
  assert.match(customActionsLib, /export function createDemoCustomActionResult/);
  assert.match(readerLabLib, /export function createDemoGlossary/);
  assert.match(readerLabWorkspace, /createDemoCustomActions\(/);
  assert.match(readerLabWorkspace, /createDemoGlossary\(/);
  assert.match(readerLabWorkspace, /createDemoCustomActionResult\(action, selection\.text\)/);
  assert.doesNotMatch(readerLabWorkspace, /未检测到可用模型配置，请先在设置中配置模型。/);
});

test('the outline drawer is a reading-scene navigation overlay owned by the reader surface', () => {
  const readerLabLib = readSource('../lib/reader-lab.js');
  const documentLibrary = readSource('../components/reader-lab/DocumentLibrary.jsx');
  // 目录由纯函数从 Markdown 源文提取：跳过围栏代码块，保留层级与纯文本
  assert.match(readerLabLib, /export function extractMarkdownOutline/);
  // 开关收进文档库：与搜索并列，顶栏不再留按钮；持久化开合状态，图解画布下隐藏
  assert.match(readerLabWorkspace, /anchor-read-outline-open/);
  assert.match(readerLabWorkspace, /onToggleOutline=\{toggleOutline\}/);
  assert.match(readerLabWorkspace, /outlineHidden=\{diagramMode\}/);
  assert.match(documentLibrary, /aria-label=\{outlineOpen \? '收起目录' : '打开目录'\}/);
  // 抽屉覆盖在阅读区左侧不挤占布局，点击按 heading 顺序定位
  assert.match(readerSurfaceSource, /aria-label="文档目录"/);
  assert.match(readerSurfaceSource, /scrollToOutlineIndex/);
});
