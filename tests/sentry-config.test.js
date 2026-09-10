import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createSentryOptions,
  getOrCreateAnonymousTelemetryUserId,
  isSafeAnonymousTelemetryUserId,
  normalizeSentryRoute,
  parseSentrySampleRate,
  safeTelemetryIdentifier,
  sanitizeSentryBreadcrumb,
  sanitizeSentryEvent,
} from '../lib/sentry-config.js';

test('parses trace sample rates without accepting invalid values', () => {
  assert.equal(parseSentrySampleRate(undefined), 0.2);
  assert.equal(parseSentrySampleRate('0'), 0);
  assert.equal(parseSentrySampleRate('1'), 1);
  assert.equal(parseSentrySampleRate('0.35'), 0.35);
  assert.equal(parseSentrySampleRate('2'), 0.2);
  assert.equal(parseSentrySampleRate('not-a-number'), 0.2);
});

test('normalizes dynamic routes and removes URL query strings', () => {
  assert.equal(
    normalizeSentryRoute('GET https://reader.example/documents/private-id?token=secret'),
    'GET /documents/:documentId'
  );
  assert.equal(
    normalizeSentryRoute('/diagrams/a-drawing-id?document=private'),
    '/diagrams/:drawingId'
  );
});

test('rejects unsafe telemetry identifiers', () => {
  assert.equal(safeTelemetryIdentifier('gpt-5.2'), 'gpt-5.2');
  assert.equal(safeTelemetryIdentifier('anchor-read@0.1.0'), 'anchor-read@0.1.0');
  assert.equal(safeTelemetryIdentifier('private document text'), 'unknown');
});

test('removes content and credentials from Sentry events', () => {
  const event = sanitizeSentryEvent({
    message: 'private prompt',
    user: { email: 'reader@example.com' },
    extra: { response: 'private model response' },
    tags: { document: 'private-id' },
    server_name: 'reader-laptop',
    breadcrumbs: [
      { category: 'console', message: 'private prompt' },
      {
        category: 'navigation',
        data: {
          from: 'https://reader.example/documents/private-id?token=secret',
          to: 'https://reader.example/diagrams/private-id?token=secret',
        },
      },
    ],
    request: {
      method: 'POST',
      url: 'https://reader.example/documents/private-id?token=secret',
      headers: { authorization: 'Bearer secret', cookie: 'session=secret' },
      data: { prompt: 'private prompt' },
      query_string: 'token=secret',
      cookies: { session: 'secret' },
    },
    exception: {
      values: [{
        type: 'Error',
        value: 'provider returned private model response',
        stacktrace: { frames: [{
          filename: 'C:\\Users\\private-user\\AnchorRead\\lib\\llm-client.js',
          abs_path: 'C:\\Users\\private-user\\AnchorRead\\lib\\llm-client.js',
          context_line: 'throw new Error(privateResponse)',
          vars: { privateResponse: 'secret' },
        }] },
      }],
    },
    spans: [{
      op: 'http.client',
      description: 'GET https://api.example/diagrams/private-id?api_key=secret',
      data: {
        'http.request.method': 'GET',
        'http.response.status_code': 200,
        'http.request.body': 'private prompt',
        'url.full': 'https://api.example?token=secret',
      },
      tags: { secret: 'value' },
    }, {
      op: 'ui.action.click',
      description: 'button containing private document title',
      data: { 'ui.target': 'private-title' },
    }],
  });

  assert.deepEqual(event.request, { method: 'POST', url: '/documents/:documentId' });
  assert.equal(event.user, undefined);
  assert.equal(event.extra, undefined);
  assert.equal(event.tags, undefined);
  assert.equal(event.server_name, undefined);
  assert.deepEqual(event.breadcrumbs, [{
    category: 'navigation',
    data: {
      from: '/documents/:documentId',
      to: '/diagrams/:drawingId',
    },
  }]);
  assert.equal(event.exception.values[0].value, '[message redacted]');
  assert.equal(event.exception.values[0].stacktrace.frames[0].context_line, undefined);
  assert.doesNotMatch(event.exception.values[0].stacktrace.frames[0].filename, /private-user/);
  assert.equal(event.spans[0].description, 'GET /diagrams/:drawingId');
  assert.deepEqual(event.spans[0].data, {
    'http.request.method': 'GET',
    'http.response.status_code': 200,
  });
  assert.equal(event.spans[1].description, undefined);
  assert.equal(event.spans[1].data, undefined);
});

