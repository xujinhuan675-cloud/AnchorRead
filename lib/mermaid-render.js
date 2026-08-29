export const MERMAID_MAX_SOURCE_LENGTH = 50_000;
export const MERMAID_ZOOM = Object.freeze({
  min: 0.1,
  max: 2.5,
  step: 0.25,
  initial: 1,
});

const BLOCKED_SVG_ELEMENTS =
  'script, foreignObject, iframe, object, embed, image, audio, video, canvas, link, meta, base, animate, animateMotion, animateTransform, set, discard';
const URL_ATTRIBUTE_NAMES = new Set(['href', 'xlink:href', 'src']);
const UNSAFE_CSS_PATTERN = /(?:@import|expression\s*\(|javascript\s*:|vbscript\s*:|behavior\s*:|-moz-binding\s*:)/i;
const CSS_URL_PATTERN = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;

export function createStrictMermaidConfig() {
  return {
    startOnLoad: false,
    securityLevel: 'strict',
    suppressErrorRendering: true,
    maxTextSize: MERMAID_MAX_SOURCE_LENGTH,
    theme: 'neutral',
    fontFamily: 'Arial, Helvetica, sans-serif',
    // Mermaid 11 reads this top-level option first. Keeping only the legacy
    // flowchart option can still produce foreignObject labels, which our SVG
    // sanitizer intentionally removes.
    htmlLabels: false,
    secure: [
      'securityLevel',
      'startOnLoad',
      'suppressErrorRendering',
      'maxTextSize',
      'htmlLabels',
      'secure',
      'themeCSS',
      'fontFamily',
    ],
    flowchart: {
      useMaxWidth: true,
    },
  };
}

export function normalizeMermaidSource(value) {
  const source = typeof value === 'string' ? value.trim() : '';
  if (!source.startsWith('```')) return source;

  return source
    .replace(/^```(?:mermaid)?[ \t]*\r?\n?/i, '')
    .replace(/\r?\n?```[ \t]*$/, '')
    .trim();
}

export function validateMermaidSource(value) {
  const source = normalizeMermaidSource(value);
  if (!source) return { source: '', error: '' };
  if (source.length > MERMAID_MAX_SOURCE_LENGTH) {
    return {
      source,
      error: `Mermaid 源码不能超过 ${MERMAID_MAX_SOURCE_LENGTH.toLocaleString('en-US')} 个字符。`,
    };
  }
  return { source, error: '' };
}

export function clampMermaidZoom(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return MERMAID_ZOOM.initial;
  return Math.min(
    MERMAID_ZOOM.max,
    Math.max(MERMAID_ZOOM.min, Number(numericValue.toFixed(2)))
  );
}

export function stepMermaidZoom(current, direction) {
  const delta = direction < 0 ? -MERMAID_ZOOM.step : MERMAID_ZOOM.step;
  return clampMermaidZoom(Number(current) + delta);
}

export function createMermaidRenderState() {
  return {
    status: 'idle',
    error: '',
    hasValidSvg: false,
    renderedSource: '',
  };
}

export function mermaidRenderReducer(state, action) {
  switch (action.type) {
    case 'empty':
      return createMermaidRenderState();
    case 'start':
      return { ...state, status: 'rendering', error: '' };
    case 'success':
      return {
        status: 'ready',
        error: '',
        hasValidSvg: true,
        renderedSource: action.source,
      };
    case 'failure':
      return {
        ...state,
        status: 'error',
        error: formatMermaidError(action.error),
      };
    default:
      return state;
  }
}

export function formatMermaidError(error) {
  const rawMessage =
    typeof error === 'string' ? error : error?.message || 'Mermaid 图表渲染失败。';
  const message = rawMessage.replace(/\s+/g, ' ').trim();
  return message.length > 400 ? `${message.slice(0, 397)}...` : message;
}

export function isSafeSvgReference(value) {
  const reference = String(value || '').trim();
  return reference === '' || /^#[A-Za-z_][\w:.-]*$/.test(reference);
}

export function hasUnsafeSvgCss(value) {
  const css = String(value || '');
  if (UNSAFE_CSS_PATTERN.test(css)) return true;

  CSS_URL_PATTERN.lastIndex = 0;
  let match = CSS_URL_PATTERN.exec(css);
  while (match) {
    if (!isSafeSvgReference(match[2])) return true;
    match = CSS_URL_PATTERN.exec(css);
  }
  return false;
}

export function isBlockedSvgElement(value) {
  return new Set(BLOCKED_SVG_ELEMENTS.split(',').map((name) => name.trim().toLowerCase())).has(
    String(value || '').toLowerCase()
  );
}

export function sanitizeMermaidSvg(svgText, DOMParserClass = globalThis.DOMParser) {
  if (typeof DOMParserClass !== 'function') {
    throw new Error('当前环境不支持安全解析 Mermaid SVG。');
  }

  const parsed = new DOMParserClass().parseFromString(svgText, 'image/svg+xml');
  if (parsed.querySelector('parsererror')) {
    throw new Error('Mermaid SVG 解析失败。');
  }

  const svg = parsed.documentElement;
  if (svg?.localName?.toLowerCase() !== 'svg') {
    throw new Error('Mermaid 输出的不是有效 SVG。');
  }

  svg.querySelectorAll(BLOCKED_SVG_ELEMENTS).forEach((node) => node.remove());

  [svg, ...svg.querySelectorAll('*')].forEach((node) => {
    if (node.localName?.toLowerCase() === 'style' && hasUnsafeSvgCss(node.textContent)) {
      node.remove();
      return;
    }

    [...node.attributes].forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      const containsUnsafeCss =
        name === 'style' || value.toLowerCase().includes('url(')
          ? hasUnsafeSvgCss(value)
          : false;

      if (
        name.startsWith('on') ||
        name === 'target' ||
        (URL_ATTRIBUTE_NAMES.has(name) && !isSafeSvgReference(value)) ||
        containsUnsafeCss
      ) {
        node.removeAttribute(attribute.name);
      }
    });
  });

  return svg;
}
