/**
 * Diagram creation and refinement guidance adapted from
 * yctimlin/mcp_excalidraw at commit 713706e967ed21db1d9264748fa01c6af961c792.
 *
 * The upstream project is MIT licensed. See
 * licenses/mcp-excalidraw-MIT.txt for the retained license notice.
 * AnchorRead-specific persistence and revision rules are appended below.
 */

export const DIAGRAM_DESIGN_GUIDE_SOURCE = {
  repository: 'https://github.com/yctimlin/mcp_excalidraw',
  commit: '713706e967ed21db1d9264748fa01c6af961c792',
  license: 'MIT',
};

export const DIAGRAM_DESIGN_GUIDE = `# AnchorRead Excalidraw Design Guide

## Required workflow

1. Read this guide before creating or substantially editing a diagram.
2. Plan one flow direction and a coordinate grid before writing elements.
3. Create a coherent batch with stable element ids and bound connectors.
4. Call describe_scene to inspect ids, bounds, groups, labels, and connections.
5. Use align_elements and distribute_elements where repeated roles should share geometry.
6. Call get_canvas_screenshot and inspect the rendered canvas.
7. Fix truncation, overlap, cramped spacing, connector routing, and label collisions, then screenshot again.
8. Finish only after the quality checklist passes. For risky edits, snapshot_scene first. Use expectedRevision on every mutation.

## Colors

Use dark strokes with light fills. Keep a diagram to three or four main fill colors.

| Meaning | Stroke | Fill |
| --- | --- | --- |
| Default | #1e1e1e | #ffffff |
| Primary or link | #1971c2 | #a5d8ff |
| Success or healthy | #2f9e44 | #b2f2bb |
| Error or critical | #e03131 | #ffc9c9 |
| Service or middleware | #9c36b5 | #eebefa |
| Async or event | #e8590c | #ffd8a8 |
| Data store | #0c8599 | #99e9f2 |
| Secondary or zone | #868e96 | #e9ecef |

Use fillStyle \"solid\" for crisp fills. Use dashed strokes for boundaries, async flows, or optional paths.

## Visual design contract

- Unless the user explicitly specifies a visual style, color system, texture, or layout effect, use this guide's default visual system; do not invent a competing style.
- Every Excalidraw diagram must have an intentional visual system, not a default whiteboard look.
- Use three or four semantic colors, light solid fills, dark strokes, and one consistent corner radius for labelled cards.
- Use background zones/swimlanes for distinct responsibilities, with a clear title hierarchy and generous whitespace.
- Keep repeated roles at the same size and style; reserve stronger color or heavier type for primary nodes and titles.
- Before finishing, reject flat scenes where all labelled shapes are white/default styled, or where the hierarchy cannot be read without following every connector.

## Sizing and spacing constraints

- Minimum shape size: labeled shapes must be at least 120 x 60 px. Prefer 160 x 80 px for services and 140 x 70 px for flow steps.
- Size a single-line shape to at least max(160, labelCharacterCount * 12) px wide.
- Body and shape labels must be at least 16 px. Titles must be at least 20 px. Secondary annotations may be 14 px, never smaller.
- Leave at least 20 px internal padding and 40-80 px between adjacent shapes. Use 80-120 px between tiers.
- Keep the same role at the same size. Snap primary coordinates to a 20 px grid.
- Leave at least 80 px for an unlabeled connector and 120 px for a labeled connector.
- Use a 4:3 camera region. Recommended sizes are 400 x 300, 600 x 450, 800 x 600, 1200 x 900, or 1600 x 1200.

## Layout patterns

- Pick top-to-bottom or left-to-right and keep it consistent.
- Put important nodes earlier in the flow, higher, or larger.
- Cluster related elements into clear zones. Put the zone rectangle behind its contents.
- Do not bind a label to a large background zone. Use a standalone text element near the zone's top edge.
- Keep cross-zone connectors near zone edges. If a connector would cross an unrelated node, add waypoints and route it around the obstacle.
- When using stream pseudo-elements, emit a 4:3 cameraUpdate before the content it frames; keep padding around the content instead of fitting edges exactly.

## Diagram templates

- Architecture: use 160 x 80 service shapes, layer colors (frontend blue, service purple, data cyan), and solid synchronous versus dashed asynchronous arrows.
- Flowchart: use 140 x 70 step shapes, 100 x 100 decision diamonds, and a consistent top-to-bottom flow with concise Yes/No labels.
- Entity relationship: use wide entity shapes, leave 80 px between entities, and use arrowheads for cardinality.

## Anti-patterns

- Overlapping elements or cramped gaps: align or distribute instead of hand-tuning every coordinate.
- Tiny fonts or undersized shapes: increase the shape before shortening the label.
- Manual connector coordinates without bindings: bind both endpoints so edits reroute the connector.
- Too many colors, inconsistent same-role sizes, or unlabeled meaningful relationships.
- Flat layouts with no zones or hierarchy when the diagram has distinct responsibilities.

## Connector rules

- Every relationship connector must have a stable id and use startElementId/endElementId or native startBinding/endBinding.
- Put relationship text on the connector. Keep labels short and omit labels that add no information.
- Use two-point straight paths only for unobstructed single-in/single-out connectors with at least 40 px of channel. Fan-in/fan-out, loops, cross-zone routes, obstacle crossings, or narrower channels must use elbowed right-angle waypoints. Encode at least three relative \`points\` (relative to the connector's \`x/y\`) and set \`elbowed: true\`; the binding resolver must retain intermediate points. The scene preflight rejects violations before persistence.
- Use solid arrows for synchronous directed flow, dashed arrows for async or optional flow, and dotted arrows for weak dependencies or annotations.
- After moving or resizing bound nodes, inspect the connector paths again.

## Drawing order

1. Background zones.
2. Primary shapes and their labels.
3. Bound connectors.
4. Titles and annotations.
5. Alignment, distribution, viewport fit, and visual verification.

## Quality checklist

- No label is truncated or smaller than the readable minimum.
- No active shapes overlap; zones contain children with padding.
- No connector passes through an unrelated shape.
- Connector labels do not collide with shapes or other labels.
- Adjacent shapes have at least 40 px of breathing room.
- Repeated roles align and use consistent dimensions.
- The final camera frames the whole diagram with padding at a 4:3 ratio.
- describe_scene and the final screenshot both match the intended structure.

If any check fails, stop, fix it, call describe_scene when geometry or bindings changed, and take another screenshot before continuing.
`;

export function getDiagramDesignGuide() {
  return {
    name: 'anchor-read-excalidraw-design-guide',
    source: DIAGRAM_DESIGN_GUIDE_SOURCE,
    workflow: [
      'read_diagram_guide',
      'create_or_update',
      'describe_scene',
      'align_or_distribute',
      'get_canvas_screenshot',
      'fix_and_repeat_until_quality_passes',
    ],
    guide: DIAGRAM_DESIGN_GUIDE,
  };
}
