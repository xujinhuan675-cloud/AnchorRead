import test from 'node:test';
import assert from 'node:assert/strict';
import config from '../commitlint.config.js';

const bodyRule = config.plugins[0].rules['body-grouped-ordered-list'];

function passes(body) {
  return bodyRule({ body })[0] === true;
}

test('commit body accepts ordered sections with numbered items', () => {
  assert.equal(passes('新功能\n1. 新增能力\n\n优化\n1. 降低响应体积\n\n测试\n1. 增加行为测试'), true);
});

test('commit body accepts a direct numbered list when no section applies', () => {
  assert.equal(passes('1. 更新开发说明\n- 保持现有入口'), true);
});

test('commit body rejects sections that are out of order or empty', () => {
  assert.equal(passes('测试\n1. 覆盖行为\n\n优化\n1. 降低体积'), false);
  assert.equal(passes('优化\n说明但没有编号项'), false);
});

test('commit body rejects a standalone or non-final 其他 section', () => {
  assert.equal(passes('其他\n1. 杂项'), false);
  assert.equal(passes('其他\n1. 杂项\n\n测试\n1. 覆盖规则'), false);
});
