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
  assert.match(workspaceNav, /label: ['"]图表['"],[\s\S]*?mode === ['"]diagram['"][\s\S]*?onModeChange\(['"]diagram['"]\)/);
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
  assert.match(readerLabWorkspace, /\{ id: 'precision', label: '精准替代' \}/);
  assert.match(readerLabWorkspace, /const DEFAULT_AIDS = Object\.freeze\(\{ explanations: true, diagrams: true, precision: false \}\)/);
  assert.match(readerLabWorkspace, /function sessionAids\(session\)/);
  assert.match(readerLabWorkspace, /saveSession\(currentDocumentId, \{ aids: nextAids \}\)/);

  assert.match(readerSurfaceSource, /aid\.explanations !== false/);
  assert.match(readerSurfaceSource, /aid\.diagrams !== false/);
  assert.match(readerSurfaceSource, /if \(aid\.precision\) return DecorationSet\.empty;/);
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
    /current\.filter\(\(record\) => !\(\s*record\.documentId === currentDocument\.id\s*&& record\.batchAnalysis\s*&& \(record\.batchKind \|\| 'inline'\) === kind\s*\)\)/
  );
  assert.match(readerLabWorkspace, /runReaderAnalysis\('highlights'\)/);
  assert.match(readerLabWorkspace, /runReaderAnalysis\('inline'\)/);
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
  assert.match(readerLabLib, /⌜/);
  assert.match(readerLabLib, /⌝/);
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
