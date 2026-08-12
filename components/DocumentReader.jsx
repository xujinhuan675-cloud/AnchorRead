'use client';

import { useCallback, useEffect, useMemo } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Highlight from '@tiptap/extension-highlight';
import { TableKit } from '@tiptap/extension-table';
import { UniqueID } from '@tiptap/extension-unique-id';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import {
  markdownToSafeHtml,
  prepareDocumentHighlights,
} from '@/lib/document-content';

const HIGHLIGHT_PLUGIN_KEY = new PluginKey('anchorReadHighlights');

const LEVEL_LABELS = {
  core: '核心观点',
  concept: '概念定义',
  evidence: '关键论据',
  conclusion: '结论推断',
};

function buildDocumentTextMap(doc) {
  const characters = [];
  let previousTextEnd = null;

  doc.descendants((node, position) => {
    if (!node.isText || !node.text) return;

    if (previousTextEnd !== null && position > previousTextEnd) {
      characters.push({ character: '\n', from: null, to: null });
    }

    // ProseMirror positions use UTF-16 code units, matching JavaScript indexes.
    for (let index = 0; index < node.text.length; index += 1) {
      characters.push({
        character: node.text[index],
        from: position + index,
        to: position + index + 1,
      });
    }
    previousTextEnd = position + node.nodeSize;
  });

  return {
    characters,
    text: characters.map((entry) => entry.character).join(''),
  };
}

function candidateFromCharacterRange(characters, start, end) {
  const groups = [];
  let current = null;

  for (let index = start; index < end; index += 1) {
    const entry = characters[index];
    if (entry.from === null || entry.to === null) {
      current = null;
      continue;
    }

    if (current && current.to === entry.from) {
      current.to = entry.to;
    } else {
      current = { from: entry.from, to: entry.to };
      groups.push(current);
    }
  }

  if (groups.length === 0) return null;
  return { start, end, groups };
}

function findAllMatches(haystack, needle) {
  if (!needle) return [];

  const matches = [];
  let cursor = 0;
  while (cursor <= haystack.length - needle.length) {
    const found = haystack.indexOf(needle, cursor);
    if (found === -1) break;
    matches.push({ start: found, end: found + needle.length });
    cursor = found + Math.max(needle.length, 1);
  }
  return matches;
}

function findCandidates(textMap, query) {
  const byRange = new Map();

  findAllMatches(textMap.text, query).forEach(({ start, end }) => {
    const candidate = candidateFromCharacterRange(textMap.characters, start, end);
    if (candidate) byRange.set(`${candidate.start}:${candidate.end}`, candidate);
  });

  const compactQuery = query.replace(/\s+/gu, '');
  if (compactQuery) {
    const compactCharacters = [];
    const compactToDocument = [];
    textMap.characters.forEach((entry, documentIndex) => {
      if (!/\s/u.test(entry.character)) {
        compactCharacters.push(entry.character);
        compactToDocument.push(documentIndex);
      }
    });

    const compactText = compactCharacters.join('');
    findAllMatches(compactText, compactQuery).forEach(({ start, end }) => {
      const documentStart = compactToDocument[start];
      const documentEnd = compactToDocument[end - 1] + 1;
      const candidate = candidateFromCharacterRange(
        textMap.characters,
        documentStart,
        documentEnd
      );
      if (candidate) byRange.set(`${candidate.start}:${candidate.end}`, candidate);
    });
  }

  return [...byRange.values()].sort((a, b) => a.start - b.start);
}

function overlapsClaimed(candidate, claimedRanges) {
  return candidate.groups.some((group) =>
    claimedRanges.some((claimed) =>
      group.from < claimed.to && group.to > claimed.from
    )
  );
}

function chooseCandidate(candidates, preferredOccurrence, claimedRanges) {
  if (candidates.length === 0) return null;

  const preferred = Math.min(
    Math.max(preferredOccurrence || 0, 0),
    candidates.length - 1
  );
  const ordered = [
    ...candidates.slice(preferred),
    ...candidates.slice(0, preferred),
  ];

  return ordered.find((candidate) => !overlapsClaimed(candidate, claimedRanges)) || null;
}

