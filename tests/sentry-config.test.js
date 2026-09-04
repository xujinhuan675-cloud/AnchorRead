import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createSentryOptions,
  normalizeSentryRoute,
  parseSentrySampleRate,
  safeTelemetryIdentifier,
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
    breadcrumbs: [{ message: 'clicked private heading' }],
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
  assert.deepEqual(event.breadcrumbs, []);
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
  assert.equal(options.maxBreadcrumbs, 0);
});
