import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MERMAID_SYSTEM_PROMPT,
  buildMermaidUserPrompt,
  stripMermaidFence,
} from '../lib/mermaid-prompts.js';

test('builds Mermaid-only prompts with isolated source material', () => {
  assert.match(MERMAID_SYSTEM_PROMPT, /只输出可由 Mermaid 11 渲染的 DSL/);
  const prompt = buildMermaidUserPrompt('service A calls service B', 'sequence');
  assert.match(prompt, /时序图/);
  assert.match(prompt, /<source>\nservice A calls service B\n<\/source>/);
});

test('removes Markdown fences from generated Mermaid source', () => {
  assert.equal(
    stripMermaidFence('```mermaid\nflowchart LR\n  A --> B\n```'),
    'flowchart LR\n  A --> B'
  );
});
