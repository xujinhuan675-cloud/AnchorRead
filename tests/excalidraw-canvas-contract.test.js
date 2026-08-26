import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const componentSource = fs.readFileSync(
  path.join(testDirectory, '..', 'components', 'ExcalidrawCanvas.jsx'),
  'utf8',
);
const diagramHookSource = fs.readFileSync(
  path.join(testDirectory, '..', 'components', 'reader-lab', 'use-document-diagram.js'),
  'utf8',
);

test('ExcalidrawCanvas accepts a complete persisted scene without breaking the legacy element callback', () => {
  assert.match(componentSource, /appState,\s*\n\s*files,\s*\n\s*onSceneChange,/u);
  assert.match(componentSource, /viewBackgroundColor:\s*isDark\s*\?\s*'#1c1c1c'\s*:\s*'#ffffff'/u);
  assert.match(componentSource, /appState:\s*initialAppState/u);
  assert.match(componentSource, /const hasPersistedAppState = Boolean\(appState &&/u);
  assert.match(componentSource, /scrollToContent:\s*!hasPersistedAppState/u);
  assert.match(componentSource, /convertedElements\.length > 0 && !hasPersistedAppState/u);
  assert.match(componentSource, /\.\.\.\(files === undefined \? \{\} : \{ files \}\)/u);
  assert.match(componentSource, /onChange=\{\(nextElements,\s*nextAppState,\s*nextFiles\)\s*=>/u);
  assert.match(componentSource, /onElementsChange\?\.\(nextElements\)/u);
  assert.match(componentSource, /onSceneChange\?\.\(\{\s*elements:\s*nextElements,\s*appState:\s*nextAppState,\s*files:\s*nextFiles,/u);
  assert.match(componentSource, /nextValue !== undefined\s*&&\s*nextValue !== null/u);
  assert.doesNotMatch(componentSource, /Number\(current\?\.scrollX\)\s*!==\s*Number\(initialAppState\.scrollX\)/u);
});

test('presentation steps update one stable Excalidraw instance', () => {
  assert.match(componentSource, /JSON\.stringify\(elements\.map\(el => el\.id\)\)/u);
  assert.match(componentSource, /restoreFullSceneRef\.current/u);
  assert.match(componentSource, /if \(!convertToExcalidrawElements\) return \[\];/u);
  assert.match(componentSource, /!convertToExcalidrawElements && elements\?\.length > 0/u);
  assert.doesNotMatch(componentSource, /JSON\.stringify\(convertedElements\.map\(el => el\.id\)\)/u);
});

test('identical Excalidraw scene changes do not create persistence revisions', () => {
  assert.match(diagramHookSource, /JSON\.stringify\(normalized\.elements\) === JSON\.stringify\(current\.elements\)/u);
  assert.match(diagramHookSource, /JSON\.stringify\(normalized\.appState\) === JSON\.stringify\(current\.appState\)/u);
  assert.match(diagramHookSource, /JSON\.stringify\(normalized\.files\) === JSON\.stringify\(current\.files\)/u);
});
