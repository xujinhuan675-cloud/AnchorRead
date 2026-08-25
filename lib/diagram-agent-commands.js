import { applyScenePatch, describeScene, querySceneElements } from './excalidraw-scene-ops.js';
import { parseExcalidrawScene, serializeExcalidrawScene } from './excalidraw-scene.js';
import {
  commitDiagramScene,
  createDiagramRevision,
  findDiagramRevision,
  getDrawingScene,
  listDiagramRevisions,
  restoreDiagramRevision,
} from './diagram-scene-record.js';
import {
  createDocumentDrawingId,
  finalizeDiagramSource,
  STANDALONE_DIAGRAM_DOCUMENT_ID,
} from './diagram-generation.js';
import { createDiagramMetadata, DIAGRAM_SCOPES } from './diagram-product.js';
import { ensureDiagramRouteId, isDiagramRouteId } from './diagram-route-id.js';

function getDrawing(drawings, id) {
  const key = String(id || '');
  const drawing = drawings.find((item) => item.id === key || item.routeId === key);
  if (!drawing) throw new Error(`未找到图解：${key}`);
  return drawing;
}

function listDrawings(drawings, documentId) {
  return drawings
    .filter((drawing) => !documentId || drawing.documentId === documentId)
    .map((drawing) => ({
      id: drawing.id,
      routeId: drawing.routeId,
      documentId: drawing.documentId,
      title: drawing.title,
      engine: drawing.engine,
      revision: drawing.revision || 0,
      updatedAt: drawing.updatedAt,
    }));
}

function normalizeSceneInput(scene) {
  return parseExcalidrawScene(scene);
}

function makeDrawing(args, { now = Date.now(), existingDrawings = [] } = {}) {
  const engine = args.engine === 'excalidraw' ? 'excalidraw' : 'mermaid';
  const documentId = typeof args.documentId === 'string' && args.documentId.trim()
    ? args.documentId.trim()
    : STANDALONE_DIAGRAM_DOCUMENT_ID;
  const id = typeof args.id === 'string' && args.id.trim()
    ? args.id.trim()
    : createDocumentDrawingId(documentId, now);
  const title = String(args.title || 'AI 图解').trim() || 'AI 图解';
  const inputSource = typeof args.source === 'string' ? args.source : '';
  const scene = engine === 'excalidraw' ? normalizeSceneInput(args.scene ?? inputSource) : null;
  const source = scene
    ? JSON.stringify(scene.elements, null, 2)
    : finalizeDiagramSource('mermaid', inputSource);
  const metadata = createDiagramMetadata({
    scope: args.scope || DIAGRAM_SCOPES.freeform,
    intent: args.intent || 'auto',
    renderer: engine,
    diagramSpec: args.diagramSpec || null,
  });
  const withRoute = ensureDiagramRouteId({
    id,
    documentId,
    title,
    engine,
    renderer: engine,
    source,
    ...(scene ? {
      scene,
      revision: 1,
      revisionHistory: [createDiagramRevision({ drawingId: id, revision: 1, scene, author: 'agent', reason: 'create' })],
    } : {}),
    variants: {
      [engine]: { source, ...(scene ? { scene } : {}), updatedAt: now },
    },
    prompt: String(args.prompt || ''),
    createdAt: now,
    updatedAt: now,
    ...metadata,
  }, new Set(existingDrawings.map((item) => item.routeId).filter(isDiagramRouteId)));
  return withRoute;
}

export async function executeDiagramAgentCommand(command, {
  repository,
  onOpen,
  now = Date.now(),
} = {}) {
  if (!repository?.drawings) throw new Error('浏览器工作区存储尚未准备好。');
  const args = command?.args && typeof command.args === 'object' ? command.args : {};
  const tool = String(command?.tool || '');
  const drawings = await repository.drawings.list();
  switch (tool) {
    case 'list_diagrams':
      return listDrawings(drawings, args.documentId);
    case 'get_diagram': {
      const drawing = getDrawing(drawings, args.id);
      return { ...drawing, scene: getDrawingScene(drawing) };
    }
    case 'describe_diagram':
      return describeScene(getDrawingScene(getDrawing(drawings, args.id)), {
        maxElements: Number.isInteger(args.maxElements) ? args.maxElements : Infinity,
      });
    case 'query_diagram':
      return querySceneElements(getDrawingScene(getDrawing(drawings, args.id)), args.filters || {});
    case 'list_diagram_revisions':
      return listDiagramRevisions(getDrawing(drawings, args.id));
    case 'export_excalidraw':
      return serializeExcalidrawScene(getDrawingScene(getDrawing(drawings, args.id)));
    case 'create_diagram': {
      const drawing = makeDrawing(args, { now, existingDrawings: drawings });
      await repository.drawings.save(drawing);
      onOpen?.(drawing, { open: args.open !== false });
      return { ...drawing, scene: drawing.scene || null };
    }
    case 'apply_diagram_patch': {
      const drawing = getDrawing(drawings, args.id);
      const patchedScene = applyScenePatch(getDrawingScene(drawing), args.patch || {});
      const nextDrawing = commitDiagramScene(drawing, patchedScene, {
        expectedRevision: args.expectedRevision,
        author: args.author || 'agent',
        reason: args.reason || 'agent-patch',
        now,
      });
      await repository.drawings.save(nextDrawing);
      onOpen?.(nextDrawing, { open: false });
      return { id: nextDrawing.id, routeId: nextDrawing.routeId, revision: nextDrawing.revision, scene: nextDrawing.scene };
    }
    case 'commit_diagram_scene': {
      const drawing = getDrawing(drawings, args.id);
      const nextDrawing = commitDiagramScene(drawing, normalizeSceneInput(args.scene), {
        expectedRevision: args.expectedRevision,
        author: args.author || 'agent',
        reason: args.reason || 'agent-commit',
        now,
      });
      await repository.drawings.save(nextDrawing);
      onOpen?.(nextDrawing, { open: false });
      return { id: nextDrawing.id, routeId: nextDrawing.routeId, revision: nextDrawing.revision, scene: nextDrawing.scene };
    }
    case 'restore_diagram_revision': {
      const drawing = getDrawing(drawings, args.id);
      if (!findDiagramRevision(drawing, args.revision)) throw new Error(`Diagram revision not found: ${args.revision}`);
      const nextDrawing = restoreDiagramRevision(drawing, args.revision, {
        expectedRevision: args.expectedRevision,
        author: args.author || 'agent',
        reason: args.reason || 'agent-restore',
        now,
      });
      await repository.drawings.save(nextDrawing);
      onOpen?.(nextDrawing, { open: false });
      return { id: nextDrawing.id, routeId: nextDrawing.routeId, revision: nextDrawing.revision, scene: nextDrawing.scene };
    }
    default:
      throw new Error(`未知工具：${tool}`);
  }
}
