function decodePathSegment(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return '';
  }
}

export function buildDiagramPath(drawingId) {
  return drawingId ? `/diagrams/${encodeURIComponent(drawingId)}` : '/diagrams';
}

export function buildDocumentPath(documentId) {
  return documentId ? `/documents/${encodeURIComponent(documentId)}` : '/reader-lab';
}

export function buildNewDiagramPath() {
  return '/diagrams/new';
}

export function parseWorkspaceResourceLocation(pathname = '/', search = '') {
  if (/^\/diagrams\/new\/?$/.test(String(pathname))) {
    return { view: 'diagram', drawingId: '', documentId: '', createNew: true, stable: true };
  }

  const diagramMatch = String(pathname).match(/^\/diagrams\/([^/]+)\/?$/);
  if (diagramMatch) {
    const drawingId = decodePathSegment(diagramMatch[1]);
    return drawingId
      ? { view: 'diagram', drawingId, documentId: '', createNew: false, stable: true }
      : null;
  }

  const documentMatch = String(pathname).match(/^\/documents\/([^/]+)\/?$/);
  if (documentMatch) {
    const documentId = decodePathSegment(documentMatch[1]);
    return documentId
      ? { view: 'read', drawingId: '', documentId, createNew: false, stable: true }
      : null;
  }

  const params = new URLSearchParams(search);
  const view = params.get('view');
  if (!['diagram', 'read'].includes(view)) return null;

  return {
    view,
    drawingId: params.get('drawing') || '',
    documentId: params.get('document') || '',
    createNew: params.get('new') === '1',
    stable: false,
  };
}
