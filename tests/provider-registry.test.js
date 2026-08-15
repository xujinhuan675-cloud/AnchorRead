import assert from 'node:assert/strict';
import test from 'node:test';
import {
  callLLM,
  fetchModels,
  listLLMProviderTypes,
  registerLLMProvider,
} from '../lib/llm-client.js';
import { resolveTaskConfig, TASK_MODEL_KEYS } from '../lib/task-routing.js';

test('built-in providers are registered in the registry', () => {
  const types = listLLMProviderTypes();
  for (const type of ['openai', 'anthropic', 'ollama']) {
    assert.ok(types.includes(type), `missing provider: ${type}`);
  }
});

test('callLLM dispatches through the registry and rejects unknown providers', async () => {
  await assert.rejects(
    () => callLLM({ type: 'nope', baseUrl: 'x', apiKey: 'y', model: 'z' }, []),
    /Unsupported provider type/
  );
});

test('third-party adapters can be registered and take precedence', async () => {
  registerLLMProvider('demo', {
    call: async (baseUrl, apiKey, model, messages) => `demo:${model}:${messages.length}`,
    fetchModels: async () => [{ id: 'demo-model', name: 'Demo' }],
  });

  const text = await callLLM(
    { type: 'demo', baseUrl: 'http://demo', apiKey: 'k', model: 'm' },
    [{ role: 'user', content: 'hi' }]
  );
  assert.equal(text, 'demo:m:1');

  const models = await fetchModels('demo', 'http://demo', 'k');
  assert.equal(models[0].id, 'demo-model');
});

test('registerLLMProvider validates adapter shape', () => {
  assert.throws(() => registerLLMProvider('', { call: async () => '' }), /类型标识/);
  assert.throws(() => registerLLMProvider('x', {}), /call/);
});

test('resolveTaskConfig overrides model by string', () => {
  const base = { type: 'openai', model: 'strong', taskModels: { parse: 'cheap' } };
  const resolved = resolveTaskConfig(base, 'parse');
  assert.equal(resolved.model, 'cheap');
  assert.equal(resolved.type, 'openai');
  // 未声明的任务保持原配置
  assert.equal(resolveTaskConfig(base, 'explain').model, 'strong');
});

test('resolveTaskConfig overrides provider by object and strips taskModels', () => {
  const base = {
    type: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'k',
    model: 'gpt-x',
    taskModels: { flashcards: { type: 'ollama', model: 'llama3.1' } },
  };
  const resolved = resolveTaskConfig(base, 'flashcards');
  assert.equal(resolved.type, 'ollama');
  assert.equal(resolved.model, 'llama3.1');
  assert.equal(resolved.apiKey, 'k');
  assert.equal('taskModels' in resolved, false);
});

test('task model keys cover all api tasks', () => {
  assert.deepEqual(
    [...TASK_MODEL_KEYS],
    ['parse', 'explain', 'concepts', 'flashcards', 'analysis', 'action']
  );
});
