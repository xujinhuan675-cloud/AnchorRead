function sanitizeCloneableValue(value, seen) {
  if (value === undefined || value === null) return value;

  const valueType = typeof value;
  if (valueType === 'string' || valueType === 'number' || valueType === 'boolean' || valueType === 'bigint') {
    return value;
  }
  if (valueType === 'function' || valueType === 'symbol') return undefined;
  if (valueType !== 'object') return undefined;

  if (seen.has(value)) return seen.get(value);
  if (value instanceof Date) return new Date(value.getTime());
  if (value instanceof RegExp) return new RegExp(value.source, value.flags);
  if (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer) return value.slice(0);
  if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(value)) {
    if (typeof DataView !== 'undefined' && value instanceof DataView) return new DataView(value.buffer.slice(0));
    return new value.constructor(value);
  }
  if (typeof Blob !== 'undefined' && value instanceof Blob) return value;
  if (typeof Map !== 'undefined' && value instanceof Map) {
    const output = new Map();
    seen.set(value, output);
    for (const [key, entry] of value) {
      const sanitizedKey = sanitizeCloneableValue(key, seen);
      const sanitizedEntry = sanitizeCloneableValue(entry, seen);
      if (sanitizedKey !== undefined && sanitizedEntry !== undefined) output.set(sanitizedKey, sanitizedEntry);
    }
    return output;
  }
  if (typeof Set !== 'undefined' && value instanceof Set) {
    const output = new Set();
    seen.set(value, output);
    for (const entry of value) {
      const sanitized = sanitizeCloneableValue(entry, seen);
      if (sanitized !== undefined) output.add(sanitized);
    }
    return output;
  }

  try {
    if (Object.prototype.hasOwnProperty.call(value, '$$typeof') && typeof value.$$typeof === 'symbol') {
      return undefined;
    }
  } catch {
    return undefined;
  }

  const output = Array.isArray(value) ? [] : {};
  seen.set(value, output);
  let keys;
  try {
    keys = Object.keys(value);
  } catch {
    return undefined;
  }
  for (const key of keys) {
    try {
      const sanitized = sanitizeCloneableValue(value[key], seen);
      if (sanitized !== undefined) output[key] = sanitized;
    } catch {
      // A throwing getter or Proxy property cannot cross a browser clone boundary.
    }
  }
  return output;
}

/** Clone a value for IndexedDB, BroadcastChannel, or postMessage boundaries. */
export function cloneForTransport(value) {
  if (value === undefined || value === null) return value;
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      // Fall through to the field-level sanitizer for live Excalidraw objects.
    }
  }
  return sanitizeCloneableValue(value, new WeakMap());
}
