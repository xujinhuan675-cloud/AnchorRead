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
  assert.match(readerLabWorkspace, /\{!isHomeLayout && \([\s\S]*?id="reader-library"/);
  assert.match(readerLabWorkspace, /isHomeLayout \? ['"]flex['"] : ['"]flex lg:hidden['"]/);
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

  assert.match(knowledgePanel, /label: ['"]闪卡复习['"]/);
  assert.match(knowledgePanel, /flashcardStore\.getDueCards/);
  assert.match(knowledgePanel, /flashcardStore\.review\(/);
  assert.match(knowledgePanel, /handleSkip/);
  assert.match(knowledgePanel, /跳过/);
  assert.match(knowledgePanel, /flashcards-changed/);

  assert.match(readerLabWorkspace, /documentId=\{currentDocument\.id\}/);
  assert.match(readerLabWorkspace, /flashcardSignal=\{flashcardPanelSignal\}/);
  assert.match(readerLabWorkspace, /aria-label="内联辅助显示"/);
  assert.match(readerLabWorkspace, /aidVisibility=\{aidVisibility\}/);

  assert.match(readerSurfaceSource, /aid\.explanations !== false/);
  assert.match(readerSurfaceSource, /aid\.diagrams !== false/);
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
  assert.match(readerQuickImport, /accept="\.md,\.markdown,\.txt,text\/markdown,text\/plain"/);
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
  assert.match(
    readerLabWorkspace,
    /record\.documentId === currentDocument\.id && record\.batchAnalysis/
  );
  assert.match(
    readerLabWorkspace,
    /current\.filter\(\(record\) => !\(record\.documentId === currentDocument\.id && record\.batchAnalysis\)\)/
  );
});

test('precision replacement view keeps bracket markers in the shared reader surface', () => {
  const derivedDraft = readSource('../components/reader-lab/DerivedDraft.jsx');
  const readerSurface = readSource('../components/reader-lab/ReaderSurface.jsx');
  const styles = readSource('../app/globals.css');

  assert.match(derivedDraft, /createPrecisionReplacementMarkdown/);
  assert.doesNotMatch(derivedDraft, /return \(/);
  assert.match(readerSurface, /createPrecisionReplacementMarkdown/);
  assert.match(readerSurface, /reader-lab-inline-source-mapping/);
  assert.match(styles, /content: ['"]⌜['"]/);
  assert.match(styles, /content: ['"]⌝['"]/);
});
