import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CUSTOM_ACTION_SELECTION_PLACEHOLDER,
  MAX_CUSTOM_ACTION_NAME_LENGTH,
  MAX_CUSTOM_ACTION_TEMPLATE_LENGTH,
  CustomActionError,
  createCustomAction,
  renderCustomActionPrompt,
  normalizeCustomActions,
} from '../lib/custom-actions.js';

const VALID_TEMPLATE = `请用一句话解释：${CUSTOM_ACTION_SELECTION_PLACEHOLDER}`;

test('createCustomAction 校验并规范化合法动作', () => {
  const action = createCustomAction(
    { name: ' 翻译 ', promptTemplate: VALID_TEMPLATE, description: ' d ' },
    { now: 123, generateId: () => 'fixed-id' }
  );
  assert.equal(action.id, 'fixed-id');
  assert.equal(action.name, '翻译');
  assert.equal(action.description, 'd');
  assert.equal(action.enabled, true);
  assert.equal(action.createdAt, 123);
  assert.equal(action.updatedAt, 123);
});

test('createCustomAction 拒绝空名称、超长名称、空模板、超长模板', () => {
  assert.throws(() => createCustomAction({ name: '', promptTemplate: VALID_TEMPLATE }), CustomActionError);
  assert.throws(
    () => createCustomAction({ name: '名'.repeat(MAX_CUSTOM_ACTION_NAME_LENGTH + 1), promptTemplate: VALID_TEMPLATE }),
    CustomActionError
  );
  assert.throws(() => createCustomAction({ name: '翻译', promptTemplate: '' }), CustomActionError);
  assert.throws(
    () => createCustomAction({ name: '翻译', promptTemplate: `{{selection}}${'长'.repeat(MAX_CUSTOM_ACTION_TEMPLATE_LENGTH)}` }),
    CustomActionError
  );
});

test('createCustomAction 要求模板包含 {{selection}} 占位符', () => {
  assert.throws(
    () => createCustomAction({ name: '翻译', promptTemplate: '没有占位符的模板' }),
    (error) => error instanceof CustomActionError && error.message.includes('{{selection}}')
  );
});

test('createCustomAction 保留已有 id 与 createdAt，支持禁用', () => {
  const action = createCustomAction(
    { id: 'keep-me', name: '总结', promptTemplate: VALID_TEMPLATE, enabled: false, createdAt: 42 },
    { now: 999 }
  );
  assert.equal(action.id, 'keep-me');
  assert.equal(action.createdAt, 42);
  assert.equal(action.updatedAt, 999);
  assert.equal(action.enabled, false);
});

test('renderCustomActionPrompt 替换 selection 与 context 占位符', () => {
  const action = { promptTemplate: '背景：{{context}}\n问题：{{selection}}\n再看：{{selection}}' };
  const prompt = renderCustomActionPrompt(action, { selection: ' 锚点 ', context: ' 阅读 ' });
  assert.equal(prompt, '背景：阅读\n问题：锚点\n再看：锚点');
});

test('renderCustomActionPrompt 空选区或非法动作抛错', () => {
  const action = { promptTemplate: VALID_TEMPLATE };
  assert.throws(() => renderCustomActionPrompt(action, { selection: '   ' }), CustomActionError);
  assert.throws(() => renderCustomActionPrompt(null, { selection: '文本' }), CustomActionError);
});

test('normalizeCustomActions 过滤非法条目并保留合法动作', () => {
  const normalized = normalizeCustomActions([
    { name: '翻译', promptTemplate: VALID_TEMPLATE },
    { name: '', promptTemplate: VALID_TEMPLATE },
    { name: '无占位符', promptTemplate: '不含占位符' },
    'not-an-object',
    null,
  ]);
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].name, '翻译');
  assert.deepEqual(normalizeCustomActions(undefined), []);
});
