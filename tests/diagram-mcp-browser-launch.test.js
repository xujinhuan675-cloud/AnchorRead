import assert from 'node:assert/strict';
import test from 'node:test';
import { isOpenableDiagramUrl, openDiagramUrl } from '../lib/diagram-mcp-browser-launch.js';

test('browser launcher only accepts AnchorRead diagram paths', () => {
  assert.equal(isOpenableDiagramUrl('https://anchorread.flowguide.cc/diagrams'), true);
  assert.equal(isOpenableDiagramUrl('https://anchorread.flowguide.cc/diagrams/dg-test'), true);
  assert.equal(isOpenableDiagramUrl('https://anchorread.flowguide.cc/api/mcp'), false);
  assert.equal(isOpenableDiagramUrl('javascript:alert(1)'), false);
});

test('browser launcher can be disabled without spawning a process', () => {
  const previous = process.env.ANCHORREAD_DIAGRAM_AUTO_OPEN;
  process.env.ANCHORREAD_DIAGRAM_AUTO_OPEN = 'false';
  try {
    assert.deepEqual(openDiagramUrl('https://anchorread.flowguide.cc/diagrams'), {
      opened: false,
      code: 'AUTO_OPEN_DISABLED',
      url: 'https://anchorread.flowguide.cc/diagrams',
    });
  } finally {
    if (previous === undefined) delete process.env.ANCHORREAD_DIAGRAM_AUTO_OPEN;
    else process.env.ANCHORREAD_DIAGRAM_AUTO_OPEN = previous;
  }
});