function buildHighlightDecorations(doc, preparedHighlights) {
  const textMap = buildDocumentTextMap(doc);
  const decorations = [];
  const claimedRanges = [];

  preparedHighlights.forEach((highlight, highlightIndex) => {
    const candidates = findCandidates(
      textMap,
      highlight.documentText || highlight.text
    );
    const candidate = chooseCandidate(
      candidates,
      highlight.preferredOccurrence,
      claimedRanges
    );
    if (!candidate) return;

    const levelLabel = LEVEL_LABELS[highlight.level];
    const accessibleLabel = highlight.reason
      ? `${levelLabel}：${highlight.reason}`
      : levelLabel;

    candidate.groups.forEach(({ from, to }) => {
      decorations.push(Decoration.inline(from, to, {
        class: `anchor-read-highlight anchor-read-highlight--${highlight.level}`,
        'data-anchor-highlight-index': String(highlightIndex),
        'data-highlight-level': highlight.level,
        'aria-label': accessibleLabel,
        role: 'button',
        tabindex: '0',
        title: highlight.reason || levelLabel,
      }));
      claimedRanges.push({ from, to });
    });
  });

  return DecorationSet.create(doc, decorations);
}

function createHighlightPlugin(preparedHighlights) {
  return new Plugin({
    key: HIGHLIGHT_PLUGIN_KEY,
    props: {
      decorations(state) {
        return buildHighlightDecorations(state.doc, preparedHighlights);
      },
    },
  });
}

/**
 * Read-only Markdown document surface for Anchor Read.
 * Highlights are presentation-only ProseMirror Decorations, so the document
 * content remains the source of truth and can be toggled or regenerated safely.
 */
