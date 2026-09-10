const DEFAULT_TRACE_SAMPLE_RATE = 0.2;
const REDACTED_ERROR_MESSAGE = '[message redacted]';
const ANONYMOUS_USER_ID_PATTERN = /^ar-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ANONYMOUS_USER_STORAGE_KEY = 'anchorread.sentry.anonymous-user';

const SAFE_EVENT_TAG_KEYS = new Set([
  'api_route',
  'document_id',
  'drawing_id',
  'engine',
  'error_code',
  'error_id',
  'failure_kind',
  'http_status',
  'model',
  'operation',
  'provider_request_id',
  'provider',
  'service',
  'task',
  'upstream_code',
  'upstream_status',
]);

const SAFE_API_CONTEXT_KEYS = new Set([
  'api_route',
  'document_id',
  'drawing_id',
  'engine',
  'error_code',
  'error_id',
  'failure_kind',
  'model',
  'operation',
  'provider_request_id',
  'provider',
  'route',
  'status',
  'task',
  'upstream_code',
  'upstream_status',
]);

const SAFE_SPAN_ATTRIBUTE_KEYS = new Set([
  'app.llm.first_chunk_ms',
  'app.llm.failure_kind',
  'app.llm.message_count',
  'app.llm.model',
  'app.llm.outcome',
  'app.llm.provider',
  'app.llm.request_id',
  'app.llm.streaming',
  'app.api.operation',
  'app.api.outcome',
  'app.mcp.method',
  'app.mcp.outcome',
  'app.mcp.tool',
  'app.mcp.transport',
  'http.request.method',
  'http.response.status_code',
]);

const SAFE_BREADCRUMB_DATA_KEYS = new Set([
  'action',
  'component',
  'element_count',
  'failure_kind',
  'from',
  'method',
  'model',
  'outcome',
  'provider',
  'request_id',
  'route',
  'status_code',
  'to',
  'url',
]);

export function parseSentrySampleRate(value, fallback = DEFAULT_TRACE_SAMPLE_RATE) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback;
}

export function safeTelemetryIdentifier(value, fallback = 'unknown') {
  const identifier = String(value || '').trim();
  if (!identifier || identifier.length > 80 || !/^[a-z0-9._:@/+~-]+$/i.test(identifier)) {
    return fallback;
  }
  return identifier;
}

export function isSafeAnonymousTelemetryUserId(value) {
  return ANONYMOUS_USER_ID_PATTERN.test(String(value || ''));
}

export function getOrCreateAnonymousTelemetryUserId(options = {}) {
  try {
    const storage = Object.hasOwn(options, 'storage') ? options.storage : globalThis.localStorage;
    const randomUUID = Object.hasOwn(options, 'randomUUID')
      ? options.randomUUID
      : globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
    const existing = storage?.getItem?.(ANONYMOUS_USER_STORAGE_KEY);
    if (isSafeAnonymousTelemetryUserId(existing)) return existing;
    if (typeof randomUUID !== 'function') return undefined;
    const created = `ar-${randomUUID()}`;
    if (!isSafeAnonymousTelemetryUserId(created)) return undefined;
    storage?.setItem?.(ANONYMOUS_USER_STORAGE_KEY, created);
    return created;
  } catch {
    return undefined;
  }
}

