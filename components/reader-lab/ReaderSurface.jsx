'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { EditorContent, ReactWidgetRenderer, useEditor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import Highlight from '@tiptap/extension-highlight';
import { TableKit } from '@tiptap/extension-table';
import { UniqueID } from '@tiptap/extension-unique-id';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { BookOpenCheck, LoaderCircle, PenTool, ScanText, Sparkles, WandSparkles } from 'lucide-react';
import { markdownToSafeHtml } from '@/lib/document-content';
import { createPrecisionReplacementMarkdown } from './DerivedDraft';
import InlineExplanation from './InlineExplanation';
import InlineDiagramCard from './InlineDiagramCard';

const READER_LAB_DECORATIONS_KEY = new PluginKey('anchorReaderLabDecorations');

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

function resolveRecordRange(record, doc) {
  if (validRange(record, doc)) return record.range;

  const candidates = candidateVariants(record?.source || record?.selectedText);
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

function resolveMappingRange(mapping, doc) {
  return resolveRecordRange({ source: mapping?.source }, doc);
}

function createReaderLabDecorations(editor, records, mode, mastery, callbacks, drawings, aid = {}) {
  const { doc } = editor.state;
  if (mode === 'interpretation') return DecorationSet.empty;
  const showExplanations = aid.explanations !== false;
  const showDiagrams = aid.diagrams !== false;

  const decorations = [];
  for (const record of records) {
    const mappings = record.batchAnalysis && Array.isArray(record.explanation?.mappings)
      ? record.explanation.mappings
      : [];
    const range = resolveRecordRange(record, doc);
    if (mode === 'original') {
      for (const mapping of mappings) {
        const mappingRange = resolveMappingRange(mapping, doc);
        if (!mappingRange) continue;
        decorations.push(Decoration.inline(mappingRange.from, mappingRange.to, {
          class: 'reader-lab-inline-source-mapping',
          'data-reader-explanation-id': record.id,
          role: 'button',
          tabindex: '0',
          title: '查看这处精准替代',
        }));
      }
    } else if (range && showExplanations) {
      // 高亮是包裹原文的内联装饰，关闭时直接不叠加；不能用 display:none，否则原文会一起隐藏
      decorations.push(Decoration.inline(range.from, range.to, {
        class: `reader-lab-highlight reader-lab-highlight-${record.role || 'explanation'}`,
        'data-reader-explanation-id': record.id,
        role: 'button',
        tabindex: '0',
        title: record.reason || '查看对应解读',
      }));
    }

    // 行间解读卡在所有模式下都保持挂载（原文模式用 CSS 隐藏）：若在原模式移除 widget，
    // ProseMirror 会销毁其 React 根，切回对照时重建会在 React 生命周期内 flushSync 报警
    if (!range) continue;
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
  // 图表卡同样在所有模式下保持挂载（原文模式用 CSS 隐藏），避免销毁重建触发 flushSync
  for (const drawing of drawings) {
      if (!drawing.anchor?.source) continue;
      const range = resolveRecordRange({ source: drawing.anchor.source }, doc);
      if (!range) continue;
      const resolvedEnd = doc.resolve(range.to);
      const end = resolvedEnd.depth > 0 ? resolvedEnd.after(1) : range.to;
      const diagramKey = `reader-lab-diagram-${drawing.id}`;
      const diagramWidget = ReactWidgetRenderer(InlineDiagramCard, {
        editor,
        pos: end,
        key: diagramKey,
        as: 'div',
        className: 'reader-lab-widget reader-lab-diagram-widget',
        side: 1,
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
        const { records, mode, mastery, callbacks, drawings, aid } = getSource();
        return createReaderLabDecorations(editor, records, mode, mastery, callbacks, drawings, aid);
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
  mode,
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
  customActions = [],
  aidVisibility,
  onMaster,
  onDelete,
  onFocus,
  onProgress,
  initialScrollTop = 0,
  focusRange,
}) {
  const sourceMarkdown = useMemo(
    () => mode === 'interpretation'
      ? createPrecisionReplacementMarkdown(document, explanations)
      : document.content,
    [document, explanations, mode]
  );
  const safeHtml = useMemo(() => markdownToSafeHtml(sourceMarkdown), [sourceMarkdown]);
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
      mode,
      mastery,
      callbacks: { onMaster, onDelete, onFocus, onOpenDiagram, document, onCreateDrawing, onPersistDrawing, onNotice },
      drawings,
      aid: aidVisibility,
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
  }, [editor, explanations, mastery, mode, drawings, document, aidVisibility, onDelete, onFocus, onMaster, onOpenDiagram, onCreateDrawing, onPersistDrawing, onNotice]);

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

  // 原文模式不展示解读/图表内联卡，但保持挂载（用 CSS 隐藏），避免销毁重建触发 flushSync
  const hideExplanations = aidVisibility?.explanations === false || mode === 'original';
  const hideDiagrams = aidVisibility?.diagrams === false || mode === 'original';
  const enabledCustomActions = useMemo(
    () => customActions.filter((action) => action.enabled !== false),
    [customActions]
  );

  return (
    <div
      key={document.id}
      ref={restoreScroll}
      onScroll={handleScroll}
      className={`reader-lab-scroll h-full min-h-0 overflow-y-auto bg-white${hideExplanations ? ' reader-lab-hide-explanations' : ''}${hideDiagrams ? ' reader-lab-hide-diagrams' : ''}`}
    >
      {editor && (
        <BubbleMenu
          editor={editor}
          pluginKey="reader-lab-bubble-menu"
          updateDelay={80}
          shouldShow={({ state }) => !state.selection.empty}
          options={{ placement: 'top', offset: 8 }}
          className="flex items-center gap-1 rounded-md border border-gray-200 bg-white p-1 shadow-xl"
        >
          <button
            type="button"
            onClick={() => runSelectionAction('explain')}
            disabled={Boolean(busyAction)}
            className="flex h-8 items-center gap-1.5 rounded px-2.5 text-xs font-medium text-gray-800 outline-none hover:bg-gray-100 focus-visible:ring-2 focus-visible:ring-gray-400 disabled:opacity-50"
          >
            {busyAction === 'explain' ? <LoaderCircle size={14} className="animate-spin" /> : <Sparkles size={14} />}
            解释这段
          </button>
          <span className="h-5 w-px bg-gray-200" aria-hidden="true" />
          <button
            type="button"
            onClick={() => runSelectionAction('term')}
            disabled={Boolean(busyAction)}
            className="flex h-8 items-center gap-1.5 rounded px-2.5 text-xs font-medium text-gray-800 outline-none hover:bg-gray-100 focus-visible:ring-2 focus-visible:ring-gray-400 disabled:opacity-50"
          >
            <ScanText size={14} />
            识别术语
          </button>
          <span className="h-5 w-px bg-gray-200" aria-hidden="true" />
          <button
            type="button"
            onClick={runDiagramSelection}
            className="flex h-8 items-center gap-1.5 rounded px-2.5 text-xs font-medium text-gray-800 outline-none hover:bg-gray-100 focus-visible:ring-2 focus-visible:ring-gray-400"
            title="将图表锚定到当前选区，生成后插入对应原文下方"
          >
            <PenTool size={14} />
            图表
          </button>
          {enabledCustomActions.length > 0 && (
            <>
              <span className="h-5 w-px bg-gray-200" aria-hidden="true" />
              {enabledCustomActions.map((action) => (
                <button
                  type="button"
                  key={action.id}
                  onClick={() => runSelectionAction(`custom:${action.id}`)}
                  disabled={Boolean(busyAction)}
                  className="flex h-8 items-center gap-1.5 rounded px-2.5 text-xs font-medium text-gray-800 outline-none hover:bg-gray-100 focus-visible:ring-2 focus-visible:ring-gray-400 disabled:opacity-50"
                  title={action.description || action.name}
                >
                  {busyAction === `custom:${action.id}` ? <LoaderCircle size={14} className="animate-spin" /> : <WandSparkles size={14} />}
                  {action.name}
                </button>
              ))}
            </>
          )}
        </BubbleMenu>
      )}

      <div className="mx-auto w-full max-w-[780px] px-5 pb-24 pt-8 sm:px-8 lg:px-12 lg:pt-12">
        <div className="mb-7 flex items-center gap-2 text-xs text-gray-400">
          <BookOpenCheck size={15} aria-hidden="true" />
          <span>{mode === 'original' ? '事实源视图' : '原文与派生解读对照'}</span>
        </div>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
