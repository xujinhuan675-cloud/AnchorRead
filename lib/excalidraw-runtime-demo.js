import { STANDALONE_DIAGRAM_DOCUMENT_ID } from './diagram-generation.js';

const COLORS = {
  ink: '#24305e',
  muted: '#64748b',
  orange: '#d97706',
  laneStroke: ['#8b82b7', '#c89557', '#b4a243', '#c58c95', '#6f93b2', '#7e9b72'],
  laneFill: ['#f5f3ff', '#fff7ed', '#fefce8', '#fff1f2', '#eff6ff', '#f0fdf4'],
  headerFill: ['#ede9fe', '#ffedd5', '#fef9c3', '#ffe4e6', '#dbeafe', '#dcfce7'],
};

const LANE_WIDTH = 250;
const LANE_GAP = 18;
const LANE_TOP = 245;
const LANE_HEIGHT = 1210;
const LANE_X = [80, 348, 616, 884, 1152, 1420];

function text(id, value, x, y, options = {}) {
  return {
    id,
    type: 'text',
    x,
    y,
    text: value,
    fontSize: options.fontSize || 22,
    fontFamily: options.fontFamily || 1,
    textAlign: options.textAlign || 'left',
    verticalAlign: 'middle',
    strokeColor: options.strokeColor || COLORS.ink,
    backgroundColor: 'transparent',
    roughness: options.roughness ?? 1,
  };
}

function rectangle(id, x, y, width, height, options = {}) {
  const element = {
    id,
    type: 'rectangle',
    x,
    y,
    width,
    height,
    strokeColor: options.strokeColor || COLORS.ink,
    backgroundColor: options.backgroundColor || 'transparent',
    fillStyle: options.fillStyle || 'solid',
    strokeWidth: options.strokeWidth || 2,
    strokeStyle: options.strokeStyle || 'solid',
    roughness: options.roughness ?? 1,
    roundness: options.roundness === false ? null : { type: 3 },
    opacity: options.opacity ?? 100,
  };

  if (options.label) {
    element.label = {
      text: options.label,
      fontSize: options.fontSize || 20,
      fontFamily: 1,
      strokeColor: options.labelColor || COLORS.ink,
      textAlign: 'center',
      verticalAlign: 'middle',
    };
  }

  return element;
}

function arrow(id, points, options = {}) {
  const [origin, ...rest] = points;
  return {
    id,
    type: 'arrow',
    x: origin[0],
    y: origin[1],
    points: [[0, 0], ...rest.map(([x, y]) => [x - origin[0], y - origin[1]])],
    strokeColor: options.strokeColor || '#475569',
    strokeWidth: options.strokeWidth || 2,
    strokeStyle: options.strokeStyle || 'solid',
    roughness: options.roughness ?? 1,
    startArrowhead: null,
    endArrowhead: options.endArrowhead === false ? null : 'arrow',
  };
}

function step(id, number, lane, y, label, options = {}) {
  const x = LANE_X[lane] + 24;
  const width = options.width || 202;
  const height = options.height || 74;
  const badgeWidth = number >= 10 ? 44 : 35;
  const box = rectangle(`${id}-box`, x, y, width, height, {
    label,
    fontSize: options.fontSize || 19,
    strokeColor: options.strokeColor || COLORS.laneStroke[lane],
    backgroundColor: options.backgroundColor || '#ffffff',
    strokeWidth: 2,
    roughness: 1.15,
  });
  const badge = {
    id: `${id}-badge`,
    type: 'ellipse',
    x: x - (number >= 10 ? 18 : 13),
    y: y - 13,
    width: badgeWidth,
    height: 35,
    strokeColor: '#ffffff',
    backgroundColor: COLORS.orange,
    fillStyle: 'solid',
    strokeWidth: 2,
    roughness: 1,
    label: {
      text: String(number),
      fontSize: number >= 10 ? 12 : 17,
      fontFamily: 1,
      strokeColor: '#ffffff',
      textAlign: 'center',
      verticalAlign: 'middle',
    },
  };
  return [box, badge];
}

function serviceBox(id, lane, y, label, options = {}) {
  return rectangle(id, LANE_X[lane] + 24, y, 202, options.height || 68, {
    label,
    fontSize: options.fontSize || 18,
    strokeColor: COLORS.laneStroke[lane],
    backgroundColor: options.backgroundColor || '#ffffff',
    strokeStyle: options.strokeStyle || 'solid',
    roughness: 1.1,
  });
}

