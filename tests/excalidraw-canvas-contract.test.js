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
