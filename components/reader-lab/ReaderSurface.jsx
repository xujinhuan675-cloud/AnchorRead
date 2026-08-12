'use client';

import { useCallback, useEffect, useMemo } from 'react';
import { EditorContent, ReactWidgetRenderer, useEditor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import Highlight from '@tiptap/extension-highlight';
import { TableKit } from '@tiptap/extension-table';
import { UniqueID } from '@tiptap/extension-unique-id';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { BookOpenCheck, LoaderCircle, ScanText, Sparkles } from 'lucide-react';
import { markdownToSafeHtml } from '@/lib/document-content';
import InlineExplanation from './InlineExplanation';

const READER_LAB_DECORATIONS_KEY = new PluginKey('anchorReaderLabDecorations');

function validRange(record, doc) {
  const from = record?.range?.from;
  const to = record?.range?.to;
  return Number.isInteger(from) && Number.isInteger(to) && from >= 0 && to > from && to <= doc.content.size;
}

function createReaderLabDecorations(editor, records, mode, mastery, callbacks) {
  const { doc } = editor.state;
  if (mode !== 'comparison') return DecorationSet.empty;

  const decorations = [];
  for (const record of records) {
    if (!validRange(record, doc)) continue;
    decorations.push(Decoration.inline(record.range.from, record.range.to, {
      class: 'reader-lab-highlight',
      'data-reader-explanation-id': record.id,
      role: 'button',
      tabindex: '0',
      title: '查看对应解读',
    }));

    const resolvedEnd = doc.resolve(record.range.to);
    const end = resolvedEnd.depth > 0 ? resolvedEnd.after(1) : record.range.to;
    decorations.push(ReactWidgetRenderer(InlineExplanation, {
      editor,
      pos: end,
      key: `reader-lab-widget-${record.id}`,
      as: 'div',
      className: 'reader-lab-widget',
      side: 1,
      ignoreSelection: true,
      stopEvent: (event) => Boolean(event.target?.closest?.('button')),
      props: {
        record,
        mastered: Boolean(mastery[record.id]),
        onMaster: callbacks.onMaster,
        onDelete: callbacks.onDelete,
      },
    }));
  }
  return DecorationSet.create(doc, decorations);
}

function createDecorationsPlugin(editor, records, mode, mastery, callbacks) {
  return new Plugin({
    key: READER_LAB_DECORATIONS_KEY,
    props: {
      decorations() {
        return createReaderLabDecorations(editor, records, mode, mastery, callbacks);
      },
      handleClick(_view, _position, event) {
        const marker = event.target?.closest?.('[data-reader-explanation-id]');
        if (!marker) return false;
        callbacks.onFocus?.(marker.dataset.readerExplanationId);
        return true;
      },
      handleKeyDown(_view, event) {
        if (event.key !== 'Enter' && event.key !== ' ') return false;
        const marker = event.target?.closest?.('[data-reader-explanation-id]');
        if (!marker) return false;
        callbacks.onFocus?.(marker.dataset.readerExplanationId);
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
  onMaster,
  onDelete,
  onFocus,
  onProgress,
  initialScrollTop = 0,
  focusRange,
}) {
  const safeHtml = useMemo(() => markdownToSafeHtml(document.content), [document.content]);
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
    },
  });

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.commands.setContent(safeHtml, { emitUpdate: false });
  }, [editor, safeHtml]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return undefined;
    const callbacks = { onMaster, onDelete, onFocus };
    editor.unregisterPlugin(READER_LAB_DECORATIONS_KEY);
    editor.registerPlugin(createDecorationsPlugin(
      editor,
      explanations,
      mode,
      mastery,
      callbacks
    ));
    return () => {
      if (!editor.isDestroyed) editor.unregisterPlugin(READER_LAB_DECORATIONS_KEY);
    };
  }, [editor, explanations, mastery, mode, onDelete, onFocus, onMaster]);

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

  return (
    <div
      key={document.id}
      ref={restoreScroll}
      onScroll={handleScroll}
      className="reader-lab-scroll h-full min-h-0 overflow-y-auto bg-white"
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
