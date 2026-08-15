/**
 * EPUB 导入契约测试（Node 环境用 linkedom 模拟浏览器 DOMParser）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import JSZip from 'jszip';

const { window } = parseHTML('<html><body></body></html>');
globalThis.DOMParser = window.DOMParser;
globalThis.document = window.document;

const { parseEpubFile, isEpubFile, EpubImportError } = await import('../lib/epub-import.js');

async function buildEpub({
  title = '测试之书',
  chapters = [
    { id: 'ch1', href: 'ch1.xhtml', body: '<h1>第一章 起源</h1><p>这是第一章的正文，内容足够长一些，用来通过 Readability 的字数判断，再补充一句话确保段落存在。</p>' },
    { id: 'ch2', href: 'ch2.xhtml', body: '<h1>第二章 发展</h1><p>第二章的正文内容，同样需要足够长度以便解析，再加一句补充文字。</p><ul><li>要点一</li></ul>' },
  ],
  opfDir = 'OEBPS/',
} = {}) {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file('META-INF/container.xml', `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="${opfDir}content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`);
  const manifest = chapters.map((ch) => `<item id="${ch.id}" href="${ch.href}" media-type="application/xhtml+xml"/>`).join('');
  const spine = chapters.map((ch) => `<itemref idref="${ch.id}"/>`).join('');
  zip.file(`${opfDir}content.opf`, `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${title}</dc:title></metadata>
  <manifest>${manifest}</manifest>
  <spine>${spine}</spine>
</package>`);
  for (const ch of chapters) {
    zip.file(`${opfDir}${ch.href}`, `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${ch.id}</title></head><body>${ch.body}</body></html>`);
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}

test('isEpubFile 按扩展名与 MIME 判断', () => {
  assert.equal(isEpubFile({ name: 'book.epub' }), true);
  assert.equal(isEpubFile({ name: 'BOOK.EPUB' }), true);
  assert.equal(isEpubFile({ name: 'a.txt', type: 'application/epub+zip' }), true);
  assert.equal(isEpubFile({ name: 'a.txt', type: 'text/plain' }), false);
  assert.equal(isEpubFile(null), false);
});

test('parseEpubFile 按 spine 顺序输出 Markdown', async () => {
  const buffer = await buildEpub();
  const { title, content } = await parseEpubFile(buffer);
  assert.equal(title, '测试之书');
  assert.match(content, /# 第一章 起源/);
  assert.match(content, /# 第二章 发展/);
  assert.match(content, /- 要点一/);
  assert.ok(content.indexOf('第一章') < content.indexOf('第二章'));
});

test('parseEpubFile 拒绝非 EPUB 压缩包', async () => {
  await assert.rejects(parseEpubFile(Buffer.from('not a zip')), EpubImportError);
});

test('parseEpubFile 拒绝缺少 container.xml 的压缩包', async () => {
  const zip = new JSZip();
  zip.file('hello.txt', 'hi');
  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  await assert.rejects(parseEpubFile(buffer), /container\.xml/);
});

test('parseEpubFile 拒绝 spine 为空的 EPUB', async () => {
  const buffer = await buildEpub({ chapters: [] });
  // 无章节时 OPF 解析直接报 spine 为空
  await assert.rejects(parseEpubFile(buffer), EpubImportError);
});
