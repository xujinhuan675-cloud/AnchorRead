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

test('scene preflight blocks fan-out connectors without elbow routes', () => {
  const result = preflightDiagramScene({ elements: [
    { id: 'source', type: 'rectangle', x: 200, y: 0, width: 160, height: 80 },
    { id: 'left', type: 'rectangle', x: 0, y: 160, width: 160, height: 80 },
    { id: 'right', type: 'rectangle', x: 400, y: 160, width: 160, height: 80 },
    {
      id: 'to-left', type: 'arrow', x: 280, y: 80, width: -200, height: 80,
      points: [[0, 0], [-200, 80]], startElementId: 'source', endElementId: 'left',
    },
    {
      id: 'to-right', type: 'arrow', x: 280, y: 80, width: 200, height: 80,
      points: [[0, 0], [200, 80]], startElementId: 'source', endElementId: 'right',
    },
  ] });

  assert.equal(result.status, 'fail');
  assert.equal(result.ok, false);
  assert.equal(result.errors.filter((item) => item.code === 'CONNECTOR_ROUTING_RISK').length, 2);
  assert.ok(result.repairSuggestions.some((item) => item.includes('elbowed')));
});

test('scene preflight blocks a too-narrow straight connector channel', () => {
  const result = preflightDiagramScene({ elements: [
    { id: 'source', type: 'rectangle', x: 0, y: 0, width: 160, height: 80 },
    { id: 'target', type: 'rectangle', x: 0, y: 114, width: 160, height: 80 },
    {
      id: 'edge', type: 'arrow', x: 80, y: 80, width: 0, height: 34,
      points: [[0, 0], [0, 34]], startElementId: 'source', endElementId: 'target',
    },
  ] });

  assert.equal(result.status, 'fail');
  assert.ok(result.errors.some((item) => item.code === 'CONNECTOR_ROUTING_RISK'));
  assert.ok(result.errors.some((item) => item.message.includes('channel-gap-34px')));
});

test('scene preflight accepts an elbowed fan-out route with explicit waypoints', () => {
  const result = preflightDiagramScene({ elements: [
    { id: 'source', type: 'rectangle', x: 200, y: 0, width: 160, height: 80 },
    { id: 'left', type: 'rectangle', x: 0, y: 160, width: 160, height: 80 },
    { id: 'right', type: 'rectangle', x: 400, y: 160, width: 160, height: 80 },
    {
      id: 'to-left', type: 'arrow', x: 280, y: 80, width: -200, height: 80,
      points: [[0, 0], [-80, 0], [-80, 80], [-200, 80]], elbowed: true,
      startElementId: 'source', endElementId: 'left',
    },
    {
      id: 'to-right', type: 'arrow', x: 280, y: 80, width: 200, height: 80,
      points: [[0, 0], [80, 0], [80, 80], [200, 80]], elbowed: true,
      startElementId: 'source', endElementId: 'right',
    },
  ] });

  assert.equal(result.errors.some((item) => item.code === 'CONNECTOR_ROUTING_RISK'), false);
});

test('scene preflight blocks elbow routes that still cross an obstacle', () => {
  const result = preflightDiagramScene({ elements: [
    { id: 'source', type: 'rectangle', x: 0, y: 0, width: 120, height: 60 },
    { id: 'obstacle', type: 'rectangle', x: 150, y: 20, width: 120, height: 80 },
    { id: 'target', type: 'rectangle', x: 280, y: 0, width: 120, height: 60 },
    {
      id: 'edge', type: 'arrow', x: 120, y: 30, width: 160, height: -30,
      points: [[0, 0], [80, 0], [80, -30], [160, -30]], elbowed: true,
      startElementId: 'source', endElementId: 'target',
    },
  ] });

  assert.ok(result.errors.some((item) => item.code === 'CONNECTOR_ROUTING_RISK'
    && item.message.includes('obstacle-crossing')));
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

test('scene preflight flags a flat multi-node scene without visual design', () => {
  const result = preflightDiagramScene({ elements: [
    { id: 'a', type: 'rectangle', x: 0, y: 0, width: 160, height: 80, label: { text: 'A' } },
    { id: 'b', type: 'rectangle', x: 240, y: 0, width: 160, height: 80, label: { text: 'B' } },
    { id: 'c', type: 'rectangle', x: 480, y: 0, width: 160, height: 80, label: { text: 'C' } },
  ] });

  assert.equal(result.status, 'warn');
  assert.ok(result.warnings.some((item) => item.code === 'VISUAL_STYLE_MISSING'));
  assert.ok(result.repairSuggestions.some((item) => item.includes('semantic colors')));
});
