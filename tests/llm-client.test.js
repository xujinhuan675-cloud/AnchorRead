import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import {
  callLLM,
  extractResponseDelta,
  extractResponseText,
  processOpenAIStream,
} from '../lib/llm-client.js';

function bodyFromChunks(chunks) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  });
}

test('extracts complete text from Chat Completions and Responses JSON', () => {
  assert.equal(
    extractResponseText({ choices: [{ message: { content: 'chat answer' } }] }),
    'chat answer'
  );
  assert.equal(
    extractResponseText({
      output: [{ content: [{ type: 'output_text', text: 'response answer' }] }],
    }),
    'response answer'
  );
});

test('extracts text from array-based chat deltas', () => {
  assert.equal(
    extractResponseDelta({
      choices: [{ delta: { content: [{ type: 'text', text: 'array delta' }] } }],
    }),
    'array delta'
  );
});

test('collects Chat Completions SSE across arbitrary chunks', async () => {
  const chunks = [
    'data: {"choices":[{"delta":{"content":"hel',
    'lo"}}]}\n\ndata:{"choices":[{"delta":{"content":" world"}}]}',
  ];
  const emitted = [];
  const result = await processOpenAIStream(
    bodyFromChunks(chunks),
    (chunk) => emitted.push(chunk)
  );

  assert.equal(result, 'hello world');
  assert.deepEqual(emitted, ['hello', ' world']);
});

test('collects Responses API events without a trailing newline', async () => {
  const body = bodyFromChunks([
    'event: response.output_text.delta\n',
    'data:{"type":"response.output_text.delta","delta":"first"}\n\n',
    'data: {"type":"response.output_text.delta","delta":" second"}',
  ]);

  assert.equal(await processOpenAIStream(body), 'first second');
});

test('uses reasoning_content when a compatible model emits no content field', async () => {
  const body = bodyFromChunks([
    'data: {"choices":[{"delta":{"reasoning_content":"{\\"summary\\":"}}]}\n',
    'data: {"choices":[{"delta":{"reasoning_content":"\\"ok\\"}"}}]}\n',
    'data: [DONE]\n',
  ]);

  assert.equal(await processOpenAIStream(body), '{"summary":"ok"}');
});

test('collects NDJSON message chunks without data prefixes', async () => {
  const body = bodyFromChunks([
    '{"message":{"content":"first"},"done":false}\n',
    '{"message":{"content":" second"},"done":true}\n',
  ]);

  assert.equal(await processOpenAIStream(body), 'first second');
});

test('calls an OpenAI-compatible streaming endpoint end to end', async (context) => {
  const server = createServer(async (request, response) => {
    assert.equal(request.url, '/chat/completions');
    assert.equal(request.headers.authorization, 'Bearer test-key');
    let requestBody = '';
    for await (const chunk of request) requestBody += chunk;
    assert.equal(JSON.parse(requestBody).stream, true);

    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.write(
      'data: {"choices":[{"delta":{"reasoning_content":"{\\"summary\\":"}}]}\n\n'
    );
    response.end(
      'data: {"choices":[{"delta":{"reasoning_content":"\\"verified\\"}"}}]}\n\ndata: [DONE]\n\n'
    );
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));

  const address = server.address();
  const result = await callLLM(
    {
      type: 'openai',
      baseUrl: `http://127.0.0.1:${address.port}`,
      apiKey: 'test-key',
      model: 'gpt-5.6',
    },
    [{ role: 'user', content: 'Return JSON' }],
    () => {}
  );

  assert.equal(result, '{"summary":"verified"}');
});

test('falls back to a JSON response mislabeled as an event stream', async () => {
  const body = bodyFromChunks([
    '{"choices":[{"message":{"content":"json fallback"}}]}',
  ]);

  assert.equal(await processOpenAIStream(body), 'json fallback');
});

test('surfaces upstream errors instead of reporting empty content', async () => {
  const body = bodyFromChunks([
    'data: {"error":{"message":"model unavailable"}}\n\n',
  ]);

  await assert.rejects(
    () => processOpenAIStream(body),
    /OpenAI API error: model unavailable/
  );
});
