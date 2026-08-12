/**
 * 概念图构建器
 * 将 AI 抽取的概念与关系转换为 ExcalidrawElementSkeleton 数组
 * 产物可直接交给 ExcalidrawCanvas（convertToExcalidrawElements）渲染
 */

// 节点配色池（填充色 + 描边色），中心概念固定使用第一组
const NODE_PALETTE = [
  { bg: '#d0ebff', stroke: '#1971c2' },
  { bg: '#d3f9d8', stroke: '#2f9e44' },
  { bg: '#fff3bf', stroke: '#f08c00' },
  { bg: '#ffe3e3', stroke: '#e03131' },
  { bg: '#e5dbff', stroke: '#6741d9' },
  { bg: '#c3fae8', stroke: '#0ca678' },
];

const NODE_HEIGHT = 90;
const FONT_SIZE = 20;
const TITLE = '概念关系图';

/** 估算文本渲染宽度（中文按全角计） */
function estimateWidth(text) {
  let width = 0;
  for (const ch of text) {
    width += /[\u2e80-\u9fff\uff00-\uffef]/.test(ch) ? FONT_SIZE : FONT_SIZE * 0.55;
  }
  return Math.ceil(width);
}

/**
 * 生成概念图的 Excalidraw 元素骨架
 * 布局：首个概念居中，其余概念均匀分布在外圈
 * @param {Array<{name, description}>} concepts - 概念列表
 * @param {Array<{from, to, type, label}>} relations - 关系列表
 * @param {string} articleTitle - 文章标题，用于图题
 * @returns {Array} ExcalidrawElementSkeleton 数组
 */
export function buildConceptGraph(concepts, relations, articleTitle = '') {
  if (!Array.isArray(concepts) || concepts.length === 0) return [];

  const elements = [];

  // 图题
  elements.push({
    id: 'concept-graph-title',
    type: 'text',
    x: -estimateWidth(articleTitle ? `${TITLE}：${articleTitle}` : TITLE) / 2,
    y: -950,
    text: articleTitle ? `${TITLE}：${articleTitle}` : TITLE,
    fontSize: 28,
    textAlign: 'center',
  });

  // 计算每个节点的尺寸与位置
  const nodes = new Map();
  const radius = 420 + concepts.length * 18;

  concepts.forEach((concept, index) => {
    const textWidth = estimateWidth(concept.name);
    const width = Math.max(180, textWidth + 64);
    let x;
    let y;

    if (index === 0) {
      // 中心概念
      x = -width / 2;
      y = -NODE_HEIGHT / 2;
    } else {
      // 外圈均匀分布，从正上方开始顺时针排布
      const angle = ((index - 1) / (concepts.length - 1)) * Math.PI * 2 - Math.PI / 2;
      x = Math.cos(angle) * radius - width / 2;
      y = Math.sin(angle) * radius - NODE_HEIGHT / 2;
    }

    const palette = NODE_PALETTE[index % NODE_PALETTE.length];
    const id = `concept-node-${index}`;
    nodes.set(concept.name, { id, index, centerX: x + width / 2, centerY: y + NODE_HEIGHT / 2 });

    elements.push({
      id,
      type: 'ellipse',
      x,
      y,
      width,
      height: NODE_HEIGHT,
      backgroundColor: index === 0 ? NODE_PALETTE[0].bg : palette.bg,
      strokeColor: index === 0 ? NODE_PALETTE[0].stroke : palette.stroke,
      strokeWidth: index === 0 ? 2 : 1,
      label: { text: concept.name },
    });

    // 概念释义作为节点下方的小字说明
    if (concept.description) {
      elements.push({
        id: `concept-desc-${index}`,
        type: 'text',
        x: x + width / 2 - estimateWidth(concept.description) / 2,
        y: y + NODE_HEIGHT + 8,
        text: concept.description,
        fontSize: 14,
        strokeColor: '#868e96',
        textAlign: 'center',
      });
    }
  });

  // 关系连线（绑定到两端节点，转换时自动计算锚点）
  (relations || []).forEach((relation, index) => {
    const from = nodes.get(relation.from);
    const to = nodes.get(relation.to);
    if (!from || !to) return;

    elements.push({
      id: `concept-arrow-${index}`,
      type: 'arrow',
      x: from.centerX,
      y: from.centerY,
      width: to.centerX - from.centerX,
      height: to.centerY - from.centerY,
      points: [[0, 0], [to.centerX - from.centerX, to.centerY - from.centerY]],
      start: { id: from.id },
      end: { id: to.id },
      strokeColor: '#495057',
      label: relation.label ? { text: relation.label } : undefined,
    });
  });

  return elements;
}
