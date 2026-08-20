import { STANDALONE_DIAGRAM_DOCUMENT_ID } from './diagram-generation.js';

export const DIAGRAM_LIBRARY_SCOPES = Object.freeze({
  all: 'all',
  document: 'document',
  freeform: 'freeform',
});

export const DIAGRAM_LIBRARY_RENDERERS = Object.freeze({
  all: 'all',
  mermaid: 'mermaid',
  excalidraw: 'excalidraw',
});

export const DIAGRAM_LIBRARY_SORTS = Object.freeze({
  updated: 'updated',
  created: 'created',
});

export function isStandaloneDrawing(drawing) {
  return drawing?.documentId === STANDALONE_DIAGRAM_DOCUMENT_ID;
}

export function getDrawingRenderer(drawing) {
  return drawing?.renderer || drawing?.engine || 'mermaid';
}

export function buildDiagramEditorHref(drawing) {
  if (!drawing?.id || !drawing?.documentId) return '/diagrams';
  const params = new URLSearchParams({
    view: 'diagram',
    drawing: drawing.id,
    document: drawing.documentId,
  });
  return `/?${params.toString()}`;
}

export function buildNewDiagramHref() {
  return '/?view=diagram&new=1';
}

export function filterAndSortDrawings({
  drawings = [],
  documents = [],
  query = '',
  scope = DIAGRAM_LIBRARY_SCOPES.all,
  renderer = DIAGRAM_LIBRARY_RENDERERS.all,
  sort = DIAGRAM_LIBRARY_SORTS.updated,
} = {}) {
  const documentTitles = new Map(documents.map((document) => [document.id, document.title || '']));
  const normalizedQuery = String(query).trim().toLocaleLowerCase();

  return drawings
    .filter((drawing) => {
      const standalone = isStandaloneDrawing(drawing);
      if (scope === DIAGRAM_LIBRARY_SCOPES.document && standalone) return false;
      if (scope === DIAGRAM_LIBRARY_SCOPES.freeform && !standalone) return false;
      if (renderer !== DIAGRAM_LIBRARY_RENDERERS.all && getDrawingRenderer(drawing) !== renderer) return false;
      if (!normalizedQuery) return true;
      const haystack = `${drawing.title || ''}\n${documentTitles.get(drawing.documentId) || ''}`.toLocaleLowerCase();
      return haystack.includes(normalizedQuery);
    })
    .sort((left, right) => {
      const field = sort === DIAGRAM_LIBRARY_SORTS.created ? 'createdAt' : 'updatedAt';
      return (right[field] || right.createdAt || 0) - (left[field] || left.createdAt || 0);
    });
}

export function duplicateDrawing(drawing, {
  id,
  now = Date.now(),
  titleSuffix = 'copy',
} = {}) {
  if (!drawing || !id) throw new TypeError('A drawing and a new id are required.');
  return {
    ...drawing,
    id,
    title: `${drawing.title || 'Untitled'} ${titleSuffix}`.trim(),
    isLocalDemo: false,
    createdAt: now,
    updatedAt: now,
  };
}