export function createRuntimeSwimlaneDemoElements() {
  const elements = [];
  const laneTitles = ['触发入口', 'Router 调度', 'Worker 执行', '大模型 LLM', 'MCP 连接层', '系统与工具'];

  elements.push(
    text('demo-title', '企业 Agent 运行时链路', 95, 105, { fontSize: 54, strokeColor: '#3046a4' }),
    text('demo-subtitle', '一次任务从触发到回写 · 20 步技术拆解', 420, 178, { fontSize: 28, strokeColor: '#78716c' }),
    rectangle('demo-border', 50, 28, 1650, 1950, {
      strokeColor: '#3046a4',
      strokeStyle: 'dashed',
      strokeWidth: 4,
      roundness: false,
      roughness: 1.4,
    })
  );

  laneTitles.forEach((titleValue, lane) => {
    const x = LANE_X[lane];
    elements.push(
      rectangle(`lane-${lane}`, x, LANE_TOP, LANE_WIDTH, LANE_HEIGHT, {
        strokeColor: COLORS.laneStroke[lane],
        backgroundColor: COLORS.laneFill[lane],
        opacity: 55,
        roundness: false,
        roughness: 0.8,
      }),
      rectangle(`lane-header-${lane}`, x, LANE_TOP, LANE_WIDTH, 72, {
        label: titleValue,
        fontSize: 24,
        strokeColor: COLORS.laneStroke[lane],
        backgroundColor: COLORS.headerFill[lane],
        roundness: false,
        roughness: 1.1,
      })
    );
  });

  const steps = [
    ['s1', 1, 0, 345, '接口 · 定时\n· 对话触发'],
    ['s2', 2, 1, 345, '解析意图\n与租户'],
    ['s3', 3, 1, 452, '加载人设\n与权限'],
    ['s4', 4, 1, 559, '分派 Worker'],
    ['s5', 5, 2, 559, '任务分解'],
    ['s6', 6, 2, 666, '技能选择'],
    ['s7', 7, 2, 773, '技能调用'],
    ['s8', 8, 3, 773, '理解指令\n与上下文'],
    ['s9', 9, 3, 880, '输出结构化\n响应'],
    ['s10', 10, 1, 880, '汇总子任务'],
    ['s11', 11, 2, 987, '处理返回结果'],
    ['s12', 12, 2, 1094, '决策下一步'],
    ['s13', 13, 2, 1201, '上下文续写'],
    ['s14', 14, 1, 1201, '调用企业知识'],
    ['s15', 15, 2, 1308, '生成中间结论'],
    ['s16', 16, 2, 1415, 'Judge 校验'],
    ['s17', 17, 1, 1522, '生成最终结果'],
    ['s18', 18, 3, 1522, '优化语言表达'],
    ['s19', 19, 1, 1629, '回写运行记录'],
    ['s20', 20, 0, 1629, '结果返回\n与留痕'],
  ];

  // Extend the two lower lanes below the main panels so the closing steps remain readable.
  elements.push(
    rectangle('closing-band-router', LANE_X[1], 1455, LANE_WIDTH, 252, {
      strokeColor: COLORS.laneStroke[1], backgroundColor: COLORS.laneFill[1], opacity: 55, roundness: false, roughness: 0.8,
    }),
    rectangle('closing-band-worker', LANE_X[2], 1455, LANE_WIDTH, 145, {
      strokeColor: COLORS.laneStroke[2], backgroundColor: COLORS.laneFill[2], opacity: 55, roundness: false, roughness: 0.8,
    }),
    rectangle('closing-band-llm', LANE_X[3], 1455, LANE_WIDTH, 145, {
      strokeColor: COLORS.laneStroke[3], backgroundColor: COLORS.laneFill[3], opacity: 55, roundness: false, roughness: 0.8,
    }),
    rectangle('closing-band-trigger', LANE_X[0], 1455, LANE_WIDTH, 252, {
      strokeColor: COLORS.laneStroke[0], backgroundColor: COLORS.laneFill[0], opacity: 55, roundness: false, roughness: 0.8,
    })
  );

  steps.forEach(([id, number, lane, y, label]) => elements.push(...step(id, number, lane, y, label)));

  elements.push(
    serviceBox('mcp-call', 4, 773, '调用 MCP 服务'),
    serviceBox('mcp-route', 4, 880, '路由到对应服务'),
    serviceBox('mcp-return', 4, 987, '返回服务结果'),
    serviceBox('tool-run', 5, 773, '执行工具操作'),
    serviceBox('tool-result', 5, 880, '获取工具结果'),
    serviceBox('tool-write', 5, 1629, '写入单据与通知')
  );

  const arrows = [
    ['a1', [[306, 382], [372, 382]]],
    ['a2', [[473, 419], [473, 452]]],
    ['a3', [[473, 526], [473, 559]]],
    ['a4', [[550, 596], [640, 596]]],
    ['a5', [[741, 633], [741, 666]]],
    ['a6', [[741, 740], [741, 773]]],
    ['a7-llm', [[818, 810], [908, 810]]],
    ['a8', [[1009, 847], [1009, 880]]],
    ['a9-return', [[985, 917], [850, 917], [850, 1024], [818, 1024]]],
    ['a7-mcp', [[818, 810], [1176, 810]]],
    ['a-mcp-tool', [[1378, 807], [1444, 807]]],
    ['a-tool-result', [[1545, 841], [1545, 880]]],
    ['a-tool-mcp', [[1444, 914], [1378, 914]]],
    ['a-mcp-route', [[1277, 948], [1277, 987]]],
    ['a-mcp-return', [[1176, 1021], [850, 1021], [850, 1024], [818, 1024]]],
    ['a7-aggregate', [[717, 847], [717, 865], [550, 865], [550, 917]]],
    ['a10', [[550, 917], [640, 917], [640, 1024]]],
    ['a11', [[741, 1061], [741, 1094]]],
    ['a12', [[741, 1168], [741, 1201]]],
    ['a13', [[741, 1275], [741, 1308]]],
    ['a14', [[550, 1238], [640, 1238], [640, 1345]]],
    ['a15', [[741, 1382], [741, 1415]]],
    ['a16-pass', [[717, 1489], [717, 1505], [550, 1505], [550, 1559]]],
    ['a16-retry', [[765, 1415], [850, 1415], [850, 703], [818, 703]], { strokeStyle: 'dashed' }],
    ['a17', [[550, 1559], [908, 1559]]],
    ['a18', [[985, 1596], [850, 1596], [850, 1666], [550, 1666]]],
    ['a19-tool', [[550, 1666], [1444, 1666]]],
    ['a19-return', [[372, 1666], [306, 1666]]],
  ];
  arrows.forEach(([id, points, options]) => elements.push(arrow(id, points, options)));

  elements.push(
    text('retry-label', '不通过 · 返回重试', 786, 1358, { fontSize: 15, strokeColor: '#9a3412' }),
    text('pass-label', '通过', 655, 1490, { fontSize: 15, strokeColor: '#166534' })
  );

  const memories = [
    ['四层企业记忆', '#ede9fe', '#6d5c9e'],
    ['会话记忆 Session', '#ffedd5', '#a16207'],
    ['长期记忆 Long-term', '#fef9c3', '#8a6d1d'],
    ['语义知识 Semantic', '#ffe4e6', '#9f5f69'],
    ['角色人设 Role', '#dcfce7', '#4d7c54'],
  ];
  memories.forEach(([label, fill, stroke], index) => {
    elements.push(rectangle(`memory-${index}`, 95 + (index * 320), 1745, 290, 64, {
      label, fontSize: 18, backgroundColor: fill, strokeColor: stroke, roughness: 1.1,
    }));
  });
  elements.push(text('demo-footer', 'Router 分派 · Worker 执行 · Judge 校验 · 全流程留痕', 420, 1840, {
    fontSize: 22, strokeColor: '#475569',
  }));

  // Leave a clear band below Excalidraw's floating toolbar so the canvas title
  // remains readable at fit-to-content zoom.
  elements.forEach((element) => {
    if (!['demo-title', 'demo-subtitle', 'demo-border'].includes(element.id)) {
      element.y += 70;
    }
  });

  return elements;
}

export const LOCAL_DEMO_DRAWING_ID = 'reader-drawing-reader-lab-standalone-diagrams-local-demo';

export function createLocalDemoDrawing(now = Date.now()) {
  const elements = createRuntimeSwimlaneDemoElements();
  const source = JSON.stringify(elements, null, 2);
  return {
    id: LOCAL_DEMO_DRAWING_ID,
    documentId: STANDALONE_DIAGRAM_DOCUMENT_ID,
    title: '企业 Agent 运行时链路 · 本地演示',
    engine: 'excalidraw',
    renderer: 'excalidraw',
    chartType: 'swimlane',
    scope: 'freeform',
    intent: 'swimlane',
    diagramSpec: null,
    source,
    variants: {
      excalidraw: { source, chartType: 'swimlane', updatedAt: now },
    },
    prompt: '企业 Agent 运行时链路本地演示',
    isLocalDemo: true,
    createdAt: now,
    updatedAt: now,
  };
}
