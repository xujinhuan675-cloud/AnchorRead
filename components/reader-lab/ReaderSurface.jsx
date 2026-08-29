'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef } from 'react';
import { EditorContent, ReactWidgetRenderer, useEditor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import Highlight from '@tiptap/extension-highlight';
import { TableKit } from '@tiptap/extension-table';
import { UniqueID } from '@tiptap/extension-unique-id';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { LoaderCircle, MessageCircleQuestion, PenTool, ScanText, Sparkles, TriangleAlert, LayoutGrid } from 'lucide-react';
import { markdownToSafeHtml } from '@/lib/document-content';
import { isDefaultToolbarBuiltinTemplate } from '@/lib/toolbar-builtins';
import { extractMarkdownOutline, precisionReplacementStats, clozeMappingKey } from '@/lib/reader-lab';
import { readerRoleLayer } from '@/lib/reader-analysis';
import { createPrecisionReplacementMarkdown } from './DerivedDraft';
import InlineExplanation from './InlineExplanation';
import InlineDiagramCard, { InlineDiagramPlaceholder } from './InlineDiagramCard';
import { useLocale } from '@/components/LocaleProvider';

const READER_LAB_DECORATIONS_KEY = new PluginKey('anchorReaderLabDecorations');

// 浮动工具栏内置动作图标：按内置动作 id 映射
const BUILTIN_TOOLBAR_ICONS = Object.freeze({ explain: Sparkles, term: ScanText, diagram: PenTool, ask: MessageCircleQuestion });

function validRange(record, doc) {
  const from = record?.range?.from;
  const to = record?.range?.to;
  return Number.isInteger(from) && Number.isInteger(to) && from >= 0 && to > from && to <= doc.content.size;
}

function normalizeCandidate(value) {
  return typeof value === 'string'
    ? value.replace(/\s+/gu, ' ').trim()
    : '';
}

function candidateVariants(value) {
  const normalized = normalizeCandidate(value);
  const withoutBlockMarkup = normalized
    .replace(/^\s{0,3}(?:#{1,6}|>|[-+*]|\d+[.)])\s+/u, '')
    .replace(/^\s*(`{3,}|~{3,})[^\n]*$/u, '')
    .trim();
  const withoutInlineMarkup = withoutBlockMarkup
    .replace(/\[([^\]]+)\]\([^\s)]+(?:\s+"[^"]*")?\)/gu, '$1')
    .replace(/[*_~`]*/gu, '')
    .trim();
  return [...new Set([normalized, withoutBlockMarkup, withoutInlineMarkup].filter(Boolean))];
}

// 白话视图把批量分析的映射替换为“『大白话』”，高亮/解读卡要叠加就必须能命中替换后的文本
function precisionSubstitutions(records) {
  const list = [];
  const seen = new Set();
  for (const record of records) {
    if (!record?.batchAnalysis) continue;
    for (const mapping of record?.explanation?.mappings || []) {
      const source = normalizeCandidate(mapping?.source);
      const target = typeof mapping?.target === 'string' ? mapping.target.trim() : '';
      if (!source || !target || seen.has(source)) continue;
      seen.add(source);
      list.push({ source, target });
    }
  }
  return list;
}

function markedVariants(candidate, substitutions, revealedKeys = null) {
  const variants = [];
  for (const { source, target } of substitutions) {
    if (!candidate.includes(source)) continue;
    // 填空已翻开的映射在派生文档里以『原术语』形态存在，重锚定需尝试该形态
    const marker = revealedKeys?.has(`${source}\u0000${target}`) ? `『${source}』` : `『${target}』`;
    // 替换器对每个映射只换首个命中处，同时给出全部替换的变体兜底多重命中场景
    variants.push(candidate.replace(source, marker));
    variants.push(candidate.split(source).join(marker));
  }
  return variants;
}

function textblockSegments(doc) {
  const groups = new Map();
  doc.descendants((node, pos, parent) => {
    if (!node.isText || !parent?.isTextblock || !node.text) return;
    const segments = groups.get(parent) || [];
    segments.push({ text: node.text, from: pos });
    groups.set(parent, segments);
  });
  return [...groups.values()].map((segments) => ({
    segments,
    text: segments.map((segment) => segment.text).join(''),
  }));
}

function mapTextOffset(segments, offset) {
  let remaining = offset;
  for (const segment of segments) {
    if (remaining <= segment.text.length) return segment.from + remaining;
    remaining -= segment.text.length;
  }
  const last = segments.at(-1);
  return last ? last.from + last.text.length : null;
}

// 白话替换片段以 『…』 包裹（CJK 角引号，与汉字等高不撑行）：高亮/框线只命中片段一部分时扩展到整个片段，
// 避免角引号落在选区外造成“框了一半”的观感
const PRECISION_MARKER_PATTERN = /『[^『』]*』/gu;

function expandRangeToPrecisionMarkers(range, doc) {
  let { from, to } = range;
  for (const block of textblockSegments(doc)) {
    const blockStart = block.segments[0]?.from;
    if (!Number.isInteger(blockStart)) continue;
    const blockEnd = blockStart + block.text.length;
    if (blockEnd <= from || blockStart >= to) continue;
    PRECISION_MARKER_PATTERN.lastIndex = 0;
    let match;
    while ((match = PRECISION_MARKER_PATTERN.exec(block.text)) !== null) {
      const markerFrom = blockStart + match.index;
      const markerTo = markerFrom + match[0].length;
      if (markerFrom < to && markerTo > from) {
        from = Math.min(from, markerFrom);
        to = Math.max(to, markerTo);
      }
    }
  }
  return { from, to };
}

function resolveRecordRange(record, doc, substitutions = [], revealedKeys = null) {
  if (substitutions.length === 0 && validRange(record, doc)) return record.range;

  const baseCandidates = candidateVariants(record?.source || record?.selectedText);
  // 白话视图里原文已被替换，候选文本需同时尝试带“『大白话』”或已翻开“『原术语』”标记的形态
  const candidates = substitutions.length > 0
    ? [...new Set([...baseCandidates, ...baseCandidates.flatMap((candidate) => markedVariants(candidate, substitutions, revealedKeys))])]
    : baseCandidates;
  if (candidates.length === 0) return null;

  for (const block of textblockSegments(doc)) {
    const compactBlock = block.text.replace(/\s+/gu, ' ').trim();
    for (const candidate of candidates) {
      let match = compactBlock.indexOf(candidate);
      let length = candidate.length;

      if (match === -1 && candidate.includes(compactBlock) && compactBlock.length >= 8) {
        match = 0;
        length = compactBlock.length;
      }
      if (match === -1) continue;

      const from = mapTextOffset(block.segments, match);
      const to = mapTextOffset(block.segments, match + length);
      if (Number.isInteger(from) && Number.isInteger(to) && to > from) return { from, to };
    }
  }

  return null;
}

// 填空翻转：『白话』片段的展开态由组件 state 持有并参与派生文档计算，
// 已翻开的回写『原术语』，未翻开的保持『大白话』；文档文本即状态，无需 replace 装饰

// 收集全部白话框选范围（白话视图=『…』片段命中处，原文优先=术语全部命中处），
// 供重点/解读/词语三形态拆分时“跳过”框区使用
function collectClozeRanges(doc, presentation, mappings, revealedKeys = null) {
  const ranges = [];
  if (mappings.length === 0) return ranges;
  if (presentation === 'original') {
    for (const { source } of mappings) {
      for (const block of textblockSegments(doc)) {
        const compactBlock = block.text.replace(/\s+/gu, ' ').trim();
        let index = compactBlock.indexOf(source);
        while (index !== -1) {
          const from = mapTextOffset(block.segments, index);
          const to = mapTextOffset(block.segments, index + source.length);
          if (Number.isInteger(from) && Number.isInteger(to) && to > from) ranges.push({ from, to });
          index = compactBlock.indexOf(source, index + source.length);
        }
      }
    }
  } else {
    const hiddenByTarget = new Map();
    const revealedBySource = new Map();
    for (const { source, target } of mappings) {
      const key = `${source}\u0000${target}`;
      hiddenByTarget.set(target, { key });
      revealedBySource.set(source, { key });
    }
    for (const block of textblockSegments(doc)) {
      for (const segment of block.segments) {
        PRECISION_MARKER_PATTERN.lastIndex = 0;
        let match;
        while ((match = PRECISION_MARKER_PATTERN.exec(segment.text)) !== null) {
          const inner = match[0].slice(1, -1);
          const hidden = hiddenByTarget.get(inner);
          const revealed = revealedBySource.get(inner);
          const active = (hidden && !revealedKeys?.has(hidden.key)) || (revealed && revealedKeys?.has(revealed.key));
          if (!active) continue;
          const from = segment.from + match.index;
          ranges.push({ from, to: from + match[0].length });
        }
      }
    }
  }
  return ranges.sort((a, b) => a.from - b.from);
}

// 整块标记按白话框选范围拆分逐段绘制：框区不被高亮/下划线/红笔触覆盖，
// 视觉上高亮“跳过去”、框保持独立形态；同内容多形态命中时仍嵌套叠加
function splitRangeAroundClozes(range, clozeRanges) {
  const parts = [];
  let cursor = range.from;
  for (const cloze of clozeRanges) {
    if (cloze.to <= cursor || cloze.from >= range.to) continue;
    const cutFrom = Math.max(cloze.from, cursor);
    const cutTo = Math.min(cloze.to, range.to);
    if (cutFrom > cursor) parts.push({ from: cursor, to: cutFrom });
    cursor = Math.max(cursor, cutTo);
    if (cursor >= range.to) break;
  }
  if (cursor < range.to) parts.push({ from: cursor, to: range.to });
  return parts;
}

// 装饰 title 等文案经 t 渲染时翻译：t 由组件经数据源 ref 传入，切换语言随刷新重建
function createReaderLabDecorations(editor, records, mastery, callbacks, drawings, aid = {}, layers = {}, cloze = null, pendingDiagram = null, t = (key) => key) {
  const { doc } = editor.state;
  // 白话视图与原文视图叠加同一套装饰：原文坐标失效后改用文本匹配重锚定，
  // 命中“『大白话』”替换片段时高亮直接包在替换文本上，行间解读卡照常挂载
  const { presentation = 'plain', revealedKeys = null, masteredTerms = null } = cloze || {};
  // 映射列表两种呈现共用：白话优先（plain）用于重锚定替换文本，原文优先（original）用于框选术语位置；
  // 掌握淡出：已掌握术语的映射不再参与框选/替换/chip，正文回到普通文本（高亮照常覆盖）
  const rawMappings = aid.precision ? precisionSubstitutions(records) : [];
  const mappings = masteredTerms?.size
    ? rawMappings.filter(({ source }) => !masteredTerms.has(source.trim().toLowerCase()))
    : rawMappings;
  const substitutions = presentation === 'original' ? [] : mappings;
  // 白话框选范围先收集：重点/解读/词语三形态绕开它们拆分绘制，术语区域不被高亮覆盖
  const clozeRanges = collectClozeRanges(doc, presentation, mappings, revealedKeys);
  const showExplanations = aid.explanations !== false;
  const showDiagrams = aid.diagrams !== false;

  const decorations = [];
  for (const record of records) {
    // 重点笔触/词语红框按层级可见性控制（重点入口内的多选开关）；
    // 解读锚点下划线跟随解读开关（与行间解读卡挂载条件一致），两模式互不绑架；
    // 内联装饰隐藏时直接不叠加（不能用 display:none，否则原文会一起隐藏）
    const isWord = record.level === 'word';
    const layer = isWord ? 'word' : readerRoleLayer(record.role);
    const layerHidden = layers[layer] === false;
    let range = resolveRecordRange(record, doc, substitutions, revealedKeys);
    // 白话视图里命中的替换片段需整体框选，含两端的 『 』 角引号
    if (range && substitutions.length > 0) range = expandRangeToPrecisionMarkers(range, doc);
    // 三形态均按白话框选范围拆分绘制：整块高亮遇框“跳过去”，框区保持独立形态不叠加
    const inlineParts = range ? splitRangeAroundClozes(range, clozeRanges) : [];
    if (!layerHidden && isWord) {
      // 词语层标记（句子服务中心/金句/成语）用红色高亮笔触（高亮家族专属重点、线条家族专属解读、框专属白话），由重点层级开关控制
      for (const part of inlineParts) decorations.push(Decoration.inline(part.from, part.to, {
        class: `reader-lab-word-mark reader-lab-word-mark-${record.markKind || 'center'}`,
        'data-reader-explanation-id': record.id,
        role: 'button',
        tabindex: '0',
        title: record.reason || t('reader.wordMarkTitle'),
      }));
    }
    // 解读锚点 = 下划线形态，跟随解读开关：这一行有解读就划上，
    // 与重点笔触同内容叠加时嵌套装饰各自绘制
    if (showExplanations && !isWord && record.explanation) {
      for (const part of inlineParts) decorations.push(Decoration.inline(part.from, part.to, {
        class: 'reader-lab-highlight reader-lab-highlight-explanation',
        'data-reader-explanation-id': record.id,
        role: 'button',
        tabindex: '0',
        title: record.reason || t('reader.viewExplanation'),
      }));
    }
    // 重点 = 高亮笔触形态，跟随重点层级开关；importance 调节笔触浓淡：>=4 实笔触，其余淡笔触
    if (!layerHidden && !isWord && record.role && record.role !== 'explanation') {
      const fillTier = Number(record.importance) >= 4 ? 'reader-lab-highlight-fill' : 'reader-lab-highlight-fill-soft';
      for (const part of inlineParts) decorations.push(Decoration.inline(part.from, part.to, {
        class: `reader-lab-highlight reader-lab-highlight-${record.role} ${fillTier}`,
        'data-reader-explanation-id': record.id,
        role: 'button',
        tabindex: '0',
        title: record.reason || t('reader.viewExplanation'),
      }));
    }

    // 行间解读卡在非精准替代形态下保持挂载（隐藏时用 CSS），若直接移除 widget，
    // ProseMirror 会销毁其 React 根，重新打开时重建会在 React 生命周期内 flushSync 报警；
    // 全文重点类记录没有解读内容，只保留高亮，不挂卡片
    if (!range || !record.explanation) continue;
    const resolvedEnd = doc.resolve(range.to);
    const end = resolvedEnd.depth > 0 ? resolvedEnd.after(1) : range.to;
    // ReactWidgetRenderer 返回的是 Tiptap 内部的 WidgetDecoration，
    // 需转为 ProseMirror 原生 widget 才能参与 DecorationSet.create，否则渲染时崩溃
    const widgetKey = `reader-lab-widget-${record.id}`;
    const widget = ReactWidgetRenderer(InlineExplanation, {
      editor,
      pos: end,
      key: widgetKey,
      as: 'div',
      className: 'reader-lab-widget reader-lab-explanation-widget',
      side: 1,
      ignoreSelection: true,
      stopEvent: (event) => Boolean(event.target?.closest?.('button')),
      props: {
        record,
        mastered: Boolean(mastery[record.id]),
        onMaster: callbacks.onMaster,
        onDelete: callbacks.onDelete,
        onRegisterCandidate: callbacks.onRegisterCandidate,
        onDismissCandidate: callbacks.onDismissCandidate,
      },
    });
    // 行间解读卡始终保持挂载，显隐由容器的 reader-lab-hide-explanations CSS 控制：
    // widget 按 spec.key 判等会复用旧 DOM，销毁后重建的新 React 根不会重新上屏，且重建会触发 flushSync 警告
    decorations.push(widget.toPMDecoration());
  }

  // 填空翻转：白话视图下给每个『…』片段叠加可点击 chip 装饰——
  // 未翻开映射命中『大白话』，已翻开映射命中『原术语』；点击由插件 handleClick 统一翻转；
  // data-cloze-alt 携带对侧文本供悬浮换显预览（插件滞回类驱动），不改文档也不翻转状态
  if (substitutions.length > 0) {
    const hiddenByTarget = new Map();
    const revealedBySource = new Map();
    for (const { source, target } of substitutions) {
      const key = `${source}\u0000${target}`;
      hiddenByTarget.set(target, { key, alt: source });
      revealedBySource.set(source, { key, alt: target });
    }
    for (const block of textblockSegments(doc)) {
      for (const segment of block.segments) {
        PRECISION_MARKER_PATTERN.lastIndex = 0;
        let match;
        while ((match = PRECISION_MARKER_PATTERN.exec(segment.text)) !== null) {
          const inner = match[0].slice(1, -1);
          const hidden = hiddenByTarget.get(inner);
          const revealed = revealedBySource.get(inner);
          let state = null;
          let key = '';
          let alt = '';
          if (hidden && !revealedKeys?.has(hidden.key)) {
            state = 'hidden';
            key = hidden.key;
            alt = hidden.alt;
          } else if (revealed && revealedKeys?.has(revealed.key)) {
            state = 'revealed';
            key = revealed.key;
            alt = revealed.alt;
          }
          if (!state) continue;
          const from = segment.from + match.index;
          const to = from + match[0].length;
          decorations.push(Decoration.inline(from, to, {
            class: `reader-lab-cloze${state === 'revealed' ? ' reader-lab-cloze-revealed' : ''}`,
            'data-cloze-key': key,
            'data-cloze-state': state,
            'data-cloze-alt': alt,
            role: 'button',
            tabindex: '0',
            title: state === 'revealed' ? t('reader.clozeTipPlainCollapse') : t('reader.clozeTipOriginalReveal'),
          }));
        }
      }
    }
  }

  // 原文优先：原文不动，给每个映射的术语位置（全部命中处）叠框选 chip——
  // 悬浮纯 CSS 换显『白话』；点击 = “我需要记住”，与白话优先共用同一份揭示态（revealedKeys）持久化：
  // 持久揭示 chip 常带换显视觉（宿主折叠+『白话』直显），以后无需再点；再点收回并忘掉
  if (presentation === 'original' && mappings.length > 0) {
    for (const { source, target } of mappings) {
      const key = `${source}\u0000${target}`;
      const revealed = revealedKeys?.has(key);
      for (const block of textblockSegments(doc)) {
        const compactBlock = block.text.replace(/\s+/gu, ' ').trim();
        let index = compactBlock.indexOf(source);
        while (index !== -1) {
          const from = mapTextOffset(block.segments, index);
          const to = mapTextOffset(block.segments, index + source.length);
          if (Number.isInteger(from) && Number.isInteger(to) && to > from) {
            decorations.push(Decoration.inline(from, to, {
              class: `reader-lab-cloze reader-lab-cloze-original${revealed ? ' reader-lab-cloze-revealed reader-lab-cloze-swap' : ''}`,
              'data-cloze-key': key,
              'data-cloze-state': revealed ? 'revealed' : 'unseen',
              'data-cloze-alt': target,
              role: 'button',
              tabindex: '0',
              title: revealed ? t('reader.clozeTipOriginalCollapse') : t('reader.clozeTipPlainReveal'),
            }));
          }
          index = compactBlock.indexOf(source, index + source.length);
        }
      }
    }
  }

  // 带锚点的图表在内联卡片形式插入对应原文下方，与行间解读保持一致；
  // 无锚点的全文图解挂在文档顶部，保证「图解」开关打开时一定有图可见；
  // 图表卡同样保持挂载（隐藏时用 CSS），避免销毁重建触发 flushSync
  for (const drawing of drawings) {
      let end = null;
      if (drawing.anchor?.source) {
        const range = resolveRecordRange({ source: drawing.anchor.source }, doc, substitutions, revealedKeys);
        if (!range) continue;
        const resolvedEnd = doc.resolve(range.to);
        end = resolvedEnd.depth > 0 ? resolvedEnd.after(1) : range.to;
      } else {
        // 全文图解（anchor 为空）置顶展示
        end = 0;
      }
      const diagramKey = `reader-lab-diagram-${drawing.id}`;
      const diagramWidget = ReactWidgetRenderer(InlineDiagramCard, {
        editor,
        pos: end,
        key: diagramKey,
        as: 'div',
        className: 'reader-lab-widget reader-lab-diagram-widget',
        // 置顶的全文图解用负 side 保证排在首个节点之前；锚定卡沿用正 side 跟在原文段落后
        side: end === 0 ? -1 : 1,
        ignoreSelection: true,
        // 图表内联渲染后需接管滚轮/拖拽等交互，避免事件冒泡到编辑器
        stopEvent: () => true,
        props: {
          drawing,
          document: callbacks.document,
          onCreateDrawing: callbacks.onCreateDrawing,
          onPersistDrawing: callbacks.onPersistDrawing,
          onNotice: callbacks.onNotice,
        },
      });
      // 与行间解读卡同理：图表卡保持挂载，显隐由 reader-lab-hide-diagrams CSS 控制
    decorations.push(diagramWidget.toPMDecoration());
  }

  // 划词图解生成中：先在选区下方挂占位卡，完成后被正式图解卡替换；
  // 同样保持挂载，显隐跟随 reader-lab-hide-diagrams CSS
  if (pendingDiagram?.source) {
    const pendingRange = resolveRecordRange({ source: pendingDiagram.source }, doc, substitutions, revealedKeys);
    if (pendingRange) {
      const resolvedEnd = doc.resolve(pendingRange.to);
      const pendingEnd = resolvedEnd.depth > 0 ? resolvedEnd.after(1) : pendingRange.to;
      const pendingWidget = ReactWidgetRenderer(InlineDiagramPlaceholder, {
        editor,
        pos: pendingEnd,
        key: 'reader-lab-diagram-pending',
        as: 'div',
        className: 'reader-lab-widget reader-lab-diagram-widget',
        side: 1,
        ignoreSelection: true,
        stopEvent: () => true,
        props: { source: pendingDiagram.source },
      });
      decorations.push(pendingWidget.toPMDecoration());
    }
  }
  return DecorationSet.create(doc, decorations);
}

function createDecorationsPlugin(editor, getSource) {
  // 换显滞回：进入时记录原始 footprint 矩形并加 swap 类（宿主折叠、空白收掉、
  // 外层高亮沿内联盒自然只包预览=“跳过收起部分”而非整条消失）；指针未离开原 footprint 不还原，
  // 不依赖 :hover，长原文短预览的指针脱出闪烁因此不会发生
  let swapEl = null;
  let swapRect = null;
  const clearClozeSwap = () => {
    if (swapEl) swapEl.classList.remove('reader-lab-cloze-swap');
    swapEl = null;
    swapRect = null;
  };
  const settleClozeSwap = (event) => {
    if (!swapEl) return;
    // 装饰重建后宿主节点可能被替换，失联节点直接还原
    if (!swapEl.isConnected) {
      clearClozeSwap();
      return;
    }
    const inside =
      event.clientX >= swapRect.left && event.clientX <= swapRect.right &&
      event.clientY >= swapRect.top && event.clientY <= swapRect.bottom;
    if (!inside) clearClozeSwap();
  };
  return new Plugin({
    key: READER_LAB_DECORATIONS_KEY,
    props: {
      decorations() {
        const { records, mastery, callbacks, drawings, aid, layers, cloze, pendingDiagram, t } = getSource();
        return createReaderLabDecorations(editor, records, mastery, callbacks, drawings, aid, layers, cloze, pendingDiagram, t);
      },
      handleClick(_view, _position, event) {
        // 填空 chip 优先于高亮定位：两种呈现方式点击语义一致 = “我需要记住”，
        // 翻转并持久化揭示（首点揭示并记住，再点收回并忘掉）
        const clozeEl = event.target?.closest?.('[data-cloze-key]');
        if (clozeEl) {
          getSource().callbacks.onToggleCloze?.(clozeEl.dataset.clozeKey);
          return true;
        }
        const marker = event.target?.closest?.('[data-reader-explanation-id]');
        if (!marker) return false;
        getSource().callbacks.onFocus?.(marker.dataset.readerExplanationId);
        return true;
      },
      handleKeyDown(_view, event) {
        if (event.key !== 'Enter' && event.key !== ' ') return false;
        const clozeEl = event.target?.closest?.('[data-cloze-key]');
        if (clozeEl) {
          getSource().callbacks.onToggleCloze?.(clozeEl.dataset.clozeKey);
          event.preventDefault();
          return true;
        }
        const marker = event.target?.closest?.('[data-reader-explanation-id]');
        if (!marker) return false;
        getSource().callbacks.onFocus?.(marker.dataset.readerExplanationId);
        event.preventDefault();
        return true;
      },
      // 悬浮只做临时换显预览：不写任何状态，“记住”只来自明确点击
      handleDOMEvents: {
        mouseover(_view, event) {
          // 换显滞回对所有呈现方式生效（白话 chip 与原文优先术语都带 data-cloze-alt）；
          // 原文优先的持久揭示 chip 常带 swap 视觉，不参与滞回（否则移出会被误还原）
          settleClozeSwap(event);
          const swapTarget = event.target?.closest?.('.reader-lab-cloze[data-cloze-alt]');
          const persistent = swapTarget?.dataset.clozeState === 'revealed'
            && getSource().cloze?.presentation === 'original';
          if (swapTarget && !persistent && swapTarget !== swapEl) {
            clearClozeSwap();
            swapEl = swapTarget;
            swapRect = swapTarget.getBoundingClientRect();
            swapEl.classList.add('reader-lab-cloze-swap');
          }
          return false;
        },
        mouseout(_view, event) {
          settleClozeSwap(event);
          return false;
        },
        mouseleave(_view, event) {
          settleClozeSwap(event);
          return false;
        },
      },
    },
  });
}

export default function ReaderSurface({
  document,
  outlineOpen = false,
  explanations,
  mastery,
  busyAction,
  onSelectionAction,
  onDiagramSelection,
  onOpenDiagram,
  onCreateDrawing,
  onPersistDrawing,
  onNotice,
  drawings = [],
  // 划词图解生成中的锚点：在选区下方挂占位卡，完成后被正式图解卡替换
  pendingDiagram = null,
  toolbarActions = [],
  aidVisibility,
  layerVisibility,
  // 白话呈现方式与填空揭示态均由工作台持有并持久化：两种呈现共用同一份揭示态（revealedClozes），
  // 点击 = “我需要记住”翻转并持久化揭示；悬浮只做临时换显预览；
  // masteredClozeTerms = 已掌握术语名集合，用于掌握淡出（不再替换/框选/chip）
  clozePresentation = 'plain',
  revealedClozes = null,
  masteredClozeTerms = null,
  onToggleCloze,
  onMaster,
  onDelete,
  // 提问候选词条审阅：入库/忽略都在行间卡上就近处理
  onRegisterCandidate,
  onDismissCandidate,
  onFocus,
  onProgress,
  initialScrollTop = 0,
  focusRange,
  // 白话 Tab 定位信号：{ term, nonce }，无坐标词条按术语文本匹配定位到首次出现处
  focusTermSignal,
  onAnalyzeDocument,
  analysisBusy,
}) {
  const { t } = useLocale();
  const precisionEnabled = Boolean(aidVisibility?.precision);
  // 原文优先：原文直显，术语框选交给装饰层，不生成替换后的派生文档
  const originalFirst = precisionEnabled && clozePresentation === 'original';
  // 掌握淡出（白话优先）：已掌握映射等效于永久揭示——派生文档回写原术语，不再替换成白话、无 chip
  const effectiveRevealed = useMemo(() => {
    if (!precisionEnabled || originalFirst || !masteredClozeTerms || masteredClozeTerms.size === 0) return revealedClozes;
    const merged = new Set(revealedClozes);
    for (const { source, target } of precisionSubstitutions(explanations)) {
      if (masteredClozeTerms.has(source.trim().toLowerCase())) merged.add(clozeMappingKey({ source, target }));
    }
    return merged;
  }, [precisionEnabled, originalFirst, masteredClozeTerms, revealedClozes, explanations]);
  // 白话映射列表：白话 Tab 定位候选要尝试『白话/原术语』标记形态（不做掌握过滤，已掌握术语原位即术语本身）
  const mappings = useMemo(
    () => (precisionEnabled ? precisionSubstitutions(explanations) : []),
    [precisionEnabled, explanations]
  );
  const sourceMarkdown = useMemo(
    () => (precisionEnabled && !originalFirst
      ? createPrecisionReplacementMarkdown(document, explanations, effectiveRevealed)
      : document.content),
    [document, explanations, precisionEnabled, originalFirst, effectiveRevealed]
  );
  // 精准替代开启但无可用映射时不再静默显示原文，给出明确提示并引导重新分析
  const precisionNotice = useMemo(() => {
    if (!precisionEnabled) return '';
    const stats = precisionReplacementStats(explanations);
    if (stats.batchRecords === 0) return t('reader.precisionNoRecords');
    if (stats.mappingCount === 0) return t('reader.precisionNoMappings');
    return '';
  }, [explanations, precisionEnabled, t]);
  const safeHtml = useMemo(() => markdownToSafeHtml(sourceMarkdown), [sourceMarkdown]);
  // 目录随当前渲染文本（白话模式下跟随替换后文本）提取，顺序与编辑器内 heading 节点一一对应
  const outline = useMemo(() => extractMarkdownOutline(sourceMarkdown), [sourceMarkdown]);
  const editor = useEditor({
    extensions: [
      StarterKit,
      TableKit.configure({ table: { resizable: false } }),
      Highlight.configure({ multicolor: true }),
      UniqueID.configure({
        types: ['heading', 'paragraph', 'blockquote', 'codeBlock', 'listItem'],
      }),
    ],
    content: safeHtml,
    editable: false,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: 'reader-lab-prosemirror',
        role: 'document',
        'aria-label': t('reader.documentAria', { title: document.title }),
      },
      // 解读/图表内联卡片里的 Mermaid、Excalidraw、代码编辑器会异步改写自身 DOM，
      // 这些变更不能被 ProseMirror 当成用户编辑回解析，否则会触发文档重置与装饰重建循环
      ignoreMutation: (mutation) => {
        const target = mutation?.target;
        if (!target) return false;
        const element = target.nodeType === 1 ? target : target.parentElement;
        return Boolean(element?.closest?.('.reader-lab-widget'));
      },
    },
  });

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    // 正文 aria-label 随语言与文档标题同步（editorProps 只在创建时生效一次）
    editor.view.dom.setAttribute('aria-label', t('reader.documentAria', { title: document.title }));
  }, [editor, t, document.title]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    // 延迟到宏任务再更新 ProseMirror 内容：widget 首次挂载会在 ReactRenderer 构造函数里
    // 同步 flushSync，若落在 React 渲染/提交/微任务窗口内会触发 flushSync 生命周期警告，
    // setTimeout(0) 能确保其在 React 完全空闲后执行
    const timer = window.setTimeout(() => {
      if (editor.isDestroyed) return;
      editor.commands.setContent(safeHtml, { emitUpdate: false });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [editor, safeHtml]);

  // 装饰数据源存 ref，插件只注册一次：
  // 反复 unregister/register 会销毁 widget 的 React 根，导致 Excalidraw/Monaco 重挂载并回写 drawings 形成闪烁循环
  const decorationsSourceRef = useRef(null);
  // 在 effect 中更新数据源（而非渲染期写 ref），插件回调在宏任务读取时已是最新值
  useEffect(() => {
    decorationsSourceRef.current = {
      records: explanations,
      mastery,
      callbacks: { onMaster, onDelete, onRegisterCandidate, onDismissCandidate, onFocus, onOpenDiagram, document, onCreateDrawing, onPersistDrawing, onNotice, onToggleCloze },
      drawings,
      pendingDiagram,
      aid: aidVisibility,
      layers: layerVisibility,
      cloze: { presentation: clozePresentation, revealedKeys: effectiveRevealed, masteredTerms: masteredClozeTerms },
      // 装饰文案渲染时翻译：t 随 locale 变化，refresh effect 依赖 t 触发重建
      t,
    };
  });

  useEffect(() => {
    if (!editor || editor.isDestroyed) return undefined;
    // 延迟到渲染阶段之外再注册插件，避免触发 flushSync 生命周期警告
    const timer = window.setTimeout(() => {
      if (editor.isDestroyed) return;
      editor.registerPlugin(createDecorationsPlugin(editor, () => decorationsSourceRef.current));
    }, 0);
    return () => {
      window.clearTimeout(timer);
      if (!editor.isDestroyed) editor.unregisterPlugin(READER_LAB_DECORATIONS_KEY);
    };
  }, [editor]);

  // 数据变化后用轻量 meta 事务刷新装饰：widget 按 key 复用，DOM 与 React 根不重建。
  // 同样延迟到宏任务，避免新 widget 挂载的 flushSync 落在 React 渲染/提交/微任务窗口内
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const timer = window.setTimeout(() => {
      if (editor.isDestroyed) return;
      editor.view.dispatch(editor.state.tr.setMeta('readerLabDecorationsRefresh', true));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [editor, explanations, mastery, precisionEnabled, drawings, pendingDiagram, document, aidVisibility, layerVisibility, effectiveRevealed, masteredClozeTerms, clozePresentation, t, onDelete, onFocus, onMaster, onOpenDiagram, onCreateDrawing, onPersistDrawing, onNotice, onToggleCloze]);

  useEffect(() => {
    if (!editor || editor.isDestroyed || !focusRange) return;
    const { from, to } = focusRange;
    if (!Number.isInteger(from) || !Number.isInteger(to) || from >= to) return;
    if (to > editor.state.doc.content.size) return;
    editor.chain().setTextSelection({ from, to }).scrollIntoView().run();
  }, [editor, focusRange]);

  // 白话 Tab 定位：无坐标词条（批量术语、点击回灌词条）按文本匹配首次出现处，
  // 选中并滚动到视口；紧凑化匹配与装饰层重锚定同一套规则。
  // 白话替代视图里术语原位已被替换成『白话』（翻开为『原术语』），定位不取消模式：
  // 候选 = 术语名本身 + 对应映射的标记形态，逐个尝试。
  // 编辑器内容更新在 setTimeout(0) 宏任务里，此处同样延迟一个宏任务等内容上屏
  useEffect(() => {
    if (!editor || editor.isDestroyed || !focusTermSignal) return;
    const needle = normalizeCandidate(focusTermSignal.term);
    if (!needle) return;
    const candidates = [needle];
    for (const { source, target } of mappings) {
      if (source !== needle) continue;
      const key = clozeMappingKey({ source, target });
      candidates.push(effectiveRevealed?.has(key) ? `『${source}』` : `『${target}』`);
    }
    const timer = window.setTimeout(() => {
      if (editor.isDestroyed) return;
      for (const block of textBlockSegments(editor.state.doc)) {
        const compactBlock = block.text.replace(/\s+/gu, ' ').trim();
        for (const candidate of candidates) {
          const match = compactBlock.indexOf(candidate);
          if (match === -1) continue;
          const from = mapTextOffset(block.segments, match);
          const to = mapTextOffset(block.segments, match + candidate.length);
          if (!Number.isInteger(from) || !Number.isInteger(to) || to <= from) continue;
          editor.chain().setTextSelection({ from, to }).scrollIntoView().run();
          return;
        }
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [editor, focusTermSignal, mappings, effectiveRevealed]);

  const runSelectionAction = useCallback((action) => {
    if (!editor || editor.state.selection.empty) return;
    const { from, to } = editor.state.selection;
    const text = editor.state.doc.textBetween(from, to, ' ').trim();
    if (!text) return;
    onSelectionAction({ action, from, to, text });
  }, [editor, onSelectionAction]);

  const runDiagramSelection = useCallback(() => {
    if (!editor || editor.state.selection.empty) return;
    const { from, to } = editor.state.selection;
    const text = editor.state.doc.textBetween(from, to, ' ').trim();
    if (!text) return;
    onDiagramSelection?.({ action: 'diagram', from, to, text });
  }, [editor, onDiagramSelection]);

  const handleScroll = useCallback((event) => {
    const target = event.currentTarget;
    onProgress?.({
      scrollTop: target.scrollTop,
      scrollHeight: target.scrollHeight,
      clientHeight: target.clientHeight,
    });
  }, [onProgress]);

  const restoreScroll = useCallback((node) => {
    if (node) node.scrollTop = initialScrollTop;
  }, [initialScrollTop]);

  // 目录点击定位：按顺序找到编辑器内第 index 个 heading，平滑滚动到标题上方
  const scrollToOutlineIndex = useCallback((index) => {
    if (!editor || editor.isDestroyed) return;
    let seen = 0;
    let targetPos = null;
    editor.state.doc.descendants((node, pos) => {
      if (targetPos !== null) return false;
      if (node.type.name === 'heading') {
        if (seen === index) targetPos = pos;
        seen += 1;
      }
      return undefined;
    });
    if (targetPos === null) return;
    const scroller = editor.view.dom.closest('.reader-lab-scroll');
    if (!scroller) return;
    const coords = editor.view.coordsAtPos(targetPos + 1);
    const top = coords.top - scroller.getBoundingClientRect().top + scroller.scrollTop - 16;
    scroller.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }, [editor]);

  // 解读/图表关闭时不展示对应内联卡，但保持挂载（用 CSS 隐藏），避免销毁重建触发 flushSync；
  // 解读卡只归解读模式管，重点层级开关（含句子层）不再连带隐藏解读卡——两种模式相互独立
  const hideExplanations = aidVisibility?.explanations === false;
  const hideDiagrams = aidVisibility?.diagrams === false;
  // 浮动工具栏按统一列表顺序渲染：内置与自定义动作都在其中，禁用后不上屏
  const visibleToolbarActions = useMemo(
    () => toolbarActions.filter((action) => action.enabled !== false),
    [toolbarActions]
  );

  return (
    <div key={document.id} className="relative h-full min-h-0">
    <div
      ref={restoreScroll}
      onScroll={handleScroll}
      className={`reader-lab-scroll h-full min-h-0 overflow-y-auto bg-white dark:bg-stone-950${hideExplanations ? ' reader-lab-hide-explanations' : ''}${hideDiagrams ? ' reader-lab-hide-diagrams' : ''}`}
    >
      {editor && visibleToolbarActions.length > 0 && (
        <BubbleMenu
          editor={editor}
          pluginKey="reader-lab-bubble-menu"
          updateDelay={80}
          shouldShow={({ state }) => !state.selection.empty}
          options={{ placement: 'top', offset: 8 }}
          className="flex items-center gap-1 rounded-md border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-1 shadow-xl"
        >
          {visibleToolbarActions.map((item, index) => {
            const BuiltinIcon = BUILTIN_TOOLBAR_ICONS[item.id];
            const busyKey = BuiltinIcon ? item.id : `custom:${item.id}`;
            if (BuiltinIcon) {
              // 图解模板被修改后改按模板执行，只有默认模板才走选区锚定链路；提问等其余内置动作选区即触发直出
              const isDiagram = item.id === 'diagram' && isDefaultToolbarBuiltinTemplate(item);
              return (
                <Fragment key={item.id}>
                  {index > 0 && <span className="h-5 w-px bg-stone-200 dark:bg-white/15" aria-hidden="true" />}
                  <button
                    type="button"
                    onClick={() => (isDiagram ? runDiagramSelection() : runSelectionAction(item.id))}
                    disabled={Boolean(busyAction)}
                    className="flex h-8 items-center gap-1.5 rounded px-2.5 text-xs font-medium text-stone-800 dark:text-stone-200 outline-none hover:bg-stone-100 dark:bg-white/10 focus-visible:ring-2 focus-visible:ring-stone-400 disabled:opacity-50"
                    title={item.description}
                  >
                    {busyAction === busyKey ? <LoaderCircle size={14} className="animate-spin" /> : <BuiltinIcon size={14} />}
                    {item.name}
                  </button>
                </Fragment>
              );
            }
            return (
              <Fragment key={item.id}>
                {index > 0 && <span className="h-5 w-px bg-stone-200 dark:bg-white/15" aria-hidden="true" />}
                <button
                  type="button"
                  onClick={() => runSelectionAction(`custom:${item.id}`)}
                  disabled={Boolean(busyAction)}
                  className="flex h-8 items-center gap-1.5 rounded px-2.5 text-xs font-medium text-stone-800 dark:text-stone-200 outline-none hover:bg-stone-100 dark:bg-white/10 focus-visible:ring-2 focus-visible:ring-stone-400 disabled:opacity-50"
                  title={item.description || item.name}
                >
                  {busyAction === busyKey ? <LoaderCircle size={14} className="animate-spin" /> : <LayoutGrid size={14} />}
                  {item.name}
                </button>
              </Fragment>
            );
          })}
        </BubbleMenu>
      )}

      <div className="mx-auto w-full max-w-[780px] px-5 pb-24 pt-8 sm:px-8 lg:px-12 lg:pt-12">
        {precisionNotice && (
          <div role="status" className="mb-4 flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
            <TriangleAlert size={14} className="shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1">{precisionNotice}</span>
            {onAnalyzeDocument && (
              <button
                type="button"
                onClick={onAnalyzeDocument}
                disabled={Boolean(analysisBusy)}
                className="shrink-0 rounded border border-amber-300 bg-white px-2 py-1 font-medium text-amber-800 outline-none hover:bg-amber-100 focus-visible:ring-2 focus-visible:ring-amber-400 disabled:opacity-50 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300 dark:hover:bg-amber-900"
              >
                {analysisBusy ? t('reader.analyzeBusy') : t('workspace.oneClick')}
              </button>
            )}
          </div>
        )}
        <EditorContent editor={editor} />
      </div>
    </div>

    {/* 目录抽屉：覆盖在阅读区左侧，不挤占布局；开关在顶栏，这里不重复关闭按钮 */}
    {outlineOpen && outline.length > 0 && (
      <nav aria-label={t('reader.outlineNav')} className="absolute inset-y-0 left-0 z-20 flex w-60 flex-col border-r border-stone-200 dark:border-stone-800 bg-white/95 dark:bg-stone-900/95 shadow-lg backdrop-blur-sm">
        <div className="flex shrink-0 items-center gap-2 border-b border-stone-200 dark:border-stone-800 px-3 py-2">
          <span className="text-xs font-semibold text-stone-700 dark:text-stone-300">{t('reader.outlineHeading')}</span>
          <span className="ml-auto text-[11px] text-stone-400">{t('reader.outlineCount', { count: outline.length })}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {outline.map((item, index) => (
            <button
              key={`${item.level}-${index}`}
              type="button"
              onClick={() => scrollToOutlineIndex(index)}
              style={{ paddingLeft: `${8 + (item.level - 1) * 12}px` }}
              className={`w-full rounded pr-2 py-1.5 text-left text-xs leading-5 outline-none hover:bg-stone-100 dark:bg-white/10 focus-visible:ring-2 focus-visible:ring-stone-400 ${item.level <= 1 ? 'font-medium text-stone-900 dark:text-stone-100' : 'text-stone-600 dark:text-stone-400'}`}
            >
              {item.text}
            </button>
          ))}
        </div>
      </nav>
    )}
    </div>
  );
}