export default function DocumentReader({
  content = '',
  highlights = [],
  onHighlightSelect,
  onSelectHighlight,
}) {
  const safeHtml = useMemo(() => markdownToSafeHtml(content), [content]);
  const preparedHighlights = useMemo(
    () => prepareDocumentHighlights(content, highlights),
    [content, highlights]
  );

  const editor = useEditor({
    extensions: [
      StarterKit,
      TableKit.configure({
        table: {
          resizable: false,
        },
      }),
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
        class: 'anchor-read-prosemirror',
        role: 'document',
        'aria-label': '文章正文',
      },
    },
  });

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.commands.setContent(safeHtml, { emitUpdate: false });
  }, [editor, safeHtml]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return undefined;

    editor.unregisterPlugin(HIGHLIGHT_PLUGIN_KEY);
    editor.registerPlugin(createHighlightPlugin(preparedHighlights));

    return () => {
      if (!editor.isDestroyed) editor.unregisterPlugin(HIGHLIGHT_PLUGIN_KEY);
    };
  }, [editor, preparedHighlights]);

  const selectHighlightFromTarget = useCallback((target) => {
    const marker = target?.closest?.('[data-anchor-highlight-index]');
    if (!marker) return false;

    const highlightIndex = Number(marker.dataset.anchorHighlightIndex);
    const selected = preparedHighlights[highlightIndex];
    if (!selected) return false;

    const selectHandler = onHighlightSelect || onSelectHighlight;
    selectHandler?.(selected.item);
    return true;
  }, [onHighlightSelect, onSelectHighlight, preparedHighlights]);

  const handleClick = useCallback((event) => {
    selectHighlightFromTarget(event.target);
  }, [selectHighlightFromTarget]);

  const handleKeyDown = useCallback((event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (selectHighlightFromTarget(event.target)) event.preventDefault();
  }, [selectHighlightFromTarget]);

  return (
    <div
      className="anchor-read-document h-full min-h-0 overflow-y-auto bg-white"
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      aria-busy={!editor}
    >
      <div className="mx-auto w-full max-w-[860px] px-5 py-8 sm:px-8 lg:px-12 lg:py-12">
        <EditorContent editor={editor} />
      </div>

      <style jsx global>{`
        .anchor-read-prosemirror {
          min-height: 100%;
          color: #27272a;
          font-size: 16px;
          line-height: 1.9;
          letter-spacing: 0;
          overflow-wrap: anywhere;
          outline: none;
        }

        .anchor-read-prosemirror > :first-child { margin-top: 0; }
        .anchor-read-prosemirror > :last-child { margin-bottom: 0; }
        .anchor-read-prosemirror p { margin: 0 0 1.1em; }
        .anchor-read-prosemirror h1,
        .anchor-read-prosemirror h2,
        .anchor-read-prosemirror h3,
        .anchor-read-prosemirror h4 {
          color: #18181b;
          font-weight: 700;
          line-height: 1.35;
          letter-spacing: 0;
          scroll-margin-top: 24px;
        }
        .anchor-read-prosemirror h1 { margin: 0 0 1em; font-size: 1.875rem; }
        .anchor-read-prosemirror h2 { margin: 1.9em 0 0.7em; font-size: 1.45rem; }
        .anchor-read-prosemirror h3 { margin: 1.6em 0 0.6em; font-size: 1.2rem; }
        .anchor-read-prosemirror h4 { margin: 1.4em 0 0.5em; font-size: 1rem; }
        .anchor-read-prosemirror ul,
        .anchor-read-prosemirror ol { margin: 0.6em 0 1.2em; padding-left: 1.55em; }
        .anchor-read-prosemirror ul { list-style: disc; }
        .anchor-read-prosemirror ol { list-style: decimal; }
        .anchor-read-prosemirror li { margin: 0.35em 0; padding-left: 0.2em; }
        .anchor-read-prosemirror li > p { margin-bottom: 0.35em; }
        .anchor-read-prosemirror blockquote {
          margin: 1.5em 0;
          padding: 0.65em 1em;
          border-left: 3px solid #71717a;
          background: #f4f4f5;
          color: #3f3f46;
        }
        .anchor-read-prosemirror blockquote p { margin: 0; }
        .anchor-read-prosemirror hr { margin: 2.2em 0; border: 0; border-top: 1px solid #d4d4d8; }
        .anchor-read-prosemirror a { color: #0369a1; text-decoration: underline; text-underline-offset: 3px; }
        .anchor-read-prosemirror code {
          border-radius: 4px;
          background: #f4f4f5;
          color: #be123c;
          padding: 0.12em 0.35em;
          font-size: 0.9em;
        }
        .anchor-read-prosemirror pre {
          margin: 1.5em 0;
          overflow-x: auto;
          border: 1px solid #3f3f46;
          border-radius: 6px;
          background: #18181b;
          padding: 1em 1.1em;
          color: #f4f4f5;
          line-height: 1.65;
        }
        .anchor-read-prosemirror pre code { background: transparent; color: inherit; padding: 0; }
        .anchor-read-prosemirror table {
          display: block;
          width: 100%;
          margin: 1.5em 0;
          overflow-x: auto;
          border-collapse: collapse;
        }
        .anchor-read-prosemirror th,
        .anchor-read-prosemirror td {
          min-width: 120px;
          border: 1px solid #d4d4d8;
          padding: 0.55em 0.75em;
          text-align: left;
          vertical-align: top;
        }
        .anchor-read-prosemirror th { background: #f4f4f5; color: #18181b; font-weight: 650; }
        .anchor-read-prosemirror img { max-width: 100%; height: auto; }

        .anchor-read-highlight {
          border-bottom: 2px solid transparent;
          border-radius: 2px;
          box-decoration-break: clone;
          -webkit-box-decoration-break: clone;
          cursor: pointer;
          padding: 0.08em 0.06em;
          transition: filter 140ms ease, box-shadow 140ms ease;
        }
        .anchor-read-highlight:hover { filter: saturate(1.12) brightness(0.98); }
        .anchor-read-highlight:focus-visible {
          box-shadow: 0 0 0 2px #ffffff, 0 0 0 4px #18181b;
          outline: none;
        }
        .anchor-read-highlight--core { background: #fee2e2; border-bottom-color: #ef4444; }
        .anchor-read-highlight--concept { background: #dbeafe; border-bottom-color: #3b82f6; }
        .anchor-read-highlight--evidence { background: #dcfce7; border-bottom-color: #22c55e; }
        .anchor-read-highlight--conclusion { background: #ffedd5; border-bottom-color: #f97316; }

        @media (max-width: 640px) {
          .anchor-read-prosemirror { font-size: 15px; line-height: 1.82; }
          .anchor-read-prosemirror h1 { font-size: 1.6rem; }
          .anchor-read-prosemirror h2 { font-size: 1.3rem; }
        }
      `}</style>
    </div>
  );
}