export function normalizeSentryRoute(value) {
  let text = String(value || '').trim();
  if (!text) return text;

  const methodMatch = text.match(/^([A-Z]{3,10})\s+(.+)$/);
  const method = methodMatch?.[1];
  if (methodMatch) text = methodMatch[2];

  if (/^https?:\/\//i.test(text)) {
    try {
      text = new URL(text).pathname;
    } catch {
      text = text.split(/[?#]/, 1)[0];
    }
  } else {
    text = text.split(/[?#]/, 1)[0];
  }

  text = text
    .replace(/\/documents\/[^/\s]+/gi, '/documents/:documentId')
    .replace(/\/diagrams\/[^/\s]+/gi, '/diagrams/:drawingId');

  return method ? `${method} ${text}` : text;
}

function cleanSpanAttributes(attributes) {
  if (!attributes || typeof attributes !== 'object') return undefined;
  const clean = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (!SAFE_SPAN_ATTRIBUTE_KEYS.has(key)) continue;
    if (typeof value === 'number' && Number.isFinite(value)) clean[key] = value;
    if (typeof value === 'boolean') clean[key] = value;
    if (typeof value === 'string') clean[key] = safeTelemetryIdentifier(value);
  }
  return Object.keys(clean).length > 0 ? clean : undefined;
}

function cleanSpanDescription(span) {
  const op = String(span?.op || '');
  if (op === 'ai.llm' || op === 'mcp.server' || op === 'api.handler') {
    return String(span.description || '').slice(0, 120);
  }
  if (/^(http|resource|navigation|pageload|function\.nextjs|middleware\.nextjs)/.test(op)) {
    return normalizeSentryRoute(span.description);
  }
  return undefined;
}

function cleanFilename(filename) {
  const normalized = String(filename || '').replaceAll('\\', '/').split(/[?#]/, 1)[0];
  if (!normalized) return normalized;
  if (/^https?:\/\//i.test(normalized)) {
    try {
      return normalizeSentryRoute(new URL(normalized).pathname);
    } catch {
      return '[source]';
    }
  }
  if (!/^(?:[a-z]:\/|\/)/i.test(normalized)) return normalized;

  const marker = normalized.match(/\/(?:\.next|app|components|lib|mcp)\/.+$/)?.[0];
  if (marker) return `app://${marker}`;
  return `app:///${normalized.split('/').filter(Boolean).slice(-3).join('/')}`;
}

function cleanStaticAssetLocation(value) {
  const text = String(value || '').replaceAll('\\', '/').split(/[?#]/, 1)[0];
  if (!text) return undefined;
  if (/^https?:\/\//iu.test(text)) {
    try {
      const url = new URL(text);
      return url.pathname.startsWith('/_next/static/') ? `${url.origin}${url.pathname}` : undefined;
    } catch {
      return undefined;
    }
  }
  return /^(?:app:\/\/\/)?\/?_next\/static\//iu.test(text) ? text : undefined;
}

function safeExceptionMessage(exception) {
  const type = String(exception?.type || '');
  const value = String(exception?.value || '');
  if (type === 'DataCloneError' && /react\.transitional\.element/iu.test(value)) {
    return 'structuredClone rejected a React element in transient UI state';
  }
  if (type === 'ChunkLoadError') return 'A versioned application chunk failed to load';
  if (type === 'LLMProviderError'
    && /^LLM provider request failed \([a-z0-9._-]+(?:, HTTP [1-5][0-9]{2})?\)$/iu.test(value)) {
    return value;
  }
  return REDACTED_ERROR_MESSAGE;
}

function cleanException(exception) {
  if (!exception || typeof exception !== 'object') return;
  exception.value = safeExceptionMessage(exception);
  exception.type = safeTelemetryIdentifier(exception.type, 'Error');
  const frames = exception.stacktrace?.frames;
  if (!Array.isArray(frames)) return;
  for (const frame of frames) {
    if (!frame || typeof frame !== 'object') continue;
    const staticAsset = cleanStaticAssetLocation(frame.abs_path)
      || cleanStaticAssetLocation(frame.filename);
    frame.filename = staticAsset || cleanFilename(frame.filename);
    if (staticAsset) frame.abs_path = staticAsset;
    else delete frame.abs_path;
    delete frame.context_line;
    delete frame.pre_context;
    delete frame.post_context;
    delete frame.vars;
  }
}

function pickRuntimeContext(context = {}) {
  if (!context || typeof context !== 'object') return undefined;
  const clean = {};
  for (const key of ['name', 'version']) {
    if (context[key]) clean[key] = safeTelemetryIdentifier(context[key]);
  }
  return Object.keys(clean).length > 0 ? clean : undefined;
}

function pickDeviceContext(context = {}) {
  if (!context || typeof context !== 'object') return undefined;
  const clean = {};
  for (const key of ['family', 'model', 'brand']) {
    if (!context[key]) continue;
    const value = safeTelemetryIdentifier(context[key]);
    if (value !== 'unknown') clean[key] = value;
  }
  return Object.keys(clean).length > 0 ? clean : undefined;
}

function cleanContexts(contexts) {
  if (!contexts || typeof contexts !== 'object') return undefined;
  const clean = {};
  for (const key of ['browser', 'os', 'runtime']) {
    const context = pickRuntimeContext(contexts[key]);
    if (context) clean[key] = context;
  }
  const device = pickDeviceContext(contexts.device);
  if (device) clean.device = device;
  if (contexts.trace && typeof contexts.trace === 'object') {
    const trace = {};
    for (const key of ['trace_id', 'span_id', 'parent_span_id', 'op', 'status', 'origin']) {
      if (contexts.trace[key] !== undefined) trace[key] = contexts.trace[key];
    }
    const data = cleanSpanAttributes(contexts.trace.data);
    if (data) trace.data = data;
    clean.trace = trace;
  }
  for (const contextName of ['api', 'ui']) {
    const source = contexts[contextName];
    if (!source || typeof source !== 'object') continue;
    const safe = {};
    for (const [key, value] of Object.entries(source)) {
      if (!SAFE_API_CONTEXT_KEYS.has(key) && !(contextName === 'ui' && key === 'component')) continue;
      if (key === 'route' || key === 'api_route') {
        const route = normalizeSentryRoute(value);
        if (route) safe[key] = route;
      } else if (typeof value === 'number' && Number.isFinite(value)) {
        safe[key] = value;
      } else if (typeof value === 'string') {
        const normalized = safeTelemetryIdentifier(value);
        if (normalized !== 'unknown') safe[key] = normalized;
      }
    }
    if (Object.keys(safe).length > 0) clean[contextName] = safe;
  }
  return Object.keys(clean).length > 0 ? clean : undefined;
}

function cleanBreadcrumbData(data) {
  if (!data || typeof data !== 'object') return undefined;
  const clean = {};
  for (const [key, value] of Object.entries(data)) {
    if (!SAFE_BREADCRUMB_DATA_KEYS.has(key)) continue;
    if (['from', 'to', 'url', 'route'].includes(key)) {
      const route = normalizeSentryRoute(value);
      if (route) clean[key] = route;
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      clean[key] = value;
    } else if (typeof value === 'boolean') {
      clean[key] = value;
    } else if (typeof value === 'string') {
      const identifier = safeTelemetryIdentifier(value);
      if (identifier !== 'unknown') clean[key] = identifier;
    }
  }
  return Object.keys(clean).length > 0 ? clean : undefined;
}

export function sanitizeSentryBreadcrumb(breadcrumb) {
  if (!breadcrumb || typeof breadcrumb !== 'object') return null;
  const category = safeTelemetryIdentifier(breadcrumb.category, '');
  const allowed = category === 'navigation'
    || category === 'fetch'
    || category === 'xhr'
    || category === 'http'
    || category === 'api'
    || category === 'ai.llm'
    || category.startsWith('ui.')
    || category.startsWith('anchorread.');
  if (!allowed) return null;

  const clean = { category };
  const type = safeTelemetryIdentifier(breadcrumb.type, '');
  if (type) clean.type = type;
  const level = safeTelemetryIdentifier(breadcrumb.level, '');
  if (level) clean.level = level;
  if (Number.isFinite(breadcrumb.timestamp)) clean.timestamp = breadcrumb.timestamp;
  const message = safeTelemetryIdentifier(breadcrumb.message, '');
  if (message) clean.message = message;
  const data = cleanBreadcrumbData(breadcrumb.data);
  if (data) clean.data = data;
  return clean;
}

function cleanAnonymousUser(user) {
  if (!isSafeAnonymousTelemetryUserId(user?.id)) return undefined;
  return { id: user.id };
}

function cleanEventTags(tags) {
  if (!tags || typeof tags !== 'object') return undefined;
  const clean = {};
  for (const [key, value] of Object.entries(tags)) {
    if (!SAFE_EVENT_TAG_KEYS.has(key)) continue;
    if (key === 'api_route') {
      const route = normalizeSentryRoute(value);
      if (route) clean[key] = route;
      continue;
    }
    const normalized = safeTelemetryIdentifier(value);
    if (normalized !== 'unknown') clean[key] = normalized;
  }
  return Object.keys(clean).length > 0 ? clean : undefined;
}

export function sanitizeSentryEvent(event) {
  if (!event || typeof event !== 'object') return event;

  if (event.request && typeof event.request === 'object') {
    event.request = {
      method: safeTelemetryIdentifier(event.request.method, 'unknown'),
      url: normalizeSentryRoute(event.request.url),
    };
  }
  if (event.transaction) event.transaction = normalizeSentryRoute(event.transaction);

  if (Array.isArray(event.spans)) {
    event.spans = event.spans.map((span) => {
      const clean = { ...span };
      const description = cleanSpanDescription(span);
      if (description) clean.description = description;
      else delete clean.description;
      const data = cleanSpanAttributes(span.data);
      if (data) clean.data = data;
      else delete clean.data;
      delete clean.tags;
      return clean;
    });
  }

  for (const exception of event.exception?.values || []) cleanException(exception);
  event.contexts = cleanContexts(event.contexts);
  event.breadcrumbs = Array.isArray(event.breadcrumbs)
    ? event.breadcrumbs.map(sanitizeSentryBreadcrumb).filter(Boolean)
    : [];
  event.user = cleanAnonymousUser(event.user);
  if (!event.user) delete event.user;
  delete event.extra;
  event.tags = cleanEventTags(event.tags);
  delete event.message;
  delete event.logentry;
  delete event.modules;
  delete event.server_name;
  return event;
}

export function createSentryOptions({
  dsn,
  environment,
  release,
  service,
  tracesSampleRate,
} = {}) {
  const normalizedDsn = String(dsn || '').trim();
  const normalizedService = safeTelemetryIdentifier(service, '');
  return {
    dsn: normalizedDsn || undefined,
    enabled: Boolean(normalizedDsn),
    environment: environment ? safeTelemetryIdentifier(environment) : undefined,
    release: release ? safeTelemetryIdentifier(release) : undefined,
    tracesSampleRate: parseSentrySampleRate(tracesSampleRate),
    sendDefaultPii: false,
    maxBreadcrumbs: 50,
    beforeBreadcrumb: sanitizeSentryBreadcrumb,
    beforeSend: sanitizeSentryEvent,
    beforeSendTransaction: sanitizeSentryEvent,
    ...(normalizedService ? { initialScope: { tags: { service: normalizedService } } } : {}),
  };
}
