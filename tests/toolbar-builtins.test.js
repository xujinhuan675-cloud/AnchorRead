import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CUSTOM_ACTION_SELECTION_PLACEHOLDER,
} from '../lib/custom-actions.js';
import {
  MAX_TOOLBAR_BUILTIN_NAME_LENGTH,
  createDefaultToolbarBuiltins,
  isDefaultToolbarBuiltinTemplate,
  mergeToolbarBuiltins,
  toToolbarBuiltinOverrides,
} from '../lib/toolbar-builtins.js';

test('createDefaultToolbarBuiltins 返回解释/白话/图解三个默认启用的内置动作', () => {
  const builtins = createDefaultToolbarBuiltins();
  assert.equal(builtins.length, 3);
  assert.deepEqual(builtins.map((item) => item.id), ['explain', 'term', 'diagram']);
  for (const item of builtins) {
    assert.equal(item.enabled, true);
    assert.ok(item.name);
    assert.ok(item.description);
    assert.ok(item.promptTemplate.includes(CUSTOM_ACTION_SELECTION_PLACEHOLDER));
  }
});

test('isDefaultToolbarBuiltinTemplate 区分默认模板与用户修改', () => {
  const defaults = createDefaultToolbarBuiltins();
  for (const item of defaults) {
    assert.equal(isDefaultToolbarBuiltinTemplate(item), true);
  }
  const modified = { ...defaults[0], promptTemplate: `改成自己的模板：${CUSTOM_ACTION_SELECTION_PLACEHOLDER}` };
  assert.equal(isDefaultToolbarBuiltinTemplate(modified), false);
  assert.equal(isDefaultToolbarBuiltinTemplate(null), false);
  assert.equal(isDefaultToolbarBuiltinTemplate({ id: 'unknown', promptTemplate: 'x' }), false);
});

test('mergeToolbarBuiltins 无持久化数据时返回默认列表', () => {
  assert.deepEqual(mergeToolbarBuiltins(null), createDefaultToolbarBuiltins());
  assert.deepEqual(mergeToolbarBuiltins(undefined), createDefaultToolbarBuiltins());
  assert.deepEqual(mergeToolbarBuiltins('bad'), createDefaultToolbarBuiltins());
});

test('mergeToolbarBuiltins 接受改名、改说明、改模板与禁用，非法覆盖回退默认', () => {
  const customTemplate = `用自己的话解释：${CUSTOM_ACTION_SELECTION_PLACEHOLDER}`;
  const merged = mergeToolbarBuiltins({
    explain: { name: '深度解读', enabled: false },
    term: { name: '   ', description: '新说明', promptTemplate: customTemplate },
    diagram: { enabled: false, promptTemplate: '   ' },
    unknown: { name: '无效条目' },
  });
  assert.equal(merged.length, 3);

  const explain = merged.find((item) => item.id === 'explain');
  assert.equal(explain.name, '深度解读');
  assert.equal(explain.enabled, false);

  // 空白改名回退默认名；说明与模板取覆盖值
  const term = merged.find((item) => item.id === 'term');
  assert.equal(term.name, '生成白话');
  assert.equal(term.enabled, true);
  assert.equal(term.description, '新说明');
  assert.equal(term.promptTemplate, customTemplate);
  assert.equal(isDefaultToolbarBuiltinTemplate(term), false);

  // 空白模板回退默认模板，仍被视为系统默认
  const diagram = merged.find((item) => item.id === 'diagram');
  assert.equal(diagram.name, '图解');
  assert.equal(diagram.enabled, false);
  assert.equal(isDefaultToolbarBuiltinTemplate(diagram), true);
});

test('mergeToolbarBuiltins 超长改名回退默认名', () => {
  const merged = mergeToolbarBuiltins({
    explain: { name: '名'.repeat(MAX_TOOLBAR_BUILTIN_NAME_LENGTH + 1) },
  });
  assert.equal(merged.find((item) => item.id === 'explain').name, '解释这段');
});

test('toToolbarBuiltinOverrides 只落盘与默认不同的条目', () => {
  const customTemplate = `换一种问法：${CUSTOM_ACTION_SELECTION_PLACEHOLDER}`;
  const builtins = mergeToolbarBuiltins({
    explain: { name: '深度解读' },
    diagram: { enabled: false, promptTemplate: customTemplate },
  });
  assert.deepEqual(toToolbarBuiltinOverrides(builtins), {
    explain: { name: '深度解读' },
    diagram: { enabled: false, promptTemplate: customTemplate },
  });
  assert.deepEqual(toToolbarBuiltinOverrides(createDefaultToolbarBuiltins()), {});
  assert.deepEqual(toToolbarBuiltinOverrides([]), {});
});

test('toToolbarBuiltinOverrides 与 mergeToolbarBuiltins 往返一致', () => {
  const source = mergeToolbarBuiltins({
    explain: { enabled: false },
    term: { name: '白话一下', enabled: false },
  });
  assert.deepEqual(mergeToolbarBuiltins(toToolbarBuiltinOverrides(source)), source);
});
