import assert from 'node:assert/strict';
import test from 'node:test';
import Sentry from '@sentry/nextjs';
import {
  getAnonymousTelemetryUserId,
  normalizeApiErrorStatus,
  withApiObservability,
} from '../lib/api-observability.js';
import { LLMProviderError } from '../lib/llm-client.js';

test('adds a correlation id to JSON error responses without changing successful responses', async () => {
  const handler = withApiObservability('test.operation', async () => (
    new Response(JSON.stringify({ error: 'bad request' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })
  ));

  const response = await handler(new Request('https://reader.example/api/test', { method: 'POST' }));
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(typeof body.errorId, 'string');
  assert.match(body.errorId, /^(?:[0-9a-f-]{36}|err-)/i);
  assert.equal(response.headers.get('x-anchorread-error-id'), body.errorId);
});

test('leaves successful response bodies untouched', async () => {
  const handler = withApiObservability('test.operation', async () => (
    Response.json({ ok: true })
  ));
  const response = await handler(new Request('https://reader.example/api/test'));
  assert.deepEqual(await response.json(), { ok: true });
});

test('captures provider failures with only a pseudonymous user id', async (context) => {
  assert.equal(normalizeApiErrorStatus(429), 429);
  assert.equal(normalizeApiErrorStatus(200), 500);
  assert.equal(normalizeApiErrorStatus(700), 500);

  const validId = 'ar-123e4567-e89b-42d3-a456-426614174000';
  const captured = [];
  let scopedUser;
  const originalWithScope = Sentry.withScope;
  const originalCaptureException = Sentry.captureException;
  Sentry.withScope = (callback) => callback({
    setTag: () => {},
    setContext: () => {},
    setUser: (user) => { scopedUser = user; },
  });
  Sentry.captureException = (error) => captured.push(error);
  context.after(() => {
    Sentry.withScope = originalWithScope;
    Sentry.captureException = originalCaptureException;
  });

  const handler = withApiObservability('test.llm', async () => {
    throw new LLMProviderError({
      provider: 'openai',
      model: 'gpt-test',
      status: 429,
      failureKind: 'quota',
      requestId: 'req-safe-123',
    });
  });
  const response = await handler(new Request('https://reader.example/api/test', {
    method: 'POST',
    headers: { 'x-anchorread-telemetry-user': validId },
  }));
  const body = await response.json();

  assert.equal(response.status, 429);
  assert.equal(body.error, 'LLM provider request failed (quota, HTTP 429)');
  assert.equal(body.code, 'llm_openai_quota');
  assert.equal(typeof body.errorId, 'string');
  assert.equal(captured.length, 1);
  assert.equal(captured[0].name, 'LLMProviderError');
  assert.deepEqual(scopedUser, { id: validId });
});

test('accepts only the pseudonymous telemetry user header', () => {
  const validId = 'ar-123e4567-e89b-42d3-a456-426614174000';
  assert.equal(getAnonymousTelemetryUserId(new Request('https://reader.example/api/test', {
    headers: { 'x-anchorread-telemetry-user': validId },
  })), validId);
  assert.equal(getAnonymousTelemetryUserId(new Request('https://reader.example/api/test', {
    headers: { 'x-anchorread-telemetry-user': 'reader@example.com' },
  })), undefined);
});
