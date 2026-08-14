export const WORKSPACE_FILE_TYPE = 'anchor-read-workspace';
export const WORKSPACE_FILE_VERSION = 1;
export const WORKSPACE_FILE_EXTENSION = '.anchorread';
export const WORKSPACE_REPOSITORY_STORES = Object.freeze([
  'documents',
  'readSessions',
  'drawings',
  'explanations',
  'terms',
  'reviewStates',
]);

export function createWorkspaceFilePayload(data, { exportedAt = Date.now() } = {}) {
  return {
    type: WORKSPACE_FILE_TYPE,
    version: WORKSPACE_FILE_VERSION,
    exportedAt,
    data: {
      documents: Array.isArray(data?.documents) ? data.documents : [],
      readSessions: Array.isArray(data?.readSessions) ? data.readSessions : [],
      drawings: Array.isArray(data?.drawings) ? data.drawings : [],
      explanations: Array.isArray(data?.explanations) ? data.explanations : [],
      terms: Array.isArray(data?.terms) ? data.terms : [],
      reviewStates: Array.isArray(data?.reviewStates) ? data.reviewStates : [],
      flashcards: Array.isArray(data?.flashcards) ? data.flashcards : [],
      diagramHistory: Array.isArray(data?.diagramHistory) ? data.diagramHistory : [],
    },
  };
}

export function parseWorkspaceFile(value) {
  let parsed;
  try {
    parsed = typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    throw new Error('工作区文件不是有效的 JSON。');
  }

  if (
    !parsed ||
    parsed.type !== WORKSPACE_FILE_TYPE ||
    parsed.version !== WORKSPACE_FILE_VERSION ||
    !parsed.data ||
    typeof parsed.data !== 'object'
  ) {
    throw new Error('不支持的 Anchor Read 工作区文件。');
  }

  return createWorkspaceFilePayload(parsed.data, {
    exportedAt: Number.isFinite(parsed.exportedAt) ? parsed.exportedAt : Date.now(),
  });
}

export async function exportWorkspace(repository, additionalData = {}) {
  const data = { ...additionalData };
  for (const storeName of WORKSPACE_REPOSITORY_STORES) {
    data[storeName] = await repository.list(storeName);
  }
  return createWorkspaceFilePayload(data);
}

export async function importWorkspace(repository, value, { replace = false } = {}) {
  const payload = parseWorkspaceFile(value);
  if (replace) await repository.clearAll();

  let count = 0;
  for (const storeName of WORKSPACE_REPOSITORY_STORES) {
    const records = payload.data[storeName];
    for (const record of records) {
      await repository.save(storeName, record);
      count += 1;
    }
  }
  return { count, payload };
}

export function downloadWorkspaceFile(payload, filename = 'anchor-read-workspace.anchorread') {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename.endsWith(WORKSPACE_FILE_EXTENSION)
    ? filename
    : `${filename}${WORKSPACE_FILE_EXTENSION}`;
  anchor.click();
  URL.revokeObjectURL(url);
}
