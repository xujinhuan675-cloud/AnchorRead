const MAX_NODE_LABEL_LENGTH = 72;
const MAX_EDGE_LABEL_LENGTH = 56;

function normalizeText(value, maxLength) {
  const text = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();

  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(1, maxLength - 1))}...`;
}

function escapeMermaidLabel(value, maxLength) {
  return normalizeText(value, maxLength)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\|/g, '&#124;');
}

function relationLabel(relation) {
  const type = normalizeText(relation?.type, MAX_EDGE_LABEL_LENGTH);
  const label = normalizeText(relation?.label, MAX_EDGE_LABEL_LENGTH);

  if (type && label && type !== label) return `${type} - ${label}`;
  return label || type || '关联';
}

/**
 * Convert concept API output into a deterministic Mermaid flowchart.
 * User-provided text is only emitted inside quoted, entity-escaped labels.
 */
export function buildMermaidConceptGraph(concepts = [], relations = []) {
  const validConcepts = concepts.filter(
    (concept) => normalizeText(concept?.name, MAX_NODE_LABEL_LENGTH).length > 0
  );
  const nodeByName = new Map();
  const lines = ['flowchart LR'];

  validConcepts.forEach((concept, index) => {
    const nodeId = `concept_${index}`;
    const rawName = String(concept.name).trim();
    const label = escapeMermaidLabel(rawName, MAX_NODE_LABEL_LENGTH);

    if (!nodeByName.has(rawName)) nodeByName.set(rawName, nodeId);
    lines.push(`  ${nodeId}["${label}"]`);
  });

  relations.forEach((relation) => {
    const from = nodeByName.get(String(relation?.from ?? '').trim());
    const to = nodeByName.get(String(relation?.to ?? '').trim());
    if (!from || !to) return;

    const label = escapeMermaidLabel(
      relationLabel(relation),
      MAX_EDGE_LABEL_LENGTH
    );
    lines.push(`  ${from} -->|"${label}"| ${to}`);
  });

  if (validConcepts.length > 0) {
    lines.push(
      '  classDef concept fill:#ffffff,stroke:#475569,stroke-width:1.5px,color:#111827;'
    );
    lines.push(
      `  class ${validConcepts.map((_, index) => `concept_${index}`).join(',')} concept;`
    );
  }

  return lines.join('\n');
}

