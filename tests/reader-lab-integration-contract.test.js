import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function readSource(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

const homePage = readSource('../app/page.js');
const readerLabPage = readSource('../app/reader-lab/page.js');
const readerLabWorkspace = readSource('../components/ReaderLabWorkspace.jsx');
const workspaceNav = readSource('../components/WorkspaceNav.jsx');

test('the home reading mode and regression route share ReaderLabWorkspace', () => {
  assert.match(homePage, /import ReaderLabWorkspace from ['"]@\/components\/ReaderLabWorkspace['"]/);
  assert.match(homePage, /mode === ['"]article['"][\s\S]*?<ReaderLabWorkspace embedded \/>/);
  assert.doesNotMatch(homePage, /<ArticlePanel\b/);

  assert.match(readerLabPage, /import ReaderLabWorkspace from ['"]@\/components\/ReaderLabWorkspace['"]/);
  assert.match(readerLabPage, /return <ReaderLabWorkspace \/>/);
});

test('embedded Reader Lab owns one reading surface without a second desktop library', () => {
  assert.match(readerLabWorkspace, /function ReaderLabWorkspace\(\{ embedded = false \}\)/);
  assert.match(readerLabWorkspace, /\{!embedded && \([\s\S]*?id="reader-library"/);
  assert.match(readerLabWorkspace, /embedded \? ['"]flex['"] : ['"]flex lg:hidden['"]/);
  assert.match(readerLabWorkspace, /id="reader-content"/);
  assert.match(readerLabWorkspace, /aria-label="阅读区"/);
});

test('home keeps the existing navigation and non-reading feature entry points', () => {
  assert.match(workspaceNav, /label: ['"]阅读['"],[\s\S]*?onModeChange\(['"]article['"]\)/);
  assert.match(homePage, /\{mode === ['"]draw['"] && \(/);

  for (const component of [
    'MermaidCanvas',
    'ExcalidrawCanvas',
    'FlashcardReview',
    'HistoryModal',
    'ConfigManager',
  ]) {
    assert.match(homePage, new RegExp(`<${component}\\b`));
  }
});
