import assert from 'node:assert/strict';
import test from 'node:test';
import { withApiObservability } from '../lib/api-observability.js';

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
