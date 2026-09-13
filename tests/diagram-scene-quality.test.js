import assert from 'node:assert/strict';
import test from 'node:test';
import { preflightDiagramScene } from '../lib/diagram-scene-quality.js';

test('scene preflight passes a readable, bound flow', () => {
  const result = preflightDiagramScene({ elements: [
    { id: 'source', type: 'rectangle', x: 0, y: 0, width: 160, height: 80, label: { text: 'Source' } },
    { id: 'edge', type: 'arrow', x: 160, y: 20, width: 120, height: 0, startElementId: 'source', endElementId: 'target', label: { text: 'calls' } },
    { id: 'target', type: 'rectangle', x: 280, y: 0, width: 160, height: 80, label: { text: 'Target' } },
  ] });

  assert.equal(result.status, 'pass');
  assert.equal(result.ok, true);
  assert.equal(result.summary.connectorCount, 1);
  assert.deepEqual(result.repairSuggestions, []);
});
test('scene preflight reports actionable quality warnings and blocking id errors', () => {
  const result = preflightDiagramScene({ elements: [
    { id: 'node', type: 'rectangle', x: 0, y: 0, width: 40, height: 20, label: { text: 'A very long node label' } },
    { id: 'node', type: 'text', x: 0, y: 100, width: 20, height: 20, text: 'annotation' },
    { id: 'edge', type: 'arrow', x: 0, y: 0, width: 80, height: 0 },
  ] });

  assert.equal(result.status, 'fail');
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((item) => item.code === 'DUPLICATE_ELEMENT_ID'));
  assert.ok(result.warnings.some((item) => item.code === 'LABELLED_SHAPE_TOO_SMALL'));
  assert.ok(result.warnings.some((item) => item.code === 'UNBOUND_CONNECTOR'));
  assert.ok(result.repairSuggestions.length >= 2);
});
