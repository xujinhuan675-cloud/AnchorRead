import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CUSTOM_ACTION_SELECTION_PLACEHOLDER,
  MAX_CUSTOM_ACTION_NAME_LENGTH,
  MAX_CUSTOM_ACTION_TEMPLATE_LENGTH,
  CustomActionError,
  createCustomAction,
  createDemoCustomActions,
  createDemoCustomActionResult,
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

test('createCustomAction 保留显式 order，缺省用创建时间兼容存量数据', () => {
  const withOrder = createCustomAction(
    { name: '排序', promptTemplate: VALID_TEMPLATE, order: 3 },
    { now: 100 }
  );
  assert.equal(withOrder.order, 3);
  const fallback = createCustomAction({ name: '排序', promptTemplate: VALID_TEMPLATE }, { now: 100 });
  assert.equal(fallback.order, 100);
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

test('createDemoCustomActions returns 3 built-in actions with selection placeholder', () => {
  const actions = createDemoCustomActions({ now: 100 });
  assert.equal(actions.length, 3);
  for (const action of actions) {
    assert.equal(typeof action.id, 'string');
    assert.equal(action.enabled, true);
    assert.ok(action.promptTemplate.includes(CUSTOM_ACTION_SELECTION_PLACEHOLDER));
    assert.equal(action.createdAt >= 100, true);
    assert.equal(action.order >= 100, true);
  }
  assert.equal(actions[0].name, '提炼要点');
  assert.equal(actions[1].name, '反问检验');
  assert.equal(actions[2].name, '类比联想');
});

test('createDemoCustomActionResult produces real responses based on action name and selection', () => {
  const selection = '检索增强生成系统的上线判断不能只看回答是否流畅。还要看证据。';
  const extract = createDemoCustomActionResult({ name: '提炼要点' }, selection);
  assert.ok(extract.startsWith('核心要点：'));
  assert.ok(extract.includes('检索增强生成系统的上线判断不能只看回答是否流畅。'));

  const challenge = createDemoCustomActionResult({ name: '反问检验' }, selection);
  assert.ok(challenge.startsWith('针对「'));
  assert.ok(challenge.includes('前提'));

  const analogy = createDemoCustomActionResult({ name: '类比联想' }, selection);
  assert.ok(analogy.startsWith('可以类比为：'));

  // 未知动作名走通用兜底，仍包含选区首句
  const generic = createDemoCustomActionResult({ name: '自定义动作' }, selection);
  assert.ok(generic.includes('检索增强生成系统的上线判断不能只看回答是否流畅。'));
});
