import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createDiagramGenerationPlan,
  createDiagramMetadata,
  DIAGRAM_SCOPES,
  inferDiagramIntent,
  recommendDiagramRenderer,
  switchDiagramVariant,
} from '../lib/diagram-product.js';
import { generateImagePrompt } from '../lib/image-utils.js';

test('local and overview diagrams prefer Mermaid while deep diagrams use Excalidraw', () => {
  assert.equal(recommendDiagramRenderer({ scope: DIAGRAM_SCOPES.selection }), 'mermaid');
  assert.equal(recommendDiagramRenderer({ scope: DIAGRAM_SCOPES.articleOverview }), 'mermaid');
  assert.equal(recommendDiagramRenderer({ scope: DIAGRAM_SCOPES.articleDeep }), 'excalidraw');
});

test('content structure suggests a useful deep-diagram intent', () => {
  assert.equal(inferDiagramIntent('Router 分派 Worker，不同角色负责调用 MCP 工具'), 'swimlane');
  assert.equal(inferDiagramIntent('前端、API 服务和数据库组成系统架构'), 'architecture');
  assert.equal(inferDiagramIntent('第一阶段到第三阶段的演进历程'), 'timeline');
});

test('generation plans keep product scope separate from renderer details', () => {
  const overview = createDiagramGenerationPlan({ scope: DIAGRAM_SCOPES.articleOverview, content: '角色协作流程' });
  const deep = createDiagramGenerationPlan({ scope: DIAGRAM_SCOPES.articleDeep, content: '角色协作流程' });
  assert.equal(overview.renderer, 'mermaid');
  assert.match(overview.prompt, /12 个核心节点以内/);
  assert.equal(deep.renderer, 'excalidraw');
  assert.equal(deep.intent, 'swimlane');
  assert.match(deep.prompt, /例外路径/);
});

test('drawing metadata keeps compatibility fields and reserves the semantic spec', () => {
  assert.deepEqual(createDiagramMetadata({
    scope: DIAGRAM_SCOPES.articleDeep,
    intent: 'swimlane',
    renderer: 'excalidraw',
  }), {
    scope: 'article-deep',
    intent: 'swimlane',
    chartType: 'swimlane',
    renderer: 'excalidraw',
    engine: 'excalidraw',
    diagramSpec: null,
  });
});

test('renderer switching preserves the current source and restores an existing target variant', () => {
  const next = switchDiagramVariant({
    drawing: {
      chartType: 'flowchart',
      variants: {
        excalidraw: { source: '[{"type":"text","text":"deep"}]', chartType: 'swimlane' },
      },
    },
    currentRenderer: 'mermaid',
    currentSource: 'flowchart TD\nA-->B',
    currentChartType: 'flowchart',
    nextRenderer: 'excalidraw',
    now: 42,
  });

  assert.equal(next.source, '[{"type":"text","text":"deep"}]');
  assert.equal(next.chartType, 'swimlane');
  assert.equal(next.variants.mermaid.source, 'flowchart TD\nA-->B');
  assert.equal(next.variants.mermaid.updatedAt, 42);
});

test('image generation instructions follow the selected renderer', () => {
  assert.match(generateImagePrompt('flowchart', 'mermaid'), /Mermaid图表/);
  assert.doesNotMatch(generateImagePrompt('flowchart', 'mermaid'), /Excalidraw图表/);
  assert.match(generateImagePrompt('swimlane', 'excalidraw'), /Excalidraw图表/);
});
