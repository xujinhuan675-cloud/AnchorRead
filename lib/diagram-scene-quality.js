const CONNECTOR_TYPES = new Set(['arrow', 'line']);
const LABELLED_SHAPE_TYPES = new Set(['rectangle', 'ellipse', 'diamond', 'frame']);
const PSEUDO_ELEMENT_TYPES = new Set(['cameraUpdate', 'delete', 'restoreCheckpoint']);
const DEFAULT_MIN_SHAPE_WIDTH = 120;
const DEFAULT_MIN_SHAPE_HEIGHT = 60;

function asFiniteNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}
function elementText(element) {
  const values = [element?.text, element?.originalText, element?.label?.text];
  return values.find((value) => typeof value === 'string' && value.trim())?.trim() || '';
}

function endpointId(element, edge) {
  const binding = element?.[`${edge}Binding`]?.elementId;
  const shorthand = element?.[`${edge}ElementId`];
  const legacy = element?.[edge]?.id;
  const value = binding ?? shorthand ?? legacy;
  return value === undefined || value === null || String(value).trim() === ''
    ? ''
    : String(value);
}

function issue(code, message, elementIds = [], severity = 'warning') {
  return {
    code,
    severity,
    message,
    ...(elementIds.length > 0 ? { elementIds } : {}),
  };
}

function suggestionFor(code) {
  const suggestions = {
    VISUAL_STYLE_MISSING: 'Use 3-4 semantic colors, light solid fills, dark strokes, consistent rounded cards, and zones or titles for hierarchy.',
    DUPLICATE_ELEMENT_ID: '为每个元素分配唯一且稳定的 id，然后重新提交场景。',
    MISSING_ELEMENT_ID: '为需要后续编辑或连接的元素补充稳定 id。',
    UNBOUND_CONNECTOR: '为关系线补充 startElementId/endElementId 或原生 startBinding/endBinding。',
    CONNECTOR_ENDPOINT_NOT_FOUND: '检查连接线两端的元素 id 是否仍存在。',
    LABELLED_SHAPE_TOO_SMALL: '增大带文字节点，优先使用至少 120x60 的尺寸。',
    LABEL_TRUNCATION_RISK: '增大节点宽度或缩短标签，确保文字有足够的绘制空间。',
    CAMERA_ASPECT_RATIO: '将 cameraUpdate 调整为接近 4:3 的比例。',
  };
  return suggestions[code] || '';
}

/**
 * Run deterministic, renderer-independent checks before or after a diagram
 * write. This is deliberately advisory for layout quality, while malformed
 * identity data (duplicate ids) is reported as a blocking error.
 */
