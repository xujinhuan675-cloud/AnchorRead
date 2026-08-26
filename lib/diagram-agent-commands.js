import {
  applyScenePatch,
  alignScene,
  describeScene,
  distributeScene,
  duplicateScene,
  groupScene,
  querySceneElements,
  restoreSceneSnapshot,
  setSceneElementsLocked,
  setSceneViewport,
  ungroupScene,
  createSceneSnapshot,
} from './excalidraw-scene-ops.js';
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
import { getPresentationSpec, normalizePresentationSpec } from './diagram-presentation.js';

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

function getNamedSnapshots(drawing) {
  return Array.isArray(drawing?.namedSnapshots) ? drawing.namedSnapshots : [];
}

function saveNamedSnapshot(drawing, scene, name, now) {
  const normalizedName = String(name || '').trim();
  if (!normalizedName) throw new Error('snapshot requires a non-empty name');
  const snapshot = createSceneSnapshot(scene, {
    name: normalizedName,
    id: `${drawing.id}:snapshot:${normalizedName}`,
    createdAt: now,
  });
  const snapshots = [...getNamedSnapshots(drawing).filter((item) => item.name !== normalizedName), snapshot];
  return { ...drawing, namedSnapshots: snapshots, updatedAt: now };
}

function getSnapshot(drawing, name) {
  const target = String(name || '').trim();
  const snapshot = getNamedSnapshots(drawing).find((item) => item.name === target || item.id === target);
  if (!snapshot) throw new Error(`Diagram snapshot not found: ${target}`);
  return snapshot;
}

function browserScreenshot() {
  if (typeof document === 'undefined') throw new Error('Screenshot requires an open browser canvas.');
  const canvas = document.querySelector('.excalidraw canvas, canvas');
  if (!canvas || typeof canvas.toDataURL !== 'function') throw new Error('No canvas is available for screenshot.');
  const dataUrl = canvas.toDataURL('image/png');
  const comma = dataUrl.indexOf(',');
  return {
    content: [{
      type: 'image',
      data: comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl,
      mimeType: 'image/png',
    }],
  };
}

function applyRequestedScenePatch(scene, patch = {}) {
  let next = applyScenePatch(scene, patch);
  if (patch.align) next = alignScene(next, patch.align);
  if (patch.distribute) next = distributeScene(next, patch.distribute);
  return next;
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
    ...(args.presentation ? { presentation: normalizePresentationSpec(args.presentation) } : {}),
  }, new Set(existingDrawings.map((item) => item.routeId).filter(isDiagramRouteId)));
  return withRoute;
}

