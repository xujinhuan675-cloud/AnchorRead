// 流式绘制回放：移植自官方 excalidraw-mcp（MIT）的客户端播放核心。
// 官方的"流式"并非服务端推流，而是客户端对元素数组的渐进播放
//（部分 JSON 容错解析 + cameraUpdate 相机引导 + 逐元素显现）。
// 这里把它包装为 AnchorRead bridge 上的"流式重放"：把元素数组编译成
// 时间线并映射为 presentation 步骤，复用现有演示播放基础设施。

import {
  DEFAULT_PRESENTATION_HOLD_MS,
  DEFAULT_PRESENTATION_REVEAL_MS,
  DEFAULT_PRESENTATION_STEP_DURATION_MS,
  DEFAULT_PRESENTATION_TRANSITION_MS,
  MAX_PRESENTATION_STEPS,
} from './diagram-presentation.js';

export const STREAM_PSEUDO_TYPES = new Set(['cameraUpdate', 'delete', 'restoreCheckpoint']);

/** 容错解析可能不完整的 JSON 元素数组（官方 mcp-app.tsx 同名函数移植）。 */
export function parsePartialElements(text) {
  const str = String(text ?? '').trim();
  if (!str.startsWith('[')) return [];
  try {
    return JSON.parse(str);
  } catch {
    // partial JSON：截断到最后一个完整对象再补 ] 重试
  }
  const last = str.lastIndexOf('}');
  if (last < 0) return [];
  try {
    return JSON.parse(`${str.slice(0, last + 1)}]`);
  } catch {
    // 仍不完整
  }
  return [];
}

/** 部分流场景下最后一个元素可能不完整，官方策略是直接丢弃（官方同名函数移植）。 */
export function excludeIncompleteLastItem(items) {
  if (!Array.isArray(items) || items.length <= 1) return [];
  return items.slice(0, -1);
}

/** 持久化前剥离伪元素（cameraUpdate/delete/restoreCheckpoint 不是合法 Excalidraw 类型）。 */
export function stripPseudoElements(elements) {
  return (Array.isArray(elements) ? elements : []).filter((element) => (
    element && typeof element === 'object' && !STREAM_PSEUDO_TYPES.has(element.type)
  ));
}

/**
 * 实时渐进渲染快照（官方 mcp-app.tsx doStream 组合移植）：
 * 剥代码围栏 → 容错解析部分 JSON → 丢弃可能不完整的末尾元素 → 剥离伪元素。
 * 返回当前可安全上画布的可绘制元素数组。
 */
