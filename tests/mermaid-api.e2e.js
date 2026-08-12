import assert from 'node:assert/strict';
import { createServer } from 'node:http';

const mockProvider = createServer(async (request, response) => {
  let body = '';
  for await (const chunk of request) body += chunk;
  const payload = JSON.parse(body);
  assert.match(payload.messages[0].content, /只输出可由 Mermaid 11 渲染的 DSL/);
  assert.match(payload.messages[1].content, /流程图/);
  assert.doesNotMatch(payload.messages[0].content, /ExcalidrawElementSkeleton/);

  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({
    choices: [{ message: { content: 'flowchart LR\n  A --> B' } }],
  }));
});

await new Promise((resolve) => mockProvider.listen(0, '127.0.0.1', resolve));

try {
  const address = mockProvider.address();
  const response = await fetch('http://localhost:3000/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      engine: 'mermaid',
      chartType: 'flowchart',
      userInput: 'A calls B',
      config: {
        type: 'openai',
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        apiKey: 'e2e-key',
        model: 'test-model',
      },
    }),
  });

  const body = await response.text();
  assert.equal(response.status, 200, body);
  assert.match(body, /flowchart LR/);
  assert.match(body, /data: \[DONE\]/);
  console.log('POST /api/generate Mermaid e2e passed');
} finally {
  await new Promise((resolve) => mockProvider.close(resolve));
}
