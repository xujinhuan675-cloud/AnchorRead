export const DOCUMENT_LIBRARY_SCOPES = Object.freeze({
  active: 'active',
  archived: 'archived',
  all: 'all',
});

export const DOCUMENT_LIBRARY_SORTS = Object.freeze({
  activity: 'activity',
  updated: 'updated',
  created: 'created',
  title: 'title',
});

export const DOCUMENT_OWNED_COLLECTIONS = Object.freeze([
  'readSessions',
  'drawings',
  'explanations',
  'terms',
  'reviewStates',
]);

export function buildDocumentReaderHref(document) {
  if (!document?.id) return '/reader-lab';
  const params = new URLSearchParams({
    view: 'read',
    document: document.id,
  });
  return `/?${params.toString()}`;
}

export function getDocumentActivityTime(document, sessions = {}) {
  return sessions[document?.id]?.updatedAt || document?.updatedAt || document?.createdAt || 0;
}

export function filterAndSortDocuments({
  documents = [],
  sessions = {},
  query = '',
  scope = DOCUMENT_LIBRARY_SCOPES.active,
  sort = DOCUMENT_LIBRARY_SORTS.activity,
} = {}) {
  const normalizedQuery = String(query).trim().toLocaleLowerCase();

  return documents
    .filter((document) => {
      const archived = document.status === 'archived';
      if (scope === DOCUMENT_LIBRARY_SCOPES.active && archived) return false;
      if (scope === DOCUMENT_LIBRARY_SCOPES.archived && !archived) return false;
      if (!normalizedQuery) return true;
      const haystack = `${document.title || ''}\n${document.category || ''}\n${document.sourceName || ''}`.toLocaleLowerCase();
      return haystack.includes(normalizedQuery);
    })
    .sort((left, right) => {
      if (sort === DOCUMENT_LIBRARY_SORTS.title) {
        return String(left.title || '').localeCompare(String(right.title || ''), undefined, { sensitivity: 'base' });
      }
      if (sort === DOCUMENT_LIBRARY_SORTS.created) {
        return (right.createdAt || 0) - (left.createdAt || 0);
      }
      if (sort === DOCUMENT_LIBRARY_SORTS.updated) {
        return (right.updatedAt || right.createdAt || 0) - (left.updatedAt || left.createdAt || 0);
      }
      return getDocumentActivityTime(right, sessions) - getDocumentActivityTime(left, sessions);
    });
}

export function setDocumentArchived(document, archived, now = Date.now()) {
  if (!document) throw new TypeError('A document is required.');
  return {
    ...document,
    status: archived ? 'archived' : 'active',
    updatedAt: now,
  };
}

export async function deleteDocumentAssets({
  repository,
  flashcards,
  histories,
  documentId,
} = {}) {
  if (!repository?.documents || !documentId) {
    throw new TypeError('A workspace repository and document id are required.');
  }
  await Promise.all(DOCUMENT_OWNED_COLLECTIONS.map(async (collectionName) => {
    const collection = repository[collectionName];
    const related = await collection.list({ index: 'documentId', query: documentId });
    await Promise.all(related.map((record) => collection.remove(record.id)));
  }));
  flashcards?.removeForDocument?.(documentId);
  histories?.removeForDocument?.(documentId);
  await repository.documents.remove(documentId);
}
