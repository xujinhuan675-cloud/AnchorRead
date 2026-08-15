import assert from 'node:assert/strict';
import test from 'node:test';
import { parseHTML } from 'linkedom';
import { htmlToMarkdown } from '../lib/html-to-markdown.js';

function convert(html) {
  const { document } = parseHTML(`<div id="root">${html}</div>`);
  return htmlToMarkdown(document.getElementById('root'));
}

test('converts headings, paragraphs and inline emphasis', () => {
  const markdown = convert(
    '<h1>标题</h1><p>这是<strong>重点</strong>与<em>强调</em>以及<code>code()</code>。</p>'
  );
  assert.equal(markdown, '# 标题\n\n这是**重点**与*强调*以及`code()`。');
});

test('converts links and skips script/style content', () => {
  const markdown = convert(
    '<p>参考<a href="https://example.com">官方文档</a>。<script>evil()</script><style>.x{}</style></p>'
  );
  assert.equal(markdown, '参考[官方文档](https://example.com)。');
});

test('converts lists, blockquote and code block', () => {
  const markdown = convert(
    '<ul><li>甲</li><li>乙</li></ul><blockquote>引言内容</blockquote><pre><code>const a = 1;</code></pre>'
  );
  assert.equal(markdown, '- 甲\n- 乙\n\n> 引言内容\n\n```\nconst a = 1;\n```');
});

test('converts gfm table with separator row', () => {
  const markdown = convert(
    '<table><tr><th>名称</th><th>值</th></tr><tr><td>a</td><td>1</td></tr></table>'
  );
  assert.equal(markdown, '| 名称 | 值 |\n| --- | --- |\n| a | 1 |');
});

test('collapses nested wrappers and strips empty output', () => {
  assert.equal(convert('<div><section><p>  正文  </p></section></div>'), '正文');
  assert.equal(convert('<div><script>x()</script></div>'), '');
});
