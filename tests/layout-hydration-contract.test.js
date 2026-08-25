import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const layoutSource = fs.readFileSync(path.join(testDirectory, '..', 'app', 'layout.js'), 'utf8');

test('root body tolerates browser extension data attributes during hydration', () => {
  assert.match(layoutSource, /<body[\s\S]*suppressHydrationWarning[\s\S]*>/u);
  assert.match(layoutSource, /removeAttribute\("data-atm-ext-installed"\)/u);
});
