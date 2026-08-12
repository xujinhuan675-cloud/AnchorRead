import assert from 'node:assert/strict';
import { createServer } from 'node:http';

const article = '本接口的核心约束是：同一个业务意图只能产生一笔支付结果。';
const modelResult = JSON.stringify({
  summary: '幂等设计避免重复支付。',
  highlights: [
    {
      text: '同一个业务意图只能产生一笔支付结果',
      level: 'core',
      reason: '这是接口最重要的业务约束。',
    },
  ],
});

const mockProvider = createServer(async (request, response) => {
  assert.ok(['/chat/completions', '/v1/chat/completions'].includes(request.url));

  if (request.url === '/chat/completions') {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end('<!doctype html><title>FlowGuide</title>');
    return;
  }

  assert.equal(request.headers.authorization, 'Bearer e2e-key');

  let requestBody = '';
  for await (const chunk of request) requestBody += chunk;
  assert.equal(JSON.parse(requestBody).stream, false);

  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(
    JSON.stringify({ choices: [{ message: { content: modelResult } }] })
  );
});

await new Promise((resolve) => mockProvider.listen(0, '127.0.0.1', resolve));

try {
  const address = mockProvider.address();
  const response = await fetch('http://localhost:3000/api/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      article,
      config: {
        type: 'openai',
        baseUrl: `http://127.0.0.1:${address.port}`,
        apiKey: 'e2e-key',
        model: 'gpt-5.6',
      },
    }),
  });

  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  assert.equal(result.summary, '幂等设计避免重复支付。');
  assert.equal(result.highlights.length, 1);
  assert.equal(result.highlights[0].level, 'core');
  console.log('POST /api/parse e2e passed:', JSON.stringify(result));
} finally {
  await new Promise((resolve) => mockProvider.close(resolve));
}
