import assert from 'node:assert/strict';
import { createServer } from 'node:http';

const article = [
  'Idempotency prevents duplicate side effects.',
  'When a payment request is retried, one charge is created.',
].join(' ');
const selectedText = 'one charge is created';
const modelResult = JSON.stringify({
  plainExplanation: 'Retrying the same payment does not create another charge.',
  terms: [
    {
      source: 'Idempotency',
      explanation: 'Repeated requests leave the final payment result unchanged.',
    },
    {
      source: 'invented term',
      explanation: 'This term is not grounded in the article.',
    },
  ],
  context: 'The sentence gives the concrete payment outcome of idempotency.',
});

const mockProvider = createServer(async (request, response) => {
  assert.ok(['/chat/completions', '/v1/chat/completions'].includes(request.url));
  assert.equal(request.headers.authorization, 'Bearer e2e-key');

  let requestBody = '';
  for await (const chunk of request) requestBody += chunk;
  const payload = JSON.parse(requestBody);
  assert.equal(payload.stream, false);
  assert.match(payload.messages[0].content, new RegExp(article));
  assert.match(payload.messages[0].content, new RegExp(selectedText));

  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(
    JSON.stringify({ choices: [{ message: { content: modelResult } }] })
  );
});

await new Promise((resolve) => mockProvider.listen(0, '127.0.0.1', resolve));

try {
  const address = mockProvider.address();
  const response = await fetch('http://localhost:3000/api/explain', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      article,
      selectedText,
      config: {
        type: 'openai',
        baseUrl: `http://127.0.0.1:${address.port}`,
        apiKey: 'e2e-key',
        model: 'test-model',
      },
    }),
  });

  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  assert.equal(
    result.plainExplanation,
    'Retrying the same payment does not create another charge.'
  );
  assert.deepEqual(result.terms, [
    {
      source: 'Idempotency',
      explanation: 'Repeated requests leave the final payment result unchanged.',
    },
  ]);
  assert.equal(
    result.context,
    'The sentence gives the concrete payment outcome of idempotency.'
  );
  console.log('POST /api/explain e2e passed:', JSON.stringify(result));
} finally {
  await new Promise((resolve) => mockProvider.close(resolve));
}