export function parseStreamSnapshot(text) {
  const stripped = String(text ?? '').trim().replace(/^```(?:json|javascript|js)?\s*/iu, '');
  return stripPseudoElements(excludeIncompleteLastItem(parsePartialElements(stripped)));
}

function normalizeCameraRegion(element) {
  const width = Number(element.width);
  const height = Number(element.height);
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) return null;
  return {
    x: Number(element.x) || 0,
    y: Number(element.y) || 0,
    width,
    height,
  };
}

function limitTimelineFrames(frames, maxFrames) {
  if (frames.length <= maxFrames) return frames;
  // 帧数超过演示步骤上限时按组合并：每组取最后一帧（保留最新语义、相机与累积可见集）
  const groupSize = Math.ceil(frames.length / maxFrames);
  const merged = [];
  for (let index = 0; index < frames.length; index += groupSize) {
    merged.push(frames[Math.min(index + groupSize, frames.length) - 1]);
  }
  return merged;
}

function normalizedText(value) {
  return String(value ?? '').replace(/\s+/gu, ' ').trim().slice(0, 80);
}

function boundElementId(element, edge) {
  return normalizedText(
    element?.[`${edge}Binding`]?.elementId
    || element?.[edge]?.id
    || element?.[`${edge}ElementId`],
  );
}

function isConnector(element) {
  return element?.type === 'arrow' || element?.type === 'line';
}

function genericElementTitle(element) {
  switch (element?.type) {
    case 'diamond': return '判断节点';
    case 'ellipse': return '节点';
    case 'rectangle': return '节点';
    case 'text': return '说明';
    case 'image': return '图片';
    case 'frame': return '分组';
    case 'freedraw': return '绘制';
    case 'arrow':
    case 'line': return '建立连接';
    default: return '图解元素';
  }
}

function collectElementLabels(elements) {
  const labels = new Map();
  for (const element of Array.isArray(elements) ? elements : []) {
    if (!element || typeof element !== 'object') continue;
    const ownLabel = normalizedText(element.label?.text || element.text || element.originalText);
    if (element.id && ownLabel) labels.set(String(element.id), ownLabel);
    if (element.type === 'text' && element.containerId && ownLabel && !labels.has(String(element.containerId))) {
      labels.set(String(element.containerId), ownLabel);
    }
  }
  return labels;
}

function semanticElementTitle(element, elementsById, labels) {
  const ownLabel = labels.get(String(element?.id || '')) || '';
  if (!isConnector(element)) return ownLabel || genericElementTitle(element);
  const startId = boundElementId(element, 'start');
  const endId = boundElementId(element, 'end');
  const startLabel = labels.get(startId) || (elementsById.has(startId) ? genericElementTitle(elementsById.get(startId)) : '');
  const endLabel = labels.get(endId) || (elementsById.has(endId) ? genericElementTitle(elementsById.get(endId)) : '');
  if (startLabel && endLabel && ownLabel) return `${startLabel} —${ownLabel}→ ${endLabel}`;
  if (startLabel && endLabel) return `${startLabel} → ${endLabel}`;
  return ownLabel || genericElementTitle(element);
}

/**
 * 按官方"Drawing Order"语义把元素数组编译为流式时间线：
 * 数组顺序 = 出现顺序；cameraUpdate 更新当前相机；delete 从可见集合移除；
 * 每个独立可绘制元素产生一帧 { currentId, visibleIds（累积）, camera }。
 * 绑定文本随容器同帧显示，不单独占用播放步骤。
 */
export function buildStreamTimeline(elements, { maxFrames = MAX_PRESENTATION_STEPS } = {}) {
  const frames = [];
  const visible = [];
  const deleted = new Set();
  let camera = null;
  for (const element of Array.isArray(elements) ? elements : []) {
    if (!element || typeof element !== 'object') continue;
    if (element.type === 'cameraUpdate') {
      camera = normalizeCameraRegion(element);
      continue;
    }
    if (element.type === 'delete') {
      for (const id of String(element.ids ?? element.id ?? '').split(',')) {
        const trimmed = id.trim();
        if (trimmed) deleted.add(trimmed);
      }
      for (let index = visible.length - 1; index >= 0; index -= 1) {
        if (deleted.has(visible[index])) visible.splice(index, 1);
      }
      continue;
    }
    if (STREAM_PSEUDO_TYPES.has(element.type)) continue;
    if (element.isDeleted || (element.type === 'text' && element.containerId)) continue;
    const id = String(element.id ?? '').trim();
    if (!id || deleted.has(id)) continue;
    visible.push(id);
    frames.push({ currentId: id, visibleIds: [...visible], camera });
  }
  return limitTimelineFrames(frames, maxFrames);
}

/**
 * 为普通（非实时 stream）场景建立关系感知的默认播放时间线。
 * 有完整两端绑定的连线先确保起点和终点依次出现，再显示连线；未绑定连线仍保留数组顺序。
 * 每个元素仍只占一帧，绑定文字随其容器同帧显示。
 */
export function buildRelationshipPlaybackTimeline(elements, { maxFrames = MAX_PRESENTATION_STEPS } = {}) {
  const source = Array.isArray(elements) ? elements : [];
  const revealable = source.filter((element) => (
    element
    && typeof element === 'object'
    && !STREAM_PSEUDO_TYPES.has(element.type)
    && !element.isDeleted
    && !(element.type === 'text' && element.containerId)
    && normalizedText(element.id)
  ));
  const elementsById = new Map(revealable.map((element) => [String(element.id), element]));
  const labels = collectElementLabels(source);
  const visibleIds = [];
  const visible = new Set();
  const frames = [];

  const reveal = (element) => {
    const id = String(element?.id || '');
    if (!id || visible.has(id)) return;
    visible.add(id);
    visibleIds.push(id);
    frames.push({
      currentId: id,
      title: semanticElementTitle(element, elementsById, labels),
      visibleIds: [...visibleIds],
      camera: null,
    });
  };

  for (const element of revealable) {
    const startId = isConnector(element) ? boundElementId(element, 'start') : '';
    const endId = isConnector(element) ? boundElementId(element, 'end') : '';
    if (startId && endId && elementsById.has(startId) && elementsById.has(endId)) {
      reveal(elementsById.get(startId));
      reveal(elementsById.get(endId));
    }
    reveal(element);
  }
  return limitTimelineFrames(frames, maxFrames);
}

/** 时间线 → presentation spec：每步累积可见；默认保持全局视野，相机轨迹必须显式开启。 */
export function timelineToPresentation(timeline, {
  durationMs = DEFAULT_PRESENTATION_STEP_DURATION_MS,
  transitionMs = DEFAULT_PRESENTATION_TRANSITION_MS,
  revealMs = DEFAULT_PRESENTATION_REVEAL_MS,
  holdMs = DEFAULT_PRESENTATION_HOLD_MS,
  title = '流式重放',
  highlight = false,
  focus = false,
  includeCamera = false,
} = {}) {
  let previousCamera = '';
  return {
    title,
    steps: (Array.isArray(timeline) ? timeline : []).map((frame, index) => {
      const cameraKey = includeCamera && frame.camera ? JSON.stringify(frame.camera) : '';
      const cameraChanged = Boolean(cameraKey && cameraKey !== previousCamera);
      previousCamera = cameraKey;
      return {
        id: `stream-${index + 1}`,
        title: normalizedText(frame.title),
        durationMs,
        transitionMs,
        revealMs,
        holdMs,
        visibleElementIds: frame.visibleIds,
        focusElementIds: focus && frame.currentId ? [frame.currentId] : [],
        highlightElementIds: highlight && frame.currentId ? [frame.currentId] : [],
        ...(cameraChanged ? { camera: { region: frame.camera } } : {}),
      };
    }),
  };
}

/**
 * 为有内容的 Excalidraw 场景提供稳定的默认播放脚本。
 * MCP 创建和历史图解读取共用这条路径，避免播放能力依赖调用方额外传 stream 参数。
 */
export function createDefaultPresentation(elements, options = {}) {
  const timeline = buildRelationshipPlaybackTimeline(elements, { maxFrames: MAX_PRESENTATION_STEPS });
  return timeline.length > 0 ? timelineToPresentation(timeline, options) : null;
}

/**
 * Mermaid 没有可持久化的 Excalidraw element id，因此按有效 DSL 行生成
 * 同样的播放步数；画布侧再将步骤映射到已渲染的 SVG 图元。
 */
export function createDefaultMermaidPresentation(source, options = {}) {
  const lines = String(source || '')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('%%'));
  if (lines.length === 0) return null;
  const steps = lines.slice(0, MAX_PRESENTATION_STEPS).map((_line, index) => ({
    id: `mermaid-${index + 1}`,
    durationMs: options.durationMs ?? DEFAULT_PRESENTATION_STEP_DURATION_MS,
    transitionMs: options.transitionMs ?? DEFAULT_PRESENTATION_TRANSITION_MS,
    revealMs: options.revealMs ?? DEFAULT_PRESENTATION_REVEAL_MS,
    holdMs: options.holdMs ?? DEFAULT_PRESENTATION_HOLD_MS,
    visibleElementIds: lines.slice(0, index + 1).map((_item, itemIndex) => `mermaid-${itemIndex + 1}`),
    focusElementIds: [],
  }));
  return { title: '图解播放', ...options, steps };
}

/**
 * Identify the generated Mermaid script so a later source edit can rebuild it.
 * User-authored scripts may use arbitrary titles and step ids and are preserved.
 */
export function isDefaultMermaidPresentation(presentation) {
  if (!presentation || presentation.title !== '图解播放' || !Array.isArray(presentation.steps) || presentation.steps.length === 0) {
    return false;
  }
  return presentation.steps.every((step, index) => (
    step?.id === `mermaid-${index + 1}`
    && Array.isArray(step.visibleElementIds)
    && step.visibleElementIds.every((id) => /^mermaid-\d+$/u.test(String(id)))
  ));
}

export function isDefaultPresentation(presentation) {
  return Boolean(
    presentation
    && presentation.title === '流式重放'
    && Array.isArray(presentation.steps)
    && presentation.steps.length > 0
    && presentation.steps.every((step, index) => step?.id === `stream-${index + 1}`),
  );
}

/**
 * 播放脚本与当前画布对账：生成后再增删改元素会让存下的脚本失配。
 * - 脚本引用几乎全部失效（整体替换了新 JSON）：按当前元素重建流式重放；
 * - 有新增元素：原流程播完后按添加顺序逐个追加步骤（高亮标出新增），
 *   超出步数上限时折叠进最后一步；
 * - 其余情况原样保留（改内容/位置而 id 不变时播放自然体现新内容，相机编排不丢）。
 * 纯函数：不修改入参，返回新 spec。
 */
export function reconcilePresentationSpec(presentation, elements) {
  const current = Array.isArray(elements) ? elements : [];
  if (!presentation || !Array.isArray(presentation.steps) || presentation.steps.length === 0 || current.length === 0) {
    return presentation ?? null;
  }
  if (isDefaultPresentation(presentation)) {
    return createDefaultPresentation(current);
  }
  const referenced = new Set();
  for (const step of presentation.steps) {
    for (const id of step.visibleElementIds || []) referenced.add(id);
    for (const id of step.highlightElementIds || []) referenced.add(id);
  }
  // 无可见/高亮引用的脚本（如纯相机脚本）无法判断失配，原样保留
  if (referenced.size === 0) return presentation;
  const existingIds = new Set(current.map((element) => element?.id).filter(Boolean));
  const referencedExisting = [...referenced].filter((id) => existingIds.has(id)).length;
  if (referencedExisting / referenced.size < 0.5) {
    return createDefaultPresentation(current) || presentation;
  }
  const added = current.filter((element) => (
    element && element.id && !element.containerId && !element.isDeleted && !referenced.has(element.id)
  ));
  if (added.length === 0) return presentation;
  const lastVisible = presentation.steps[presentation.steps.length - 1].visibleElementIds || [];
  const budget = MAX_PRESENTATION_STEPS - presentation.steps.length;
  if (added.length <= budget) {
    // 原流程之后按添加顺序逐个显现：累积可见集 + 高亮当前新增元素
    const extraSteps = added.map((element, index) => ({
      id: `added-${index + 1}`,
      durationMs: DEFAULT_PRESENTATION_STEP_DURATION_MS,
      transitionMs: DEFAULT_PRESENTATION_TRANSITION_MS,
      revealMs: DEFAULT_PRESENTATION_REVEAL_MS,
      holdMs: DEFAULT_PRESENTATION_HOLD_MS,
      visibleElementIds: [...lastVisible, ...added.slice(0, index + 1).map((el) => el.id)],
      highlightElementIds: [element.id],
    }));
    return { ...presentation, steps: [...presentation.steps, ...extraSteps] };
  }
  // 新增过多会超步数上限：全部折叠进最后一步
  const steps = presentation.steps.map((step, index) => (
    index < presentation.steps.length - 1 ? step : {
      ...step,
      visibleElementIds: [...(step.visibleElementIds || []), ...added.map((element) => element.id)],
    }
  ));
  return { ...presentation, steps };
}