export function preflightDiagramScene(scene, {
  minShapeWidth = DEFAULT_MIN_SHAPE_WIDTH,
  minShapeHeight = DEFAULT_MIN_SHAPE_HEIGHT,
  minLabelWidth = 160,
  characterWidth = 12,
} = {}) {
  const elements = Array.isArray(scene) ? scene : scene?.elements;
  if (!Array.isArray(elements)) {
    return {
      status: 'fail',
      ok: false,
      errors: [issue('SCENE_ELEMENTS_MISSING', 'Scene must contain an elements array.', [], 'error')],
      warnings: [],
      repairSuggestions: [],
      summary: { elementCount: 0, visibleElementCount: 0, connectorCount: 0 },
    };
  }

  const errors = [];
  const warnings = [];
  const suggestions = new Set();
  const ids = new Map();
  const visible = elements.filter((element) => element && element.isDeleted !== true);
  const visibleIds = new Set();

  const labelledShapes = visible.filter((element) => (
    ['rectangle', 'ellipse', 'diamond'].includes(element?.type)
    && elementText(element)
  ));
  if (labelledShapes.length >= 3) {
    const palette = new Set(
      labelledShapes
        .map((element) => String(element?.backgroundColor || '').trim().toLowerCase())
        .filter((color) => color && color !== 'transparent' && color !== '#ffffff' && color !== '#fff'),
    );
    const roundedCount = labelledShapes.filter((element) => element?.roundness).length;
    // Only flag the unmistakable default-white/unstyled case. A user may
    // intentionally request a monochrome or non-card visual treatment.
    if (palette.size === 0 && roundedCount < labelledShapes.length) {
      const found = issue(
        'VISUAL_STYLE_MISSING',
        'Diagram has multiple labelled shapes but lacks the default visual system: semantic fills, consistent rounded cards, and clear hierarchy.',
        labelledShapes.map((element) => String(element.id || '')).filter(Boolean),
      );
      warnings.push(found);
      suggestions.add(suggestionFor(found.code));
    }
  }

  for (const element of elements) {
    const id = element?.id === undefined || element?.id === null ? '' : String(element.id).trim();
    if (!id) {
      if (PSEUDO_ELEMENT_TYPES.has(element?.type)) continue;
      const found = issue('MISSING_ELEMENT_ID', 'Element is missing a stable id.', [], 'warning');
      warnings.push(found);
      suggestions.add(suggestionFor(found.code));
      continue;
    }
    if (ids.has(id)) {
      const elementIds = [ids.get(id), id];
      const found = issue('DUPLICATE_ELEMENT_ID', `Element id "${id}" is used more than once.`, elementIds, 'error');
      errors.push(found);
      suggestions.add(suggestionFor(found.code));
    } else {
      ids.set(id, id);
      if (element?.isDeleted !== true) visibleIds.add(id);
    }
  }

  for (const element of visible) {
    const id = element?.id === undefined || element?.id === null ? '' : String(element.id);
    const text = elementText(element);
    if (LABELLED_SHAPE_TYPES.has(element?.type) && text) {
      const width = Math.abs(asFiniteNumber(element.width));
      const height = Math.abs(asFiniteNumber(element.height));
      if (width < minShapeWidth || height < minShapeHeight) {
        const found = issue(
          'LABELLED_SHAPE_TOO_SMALL',
          `Labelled ${element.type} ${id || '(unidentified)'} is ${Math.round(width)}x${Math.round(height)}; use at least ${minShapeWidth}x${minShapeHeight}.`,
          id ? [id] : [],
        );
        warnings.push(found);
        suggestions.add(suggestionFor(found.code));
      }
      const expectedWidth = Math.max(minLabelWidth, text.length * characterWidth);
      if (width > 0 && width < expectedWidth) {
        const found = issue(
          'LABEL_TRUNCATION_RISK',
          `Label on ${id || '(unidentified)'} may be truncated: ${Math.round(width)}px available for about ${Math.round(expectedWidth)}px of text.`,
          id ? [id] : [],
        );
        warnings.push(found);
        suggestions.add(suggestionFor(found.code));
      }
    }

    if (element?.type === 'text' && text) {
      const width = Math.abs(asFiniteNumber(element.width));
      const expectedWidth = Math.max(minLabelWidth, text.length * characterWidth);
      if (width > 0 && width < expectedWidth) {
        const found = issue(
          'LABEL_TRUNCATION_RISK',
          `Text ${id || '(unidentified)'} may be truncated: ${Math.round(width)}px available for about ${Math.round(expectedWidth)}px of text.`,
          id ? [id] : [],
        );
        warnings.push(found);
        suggestions.add(suggestionFor(found.code));
      }
    }

    if (CONNECTOR_TYPES.has(element?.type)) {
      const startId = endpointId(element, 'start');
      const endId = endpointId(element, 'end');
      if (!startId || !endId) {
        const found = issue(
          'UNBOUND_CONNECTOR',
          `Connector ${id || '(unidentified)'} is missing a start or end binding.`,
          id ? [id] : [],
        );
        warnings.push(found);
        suggestions.add(suggestionFor(found.code));
      } else {
        const missing = [startId, endId].filter((targetId) => !visibleIds.has(targetId));
        if (missing.length > 0) {
          const found = issue(
            'CONNECTOR_ENDPOINT_NOT_FOUND',
            `Connector ${id || '(unidentified)'} references missing element id(s): ${missing.join(', ')}.`,
            id ? [id, ...missing] : missing,
          );
          warnings.push(found);
          suggestions.add(suggestionFor(found.code));
        }
      }
    }

    if (element?.type === 'cameraUpdate') {
      const width = asFiniteNumber(element.width);
      const height = asFiniteNumber(element.height);
      if (width > 0 && height > 0 && Math.abs(width / height - 4 / 3) > 0.15) {
        const found = issue(
          'CAMERA_ASPECT_RATIO',
          `cameraUpdate ${Math.round(width)}x${Math.round(height)} is not close to 4:3.`,
          id ? [id] : [],
        );
        warnings.push(found);
        suggestions.add(suggestionFor(found.code));
      }
    }
  }

  const connectorCount = visible.filter((element) => CONNECTOR_TYPES.has(element?.type)).length;
  const status = errors.length > 0 ? 'fail' : (warnings.length > 0 ? 'warn' : 'pass');
  return {
    status,
    ok: errors.length === 0,
    errors,
    warnings,
    repairSuggestions: [...suggestions].filter(Boolean),
    summary: {
      elementCount: elements.length,
      visibleElementCount: visible.length,
      connectorCount,
      errorCount: errors.length,
      warningCount: warnings.length,
    },
  };
}
