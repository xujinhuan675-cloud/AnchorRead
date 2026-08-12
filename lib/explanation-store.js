const STORAGE_KEY = 'anchor-read-explanations:v1';
const STORE_VERSION = 1;
const DEFAULT_MAX_ENTRIES = 80;

function getBrowserStorage() {
  return typeof window !== 'undefined' ? window.localStorage : null;
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function hashText(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function createExplanationCacheKey(article, selectedText) {
  const normalizedArticle = normalizeText(article);
  const normalizedSelection = normalizeText(selectedText);
  return `v${STORE_VERSION}:${hashText(normalizedArticle)}:${hashText(normalizedSelection)}`;
}

function emptyStore() {
  return { version: STORE_VERSION, entries: [] };
}

function readStore(storage) {
  if (!storage) return emptyStore();
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw);
    if (parsed?.version !== STORE_VERSION || !Array.isArray(parsed.entries)) {
      return emptyStore();
    }
    return parsed;
  } catch {
    return emptyStore();
  }
}

function writeStore(storage, data) {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (error) {
    console.error('Failed to save explanation cache:', error);
  }
}

export function createExplanationStore(
  storage = getBrowserStorage(),
  { maxEntries = DEFAULT_MAX_ENTRIES } = {}
) {
  const limit = Number.isInteger(maxEntries) && maxEntries > 0
    ? maxEntries
    : DEFAULT_MAX_ENTRIES;

  return {
    get(article, selectedText) {
      const normalizedArticle = normalizeText(article);
      const normalizedSelection = normalizeText(selectedText);
      if (!normalizedArticle || !normalizedSelection) return null;

      const data = readStore(storage);
      const key = createExplanationCacheKey(normalizedArticle, normalizedSelection);
      const index = data.entries.findIndex(
        (entry) =>
          entry?.key === key &&
          entry.articleLength === normalizedArticle.length &&
          entry.selectedText === normalizedSelection
      );
      if (index === -1) return null;

      const [entry] = data.entries.splice(index, 1);
      entry.accessedAt = Date.now();
      data.entries.unshift(entry);
      writeStore(storage, data);
      return entry.explanation ?? null;
    },

    set(article, selectedText, explanation) {
      const normalizedArticle = normalizeText(article);
      const normalizedSelection = normalizeText(selectedText);
      if (!normalizedArticle || !normalizedSelection || !explanation) return;

      const data = readStore(storage);
      const key = createExplanationCacheKey(normalizedArticle, normalizedSelection);
      const nextEntry = {
        key,
        articleLength: normalizedArticle.length,
        selectedText: normalizedSelection,
        explanation,
        accessedAt: Date.now(),
      };
      data.entries = [
        nextEntry,
        ...data.entries.filter(
          (entry) =>
            entry?.key !== key || entry.selectedText !== normalizedSelection
        ),
      ].slice(0, limit);
      writeStore(storage, data);
    },

    exportEntries() {
      return readStore(storage).entries;
    },

    replaceEntries(entries) {
      const nextEntries = Array.isArray(entries)
        ? entries.filter((entry) => entry && typeof entry === 'object').slice(0, limit)
        : [];
      writeStore(storage, { version: STORE_VERSION, entries: nextEntries });
    },

    clear() {
      if (!storage) return;
      try {
        storage.removeItem(STORAGE_KEY);
      } catch (error) {
        console.error('Failed to clear explanation cache:', error);
      }
    },
  };
}

export const explanationStore = createExplanationStore();