export async function executeDiagramAgentCommand(command, {
  repository,
  onOpen,
  onPresentation,
  screenshot,
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
    case 'list_diagram_snapshots':
      return getNamedSnapshots(getDrawing(drawings, args.id)).map(({ elements, appState, files, ...summary }) => summary);
    case 'get_presentation': {
      const drawing = getDrawing(drawings, args.id);
      return { id: drawing.id, routeId: drawing.routeId, presentation: getPresentationSpec(drawing) };
    }
    case 'export_excalidraw':
      return serializeExcalidrawScene(getDrawingScene(getDrawing(drawings, args.id)));
    case 'create_diagram': {
      const drawing = makeDrawing(args, { now, existingDrawings: drawings });
      await repository.drawings.save(drawing);
      onOpen?.(drawing, { open: args.open !== false });
      return { ...drawing, scene: drawing.scene || null };
    }
    case 'set_presentation': {
      const drawing = getDrawing(drawings, args.id);
      const presentation = normalizePresentationSpec(args.presentation);
      const nextDrawing = { ...drawing, presentation, updatedAt: now };
      await repository.drawings.save(nextDrawing);
      onOpen?.(nextDrawing, { open: false });
      return { id: nextDrawing.id, routeId: nextDrawing.routeId, revision: nextDrawing.revision || 0, presentation };
    }
    case 'clear_presentation': {
      const drawing = getDrawing(drawings, args.id);
      const { presentation: _presentation, presentationSpec: _presentationSpec, ...rest } = drawing;
      const nextDrawing = { ...rest, updatedAt: now };
      await repository.drawings.save(nextDrawing);
      onOpen?.(nextDrawing, { open: false });
      return { id: nextDrawing.id, routeId: nextDrawing.routeId, revision: nextDrawing.revision || 0, presentation: null };
    }
    case 'play_presentation':
    case 'pause_presentation':
    case 'next_presentation_step':
    case 'previous_presentation_step':
    case 'stop_presentation': {
      const drawing = getDrawing(drawings, args.id);
      const presentation = getPresentationSpec(drawing);
      if (!presentation) throw new Error('Diagram has no presentation steps.');
      const action = tool === 'play_presentation' ? 'play'
        : tool === 'pause_presentation' ? 'pause'
          : tool === 'next_presentation_step' ? 'next'
            : tool === 'previous_presentation_step' ? 'previous' : 'stop';
      if (action === 'play') onOpen?.(drawing, { open: true });
      onPresentation?.({ action, drawingId: drawing.id, routeId: drawing.routeId, stepIndex: Number.isInteger(args.stepIndex) ? args.stepIndex : undefined });
      return { id: drawing.id, routeId: drawing.routeId, action, stepCount: presentation.steps.length, stepIndex: Number.isInteger(args.stepIndex) ? args.stepIndex : 0 };
    }
    case 'group_elements': {
      const drawing = getDrawing(drawings, args.id);
      const result = groupScene(getDrawingScene(drawing), { ids: args.elementIds || args.ids, groupId: args.groupId });
      const nextDrawing = commitDiagramScene(drawing, result.scene, { ...args, author: args.author || 'agent', reason: 'group-elements', now });
      await repository.drawings.save(nextDrawing);
      onOpen?.(nextDrawing, { open: false });
      return { id: nextDrawing.id, routeId: nextDrawing.routeId, revision: nextDrawing.revision, groupId: result.groupId, elementIds: result.elementIds, scene: nextDrawing.scene };
    }
    case 'ungroup_elements': {
      const drawing = getDrawing(drawings, args.id);
      const result = ungroupScene(getDrawingScene(drawing), { ids: args.elementIds || args.ids, groupId: args.groupId });
      const nextDrawing = commitDiagramScene(drawing, result.scene, { ...args, author: args.author || 'agent', reason: 'ungroup-elements', now });
      await repository.drawings.save(nextDrawing);
      onOpen?.(nextDrawing, { open: false });
      return { id: nextDrawing.id, routeId: nextDrawing.routeId, revision: nextDrawing.revision, elementIds: result.elementIds, scene: nextDrawing.scene };
    }
    case 'lock_elements':
    case 'unlock_elements': {
      const drawing = getDrawing(drawings, args.id);
      const scene = setSceneElementsLocked(getDrawingScene(drawing), { ids: args.elementIds || args.ids, locked: tool === 'lock_elements' });
      const nextDrawing = commitDiagramScene(drawing, scene, { ...args, author: args.author || 'agent', reason: tool, now });
      await repository.drawings.save(nextDrawing);
      onOpen?.(nextDrawing, { open: false });
      return { id: nextDrawing.id, routeId: nextDrawing.routeId, revision: nextDrawing.revision, scene: nextDrawing.scene };
    }
    case 'duplicate_elements': {
      const drawing = getDrawing(drawings, args.id);
      const result = duplicateScene(getDrawingScene(drawing), { ids: args.elementIds || args.ids, offsetX: args.offsetX, offsetY: args.offsetY });
      const nextDrawing = commitDiagramScene(drawing, result.scene, { ...args, author: args.author || 'agent', reason: 'duplicate-elements', now });
      await repository.drawings.save(nextDrawing);
      onOpen?.(nextDrawing, { open: false });
      return { id: nextDrawing.id, routeId: nextDrawing.routeId, revision: nextDrawing.revision, elements: result.elements, idMap: result.idMap, scene: nextDrawing.scene };
    }
    case 'snapshot_scene': {
      const drawing = getDrawing(drawings, args.id);
      const nextDrawing = saveNamedSnapshot(drawing, getDrawingScene(drawing), args.name, now);
      await repository.drawings.save(nextDrawing);
      return { id: nextDrawing.id, name: String(args.name).trim(), snapshots: getNamedSnapshots(nextDrawing).map(({ elements, appState, files, ...summary }) => summary) };
    }
    case 'restore_snapshot': {
      const drawing = getDrawing(drawings, args.id);
      const snapshot = getSnapshot(drawing, args.name);
      const nextDrawing = commitDiagramScene(drawing, restoreSceneSnapshot(snapshot), { ...args, author: args.author || 'agent', reason: `restore-snapshot:${snapshot.name}`, now });
      await repository.drawings.save(nextDrawing);
      onOpen?.(nextDrawing, { open: false });
      return { id: nextDrawing.id, routeId: nextDrawing.routeId, revision: nextDrawing.revision, snapshot: snapshot.name, scene: nextDrawing.scene };
    }
    case 'set_viewport': {
      const drawing = getDrawing(drawings, args.id);
      let scene = getDrawingScene(drawing);
      if (args.scrollToContent || args.scrollToElementIds || args.scrollToElementId) {
        const ids = args.scrollToElementIds || (args.scrollToElementId ? [args.scrollToElementId] : null);
        const target = ids ? querySceneElements(scene, { ids }) : querySceneElements(scene, {});
        if (target.length === 0) throw new Error('set_viewport could not find target elements');
        const bounds = target.reduce((box, element) => {
          const x = Number(element.x) || 0; const y = Number(element.y) || 0;
          const width = Math.abs(Number(element.width) || 0); const height = Math.abs(Number(element.height) || 0);
          return { x: Math.min(box.x, x), y: Math.min(box.y, y), maxX: Math.max(box.maxX, x + width), maxY: Math.max(box.maxY, y + height) };
        }, { x: Infinity, y: Infinity, maxX: -Infinity, maxY: -Infinity });
        scene = setSceneViewport(scene, { scrollX: -(bounds.x + (bounds.maxX - bounds.x) / 2), scrollY: -(bounds.y + (bounds.maxY - bounds.y) / 2), zoom: args.viewportZoomFactor || undefined });
      } else {
        scene = setSceneViewport(scene, args);
      }
      const nextDrawing = commitDiagramScene(drawing, scene, { ...args, author: args.author || 'agent', reason: 'set-viewport', now });
      await repository.drawings.save(nextDrawing);
      onOpen?.(nextDrawing, { open: false });
      return { id: nextDrawing.id, routeId: nextDrawing.routeId, revision: nextDrawing.revision, appState: nextDrawing.scene.appState, scene: nextDrawing.scene };
    }
    case 'get_canvas_screenshot':
      return screenshot ? screenshot() : browserScreenshot();
    case 'share_diagram': {
      const drawing = getDrawing(drawings, args.id);
      const origin = typeof window !== 'undefined' && window.location?.origin ? window.location.origin : '';
      return { routeId: drawing.routeId, url: `${origin}/diagrams/${encodeURIComponent(drawing.routeId)}`, local: true, note: 'This is an AnchorRead route; no data is uploaded to a third-party service.' };
    }
    case 'apply_diagram_patch': {
      const drawing = getDrawing(drawings, args.id);
      const patchedScene = applyRequestedScenePatch(getDrawingScene(drawing), args.patch || {});
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
