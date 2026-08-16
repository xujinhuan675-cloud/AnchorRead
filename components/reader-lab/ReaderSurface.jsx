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
import { BookOpenCheck, LoaderCircle, PenTool, ScanText, Sparkles, TriangleAlert, WandSparkles } from 'lucide-react';
import { markdownToSafeHtml } from '@/lib/document-content';
import { isDefaultToolbarBuiltinTemplate } from '@/lib/toolbar-builtins';
import { extractMarkdownOutline, precisionReplacementStats } from '@/lib/reader-lab';
import { readerRoleLayer } from '@/lib/reader-analysis';
import { createPrecisionReplacementMarkdown } from './DerivedDraft';
import InlineExplanation from './InlineExplanation';
import InlineDiagramCard from './InlineDiagramCard';

const READER_LAB_DECORATIONS_KEY = new PluginKey('anchorReaderLabDecorations');

// 浮动工具栏内置动作图标：按内置动作 id 映射
const BUILTIN_TOOLBAR_ICONS = Object.freeze({ explain: Sparkles, term: ScanText, diagram: PenTool });

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

function markedVariants(candidate, substitutions) {
  const variants = [];
  for (const { source, target } of substitutions) {
    if (!candidate.includes(source)) continue;
    const marker = `『${target}』`;
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

function resolveRecordRange(record, doc, substitutions = []) {
  if (substitutions.length === 0 && validRange(record, doc)) return record.range;

  const baseCandidates = candidateVariants(record?.source || record?.selectedText);
  // 白话视图里原文已被替换，候选文本需同时尝试带“『大白话』”标记的形态
  const candidates = substitutions.length > 0
    ? [...new Set([...baseCandidates, ...baseCandidates.flatMap((candidate) => markedVariants(candidate, substitutions))])]
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

function createReaderLabDecorations(editor, records, mastery, callbacks, drawings, aid = {}, layers = {}) {
  const { doc } = editor.state;
  // 白话视图与原文视图叠加同一套装饰：原文坐标失效后改用文本匹配重锚定，
  // 命中“『大白话』”替换片段时高亮直接包在替换文本上，行间解读卡照常挂载
  const substitutions = aid.precision ? precisionSubstitutions(records) : [];
  const showExplanations = aid.explanations !== false;
  const showDiagrams = aid.diagrams !== false;

  const decorations = [];
  for (const record of records) {
    // 重点高亮按层级可见性控制（重点入口内的多选开关），不再跟随解读开关；
    // 高亮/框线是包裹原文的内联装饰，隐藏时直接不叠加（不能用 display:none，否则原文会一起隐藏）；
    // 重点层级只管标记层，行间解读卡属于独立的解读模式，只受解读开关控制（两模式分开）
    const isWord = record.level === 'word';
    const layer = isWord ? 'word' : readerRoleLayer(record.role);
    const layerHidden = layers[layer] === false;
    let range = resolveRecordRange(record, doc, substitutions);
    // 白话视图里命中的替换片段需整体框选，含两端的 『 』 角引号
    if (range && substitutions.length > 0) range = expandRangeToPrecisionMarkers(range, doc);
    if (!layerHidden && range && isWord) {
      // 词语层标记（句子服务中心/金句/成语）用红框，由重点层级开关控制
      decorations.push(Decoration.inline(range.from, range.to, {
        class: `reader-lab-word-mark reader-lab-word-mark-${record.markKind || 'center'}`,
        'data-reader-explanation-id': record.id,
        role: 'button',
        tabindex: '0',
        title: record.reason || '词语标记',
      }));
    } else if (!layerHidden && range) {
      // importance>=4 叠加背景（划重点），其余仅下划线（划线）
      decorations.push(Decoration.inline(range.from, range.to, {
        class: `reader-lab-highlight reader-lab-highlight-${record.role || 'explanation'}${Number(record.importance) >= 4 ? ' reader-lab-highlight-fill' : ''}`,
        'data-reader-explanation-id': record.id,
        role: 'button',
        tabindex: '0',
        title: record.reason || '查看对应解读',
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
      },
    });
    // 行间解读卡始终保持挂载，显隐由容器的 reader-lab-hide-explanations CSS 控制：
    // widget 按 spec.key 判等会复用旧 DOM，销毁后重建的新 React 根不会重新上屏，且重建会触发 flushSync 警告
    decorations.push(widget.toPMDecoration());
  }

  // 带锚点的图表在内联卡片形式插入对应原文下方，与行间解读保持一致；
  // 无锚点的全文图解挂在文档顶部，保证「图解」开关打开时一定有图可见；
  // 图表卡同样保持挂载（隐藏时用 CSS），避免销毁重建触发 flushSync
  for (const drawing of drawings) {
      let end = null;
      if (drawing.anchor?.source) {
        const range = resolveRecordRange({ source: drawing.anchor.source }, doc, substitutions);
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
  return DecorationSet.create(doc, decorations);
}

function createDecorationsPlugin(editor, getSource) {
  return new Plugin({
    key: READER_LAB_DECORATIONS_KEY,
    props: {
      decorations() {
        const { records, mastery, callbacks, drawings, aid, layers } = getSource();
        return createReaderLabDecorations(editor, records, mastery, callbacks, drawings, aid, layers);
      },
      handleClick(_view, _position, event) {
        const marker = event.target?.closest?.('[data-reader-explanation-id]');
        if (!marker) return false;
        getSource().callbacks.onFocus?.(marker.dataset.readerExplanationId);
        return true;
      },
      handleKeyDown(_view, event) {
        if (event.key !== 'Enter' && event.key !== ' ') return false;
        const marker = event.target?.closest?.('[data-reader-explanation-id]');
        if (!marker) return false;
        getSource().callbacks.onFocus?.(marker.dataset.readerExplanationId);
        event.preventDefault();
        return true;
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
  toolbarActions = [],
  aidVisibility,
  layerVisibility,
  onMaster,
  onDelete,
  onFocus,
  onProgress,
  initialScrollTop = 0,
  focusRange,
  onAnalyzeDocument,
  analysisBusy,
}) {
  const precisionEnabled = Boolean(aidVisibility?.precision);
  const sourceMarkdown = useMemo(
    () => precisionEnabled
      ? createPrecisionReplacementMarkdown(document, explanations)
      : document.content,
    [document, explanations, precisionEnabled]
  );
  // 精准替代开启但无可用映射时不再静默显示原文，给出明确提示并引导重新分析
  const precisionNotice = useMemo(() => {
    if (!precisionEnabled) return '';
    const stats = precisionReplacementStats(explanations);
    if (stats.batchRecords === 0) return '当前文档还没有全文分析记录，白话暂显示原文。';
    if (stats.mappingCount === 0) return '当前分析记录不含可替换映射，白话暂显示原文。';
    return '';
  }, [explanations, precisionEnabled]);
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
        'aria-label': `${document.title}原文`,
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
      callbacks: { onMaster, onDelete, onFocus, onOpenDiagram, document, onCreateDrawing, onPersistDrawing, onNotice },
      drawings,
      aid: aidVisibility,
      layers: layerVisibility,
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
  }, [editor, explanations, mastery, precisionEnabled, drawings, document, aidVisibility, layerVisibility, onDelete, onFocus, onMaster, onOpenDiagram, onCreateDrawing, onPersistDrawing, onNotice]);

  useEffect(() => {
    if (!editor || editor.isDestroyed || !focusRange) return;
    const { from, to } = focusRange;
    if (!Number.isInteger(from) || !Number.isInteger(to) || from >= to) return;
    if (to > editor.state.doc.content.size) return;
    editor.chain().setTextSelection({ from, to }).scrollIntoView().run();
  }, [editor, focusRange]);

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
      className={`reader-lab-scroll h-full min-h-0 overflow-y-auto bg-white${hideExplanations ? ' reader-lab-hide-explanations' : ''}${hideDiagrams ? ' reader-lab-hide-diagrams' : ''}`}
    >
      {editor && visibleToolbarActions.length > 0 && (
        <BubbleMenu
          editor={editor}
          pluginKey="reader-lab-bubble-menu"
          updateDelay={80}
          shouldShow={({ state }) => !state.selection.empty}
          options={{ placement: 'top', offset: 8 }}
          className="flex items-center gap-1 rounded-md border border-gray-200 bg-white p-1 shadow-xl"
        >
          {visibleToolbarActions.map((item, index) => {
            const BuiltinIcon = BUILTIN_TOOLBAR_ICONS[item.id];
            const busyKey = BuiltinIcon ? item.id : `custom:${item.id}`;
            if (BuiltinIcon) {
              // 图解模板被修改后改按模板执行，只有默认模板才走选区锚定链路
              const isDiagram = item.id === 'diagram' && isDefaultToolbarBuiltinTemplate(item);
              return (
                <Fragment key={item.id}>
                  {index > 0 && <span className="h-5 w-px bg-gray-200" aria-hidden="true" />}
                  <button
                    type="button"
                    onClick={() => (isDiagram ? runDiagramSelection() : runSelectionAction(item.id))}
                    disabled={Boolean(busyAction)}
                    className="flex h-8 items-center gap-1.5 rounded px-2.5 text-xs font-medium text-gray-800 outline-none hover:bg-gray-100 focus-visible:ring-2 focus-visible:ring-gray-400 disabled:opacity-50"
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
                {index > 0 && <span className="h-5 w-px bg-gray-200" aria-hidden="true" />}
                <button
                  type="button"
                  onClick={() => runSelectionAction(`custom:${item.id}`)}
                  disabled={Boolean(busyAction)}
                  className="flex h-8 items-center gap-1.5 rounded px-2.5 text-xs font-medium text-gray-800 outline-none hover:bg-gray-100 focus-visible:ring-2 focus-visible:ring-gray-400 disabled:opacity-50"
                  title={item.description || item.name}
                >
                  {busyAction === busyKey ? <LoaderCircle size={14} className="animate-spin" /> : <WandSparkles size={14} />}
                  {item.name}
                </button>
              </Fragment>
            );
          })}
        </BubbleMenu>
      )}

      <div className="mx-auto w-full max-w-[780px] px-5 pb-24 pt-8 sm:px-8 lg:px-12 lg:pt-12">
        {precisionNotice && (
          <div role="status" className="mb-4 flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <TriangleAlert size={14} className="shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1">{precisionNotice}</span>
            {onAnalyzeDocument && (
              <button
                type="button"
                onClick={onAnalyzeDocument}
                disabled={Boolean(analysisBusy)}
                className="shrink-0 rounded border border-amber-300 bg-white px-2 py-1 font-medium text-amber-800 outline-none hover:bg-amber-100 focus-visible:ring-2 focus-visible:ring-amber-400 disabled:opacity-50"
              >
                {analysisBusy ? '生成中…' : '一键生成'}
              </button>
            )}
          </div>
        )}
        <div className="mb-7 flex items-center gap-2 text-xs text-gray-400">
          <BookOpenCheck size={15} aria-hidden="true" />
          <span>{precisionEnabled
            ? ['白话', !hideExplanations && '解读', !hideDiagrams && '图解'].filter(Boolean).join(' · ')
            : ['原文', !hideExplanations && '解读', !hideDiagrams && '图解'].filter(Boolean).join(' · ')}</span>
        </div>
        <EditorContent editor={editor} />
      </div>
    </div>

    {/* 目录抽屉：覆盖在阅读区左侧，不挤占布局；开关在顶栏，这里不重复关闭按钮 */}
    {outlineOpen && outline.length > 0 && (
      <nav aria-label="文档目录" className="absolute inset-y-0 left-0 z-20 flex w-60 flex-col border-r border-gray-200 bg-white/95 shadow-lg backdrop-blur-sm">
        <div className="flex shrink-0 items-center gap-2 border-b border-gray-200 px-3 py-2">
          <span className="text-xs font-semibold text-gray-700">目录</span>
          <span className="ml-auto text-[11px] text-gray-400">{outline.length} 个标题</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {outline.map((item, index) => (
            <button
              key={`${item.level}-${index}`}
              type="button"
              onClick={() => scrollToOutlineIndex(index)}
              style={{ paddingLeft: `${8 + (item.level - 1) * 12}px` }}
              className={`w-full rounded pr-2 py-1.5 text-left text-xs leading-5 outline-none hover:bg-gray-100 focus-visible:ring-2 focus-visible:ring-gray-400 ${item.level <= 1 ? 'font-medium text-gray-900' : 'text-gray-600'}`}
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
