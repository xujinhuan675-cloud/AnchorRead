// 流式绘制回放：移植自官方 excalidraw-mcp（MIT）的客户端播放核心。
// 官方的"流式"并非服务端推流，而是客户端对元素数组的渐进播放
//（部分 JSON 容错解析 + cameraUpdate 相机引导 + 逐元素显现）。
// 这里把它包装为 AnchorRead bridge 上的"流式重放"：把元素数组编译成
// 时间线并映射为 presentation 步骤，复用现有演示播放基础设施。

import { MAX_PRESENTATION_STEPS } from './diagram-presentation.js';

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
  if (frames.length <= maxFrames) return frames;
  // 帧数超过演示步骤上限时按组合并：每组取最后一帧（保留最新相机与累积可见集）
  const groupSize = Math.ceil(frames.length / maxFrames);
  const merged = [];
  for (let index = 0; index < frames.length; index += groupSize) {
    merged.push(frames[Math.min(index + groupSize, frames.length) - 1]);
  }
  return merged;
}

/** 时间线 → presentation spec：每步累积可见、可选高亮当前元素、携带相机 region。 */
export function timelineToPresentation(timeline, {
  durationMs = 500,
  title = '流式重放',
  highlight = false,
} = {}) {
  return {
    title,
    steps: (Array.isArray(timeline) ? timeline : []).map((frame, index) => ({
      id: `stream-${index + 1}`,
      durationMs,
      visibleElementIds: frame.visibleIds,
      highlightElementIds: highlight && frame.currentId ? [frame.currentId] : [],
      ...(frame.camera ? { camera: { region: frame.camera } } : {}),
  })),
};
}

/**
 * 为有内容的 Excalidraw 场景提供稳定的默认播放脚本。
 * MCP 创建和历史图解读取共用这条路径，避免播放能力依赖调用方额外传 stream 参数。
 */
export function createDefaultPresentation(elements, options = {}) {
  const timeline = buildStreamTimeline(elements, { maxFrames: MAX_PRESENTATION_STEPS });
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
    durationMs: 500,
    visibleElementIds: lines.slice(0, index + 1).map((_item, itemIndex) => `mermaid-${itemIndex + 1}`),
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
    && step.visibleElementIds.join(',') === Array.from({ length: index + 1 }, (_item, itemIndex) => `mermaid-${itemIndex + 1}`).join(',')
  ));
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
    const timeline = buildStreamTimeline(current);
    return timeline.length > 0 ? timelineToPresentation(timeline) : presentation;
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
      durationMs: 500,
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
