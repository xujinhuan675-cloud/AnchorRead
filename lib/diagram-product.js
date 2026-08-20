export const DIAGRAM_SCOPES = Object.freeze({
  selection: 'selection',
  articleOverview: 'article-overview',
  articleDeep: 'article-deep',
  freeform: 'freeform',
});

export const DIAGRAM_RENDERERS = Object.freeze({
  mermaid: 'mermaid',
  excalidraw: 'excalidraw',
});

const VALID_SCOPES = new Set(Object.values(DIAGRAM_SCOPES));
const VALID_RENDERERS = new Set(Object.values(DIAGRAM_RENDERERS));
const VALID_INTENTS = new Set([
  'auto', 'flowchart', 'mindmap', 'orgchart', 'sequence', 'class', 'er', 'gantt',
  'timeline', 'tree', 'network', 'architecture', 'dataflow', 'state', 'swimlane',
  'concept', 'fishbone', 'swot', 'pyramid', 'funnel', 'venn', 'matrix', 'infographic',
]);

export function normalizeDiagramScope(scope) {
  return VALID_SCOPES.has(scope) ? scope : DIAGRAM_SCOPES.selection;
}

export function normalizeDiagramIntent(intent) {
  return VALID_INTENTS.has(intent) ? intent : 'auto';
}

export function normalizeDiagramRenderer(renderer) {
  return VALID_RENDERERS.has(renderer) ? renderer : DIAGRAM_RENDERERS.mermaid;
}

export function inferDiagramIntent(content = '') {
  const text = String(content).toLowerCase();
  if (/(泳道|部门|角色|职责|worker|router|agent|参与者)/iu.test(text)) return 'swimlane';
  if (/(架构|系统|服务|模块|组件|mcp|api|数据库)/iu.test(text)) return 'architecture';
  if (/(时间线|历程|阶段|年份|演进|里程碑)/iu.test(text)) return 'timeline';
  if (/(步骤|流程|决策|审批|执行|处理)/iu.test(text)) return 'flowchart';
  return 'concept';
}

export function recommendDiagramRenderer({ scope, intent = 'auto', nodeCount = 0 } = {}) {
  const normalizedScope = normalizeDiagramScope(scope);
  const normalizedIntent = normalizeDiagramIntent(intent);
  if (normalizedScope === DIAGRAM_SCOPES.articleDeep || normalizedScope === DIAGRAM_SCOPES.freeform) {
    return DIAGRAM_RENDERERS.excalidraw;
  }
  if (nodeCount > 12 || ['swimlane', 'infographic', 'architecture'].includes(normalizedIntent)) {
    return DIAGRAM_RENDERERS.excalidraw;
  }
  return DIAGRAM_RENDERERS.mermaid;
}

export function createDiagramGenerationPlan({ scope, content = '', intent = 'auto' } = {}) {
  const normalizedScope = normalizeDiagramScope(scope);
  const inferredIntent = normalizeDiagramIntent(intent) === 'auto'
    ? inferDiagramIntent(content)
    : normalizeDiagramIntent(intent);
  const renderer = recommendDiagramRenderer({ scope: normalizedScope, intent: inferredIntent });

  if (normalizedScope === DIAGRAM_SCOPES.articleDeep) {
    return {
      scope: normalizedScope,
      intent: inferredIntent,
      renderer,
      prompt: '请对全文进行深度图解：先提取角色、阶段、关键步骤、关系和例外路径，再按清晰的视觉分组与层级生成一张可编辑图解。控制单个节点文案长度，保留关键细节；由系统负责最终画布排版。',
    };
  }
  if (normalizedScope === DIAGRAM_SCOPES.articleOverview) {
    return {
      scope: normalizedScope,
      intent: inferredIntent,
      renderer: DIAGRAM_RENDERERS.mermaid,
      prompt: '请生成全文概览图：只保留文章主线、核心概念与关键结论，控制在 12 个核心节点以内，避免把段落逐句搬进图中。',
    };
  }
  return {
    scope: normalizedScope,
    intent: inferredIntent,
    renderer: DIAGRAM_RENDERERS.mermaid,
    prompt: '请围绕这段原文生成局部图解，只保留理解这段内容所需的核心概念与关系。',
  };
}

export function createDiagramMetadata({
  scope,
  intent,
  renderer,
  engine,
  diagramSpec = null,
} = {}) {
  const normalizedScope = normalizeDiagramScope(scope);
  const normalizedIntent = normalizeDiagramIntent(intent);
  const normalizedRenderer = normalizeDiagramRenderer(renderer || engine);
  return {
    scope: normalizedScope,
    intent: normalizedIntent,
    chartType: normalizedIntent,
    renderer: normalizedRenderer,
    engine: normalizedRenderer,
    diagramSpec,
  };
}

export function switchDiagramVariant({
  drawing,
  currentRenderer,
  currentSource = '',
  currentChartType = 'auto',
  nextRenderer,
  now = Date.now(),
} = {}) {
  const current = normalizeDiagramRenderer(currentRenderer || drawing?.engine);
  const next = normalizeDiagramRenderer(nextRenderer);
  const variants = {
    ...(drawing?.variants || {}),
    [current]: {
      source: currentSource,
      chartType: normalizeDiagramIntent(currentChartType),
      updatedAt: now,
    },
  };
  const target = variants[next];
  return {
    engine: next,
    renderer: next,
    source: target?.source || '',
    chartType: normalizeDiagramIntent(target?.chartType || drawing?.chartType),
    variants,
  };
}
