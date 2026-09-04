const DEFAULT_TRACE_SAMPLE_RATE = 0.2;
const REDACTED_ERROR_MESSAGE = '[message redacted]';

const SAFE_SPAN_ATTRIBUTE_KEYS = new Set([
  'app.llm.first_chunk_ms',
  'app.llm.message_count',
  'app.llm.model',
  'app.llm.outcome',
  'app.llm.provider',
  'app.llm.streaming',
  'app.mcp.method',
  'app.mcp.outcome',
  'app.mcp.tool',
  'app.mcp.transport',
  'http.request.method',
  'http.response.status_code',
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
  if (op === 'ai.llm' || op === 'mcp.server') {
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

function cleanException(exception) {
  if (!exception || typeof exception !== 'object') return;
  exception.value = REDACTED_ERROR_MESSAGE;
  exception.type = safeTelemetryIdentifier(exception.type, 'Error');
  const frames = exception.stacktrace?.frames;
  if (!Array.isArray(frames)) return;
  for (const frame of frames) {
    if (!frame || typeof frame !== 'object') continue;
    frame.filename = cleanFilename(frame.filename);
    delete frame.abs_path;
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

function cleanContexts(contexts) {
  if (!contexts || typeof contexts !== 'object') return undefined;
  const clean = {};
  for (const key of ['browser', 'os', 'runtime']) {
    const context = pickRuntimeContext(contexts[key]);
    if (context) clean[key] = context;
  }
  if (contexts.trace && typeof contexts.trace === 'object') {
    const trace = {};
    for (const key of ['trace_id', 'span_id', 'parent_span_id', 'op', 'status', 'origin']) {
      if (contexts.trace[key] !== undefined) trace[key] = contexts.trace[key];
    }
    const data = cleanSpanAttributes(contexts.trace.data);
    if (data) trace.data = data;
    clean.trace = trace;
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
  event.breadcrumbs = [];
  delete event.user;
  delete event.extra;
  delete event.tags;
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
  tracesSampleRate,
} = {}) {
  const normalizedDsn = String(dsn || '').trim();
  return {
    dsn: normalizedDsn || undefined,
    enabled: Boolean(normalizedDsn),
    environment: environment ? safeTelemetryIdentifier(environment) : undefined,
    release: release ? safeTelemetryIdentifier(release) : undefined,
    tracesSampleRate: parseSentrySampleRate(tracesSampleRate),
    sendDefaultPii: false,
    maxBreadcrumbs: 0,
    beforeBreadcrumb: () => null,
    beforeSend: sanitizeSentryEvent,
    beforeSendTransaction: sanitizeSentryEvent,
  };
}