test('stays disabled when no DSN is configured', () => {
  const options = createSentryOptions({ tracesSampleRate: '0.5' });
  assert.equal(options.enabled, false);
  assert.equal(options.dsn, undefined);
  assert.equal(options.tracesSampleRate, 0.5);
  assert.equal(options.sendDefaultPii, false);
  assert.equal(options.maxBreadcrumbs, 50);
});

test('keeps only allowlisted breadcrumb structure', () => {
  assert.deepEqual(sanitizeSentryBreadcrumb({
    category: 'ai.llm',
    message: 'request_failed',
    data: {
      provider: 'openai',
      failure_kind: 'rate_limit',
      request_id: 'req-123',
      prompt: 'private prompt',
    },
  }), {
    category: 'ai.llm',
    message: 'request_failed',
    data: {
      provider: 'openai',
      failure_kind: 'rate_limit',
      request_id: 'req-123',
    },
  });
  assert.equal(sanitizeSentryBreadcrumb({ category: 'console', message: 'secret' }), null);
});

test('persists only a pseudonymous telemetry user id', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key),
    setItem: (key, value) => values.set(key, value),
  };
  const randomUUID = () => '123e4567-e89b-42d3-a456-426614174000';
  const id = getOrCreateAnonymousTelemetryUserId({ storage, randomUUID });
  assert.equal(id, 'ar-123e4567-e89b-42d3-a456-426614174000');
  assert.equal(getOrCreateAnonymousTelemetryUserId({ storage, randomUUID }), id);
  assert.equal(isSafeAnonymousTelemetryUserId(id), true);

  const event = sanitizeSentryEvent({
    user: { id, email: 'reader@example.com', ip_address: '127.0.0.1' },
  });
  assert.deepEqual(event.user, { id });
});

test('disables anonymous user telemetry when browser storage is inaccessible', () => {
  const options = {};
  Object.defineProperty(options, 'storage', {
    get() {
      throw new DOMException('Storage blocked', 'SecurityError');
    },
  });
  assert.equal(getOrCreateAnonymousTelemetryUserId(options), undefined);
});

test('preserves safe diagnostic exception messages and service tags', () => {
  const event = sanitizeSentryEvent({
    tags: { service: 'anchorread-web', private_prompt: 'secret' },
    exception: { values: [{
      type: 'DataCloneError',
      value: "Failed to execute 'structuredClone': Symbol(react.transitional.element) could not be cloned",
    }] },
  });
  assert.deepEqual(event.tags, { service: 'anchorread-web' });
  assert.equal(
    event.exception.values[0].value,
    'structuredClone rejected a React element in transient UI state'
  );

  const options = createSentryOptions({ dsn: 'https://public@example.invalid/1', service: 'anchorread-api' });
  assert.deepEqual(options.initialScope, { tags: { service: 'anchorread-api' } });
});

test('retains public static asset paths needed for source map matching', () => {
  const event = sanitizeSentryEvent({
    exception: { values: [{
      type: 'TypeError',
      value: 'private detail',
      stacktrace: { frames: [{
        filename: 'https://anchorread.flowguide.cc/_next/static/chunks/app.js?token=secret',
        abs_path: 'https://anchorread.flowguide.cc/_next/static/chunks/app.js?token=secret',
      }] },
    }] },
  });
  assert.deepEqual(event.exception.values[0].stacktrace.frames[0], {
    filename: 'https://anchorread.flowguide.cc/_next/static/chunks/app.js',
    abs_path: 'https://anchorread.flowguide.cc/_next/static/chunks/app.js',
  });
});

test('keeps only safe correlation tags and API context', () => {
  const event = sanitizeSentryEvent({
    tags: {
      error_id: 'err-123',
      operation: 'ai.parse',
      api_route: 'POST https://reader.example/diagrams/private-id?token=secret',
      private_prompt: 'should-not-be-kept',
    },
    contexts: {
      api: {
        error_id: 'err-123',
        operation: 'ai.parse',
        route: 'POST /diagrams/private-id?token=secret',
        status: 502,
        private_prompt: 'should-not-be-kept',
      },
    },
  });

  assert.deepEqual(event.tags, {
    error_id: 'err-123',
    operation: 'ai.parse',
    api_route: 'POST /diagrams/:drawingId',
  });
  assert.deepEqual(event.contexts.api, {
    error_id: 'err-123',
    operation: 'ai.parse',
    route: 'POST /diagrams/:drawingId',
    status: 502,
  });
});
