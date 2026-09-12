'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { executeDiagramAgentCommand } from '@/lib/diagram-agent-commands';
import { getDrawingScene } from '@/lib/diagram-scene-record';
import { cloneForTransport } from '@/lib/cloneable';
import { workspaceRepository } from '@/lib/local-workspace-db';
import {
  allowDiagramBrowserWrites,
  beginDiagramBrowserHandshake,
  blockDiagramBrowserWrites,
} from '@/lib/diagram-browser-write-guard';
import {
  getDiagramAgentBuildInfo,
  normalizeDiagramAgentRequests,
  serializeDiagramAgentError,
} from '@/lib/diagram-agent-protocol';
import {
  createDiagramAgentIdentity,
  createDiagramAgentSession,
  createDiagramSyncChannel,
  DIAGRAM_AGENT_LEASE_HEARTBEAT_MS,
  DIAGRAM_AGENT_LONG_POLL_MS,
} from '@/lib/diagram-agent-session';

export const DIAGRAM_AGENT_DRAWING_EVENT = 'anchor-read:diagram-agent-drawing';
export const DIAGRAM_AGENT_PRESENTATION_EVENT = 'anchor-read:diagram-agent-presentation';
export const DIAGRAM_AGENT_PENDING_PRESENTATION_KEY = 'anchor-read:pending-diagram-presentation';
export const DIAGRAM_AGENT_CONNECTION_EVENT = 'anchor-read:diagram-agent-connection';

export async function captureDrawingScreenshot(drawing) {
  const scene = getDrawingScene(drawing);
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    await document.fonts.ready;
  }
  const { convertToExcalidrawElements, exportToCanvas, restoreElements } = await import('@excalidraw/excalidraw');
  const converted = scene.elements.every((element) => Number.isFinite(element?.version))
    ? scene.elements
    : convertToExcalidrawElements(scene.elements, { regenerateIds: false });
  const elements = restoreElements(converted, null, {
    refreshDimensions: true,
    repairBindings: true,
  });
  const canvas = await exportToCanvas({
    elements: elements.filter((element) => !element.isDeleted),
    appState: { ...scene.appState, exportBackground: true },
    files: scene.files || {},
    maxWidthOrHeight: 4096,
    exportPadding: 32,
  });
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

export default function DiagramAgentBridge() {
  const pathname = usePathname();
  const bridgeEnabled = /^\/diagrams(?:\/|$)/u.test(pathname || '');
  const clientIdRef = useRef(null);

  useEffect(() => {
    if (!bridgeEnabled) return undefined;
    const identity = createDiagramAgentIdentity();
    clientIdRef.current = identity.clientId;
    let cancelled = false;
    let pollController = null;
    const { clientId, tabId, workspaceId, browserSessionId, managementSecret } = identity;
    const buildInfo = getDiagramAgentBuildInfo();
    beginDiagramBrowserHandshake({ workspaceUrl: window.location.href });
    const session = createDiagramAgentSession({ tabId });
    const syncChannel = createDiagramSyncChannel();
    const pairingHeaders = {
      'Content-Type': 'application/json',
      'X-AnchorRead-Session-Secret': managementSecret,
    };
    const pairingBody = () => ({
      workspaceId,
      browserSessionId,
      tabId,
      clientId,
      href: window.location.href,
      ...buildInfo,
    });
    const emitConnection = (detail) => {
      window.dispatchEvent(new CustomEvent(DIAGRAM_AGENT_CONNECTION_EVENT, { detail }));
    };
    const disconnectPairing = () => fetch('/api/mcp/pairing', {
      method: 'POST',
      headers: pairingHeaders,
      keepalive: true,
      body: JSON.stringify({ action: 'disconnect', ...pairingBody() }),
    }).catch(() => {});
    const releaseSession = ({ disconnect = false } = {}) => {
      session.release();
      pollController?.abort();
      if (disconnect) disconnectPairing();
    };
    const refreshSession = () => session.acquire();
    const leaseHeartbeat = window.setInterval(() => {
      if (cancelled) return;
      refreshSession();
    }, DIAGRAM_AGENT_LEASE_HEARTBEAT_MS);
    const respond = async (request, result, error) => {
      await fetch('/api/diagram-agent', {
        method: 'POST',
        headers: pairingHeaders,
        body: JSON.stringify({
          action: 'resolve',
          ...pairingBody(),
          id: request.id,
          claimToken: request.claimToken,
          ...(error ? { error: serializeDiagramAgentError(error) } : { result }),
        }),
      }).catch(() => {});
    };
    const register = async () => {
      const response = await fetch('/api/mcp/pairing', {
        method: 'POST',
        headers: pairingHeaders,
        cache: 'no-store',
        body: JSON.stringify({ action: 'register', replace: true, ...pairingBody() }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(payload.error || `Pairing registration failed (${response.status}).`);
        Object.assign(error, payload);
        throw error;
      }
      allowDiagramBrowserWrites(payload.connection?.actual || buildInfo);
      emitConnection(payload.connection);
      return payload.connection;
    };
    const publishDrawing = (drawing, { open = true } = {}) => {
      // The MCP result carries the open request and resource link. Keep this
      // tab as a background IndexedDB writer: changing its route here would
      // interrupt whatever the user is doing in the default browser.
      const cloneableDrawing = cloneForTransport(drawing);
      if (!cloneableDrawing?.id) return;
      window.dispatchEvent(new CustomEvent(DIAGRAM_AGENT_DRAWING_EVENT, {
        detail: { drawing: cloneableDrawing, open: false, openRequested: open },
      }));
      syncChannel?.postMessage({
        type: 'drawing-upsert',
        sourceTabId: tabId,
        drawing: cloneableDrawing,
        emittedAt: Date.now(),
      });
    };
    const publishPresentation = (detail) => {
      window.sessionStorage.setItem(DIAGRAM_AGENT_PENDING_PRESENTATION_KEY, JSON.stringify(detail));
      window.dispatchEvent(new CustomEvent(DIAGRAM_AGENT_PRESENTATION_EVENT, { detail }));
    };
    const poll = async () => {
      while (!cancelled) {
        if (!refreshSession()) {
          await new Promise((resolve) => window.setTimeout(resolve, 500));
          continue;
        }
        pollController = new AbortController();
        try {
          const presence = new URLSearchParams({
            action: 'poll',
            waitMs: String(DIAGRAM_AGENT_LONG_POLL_MS),
            clientId,
            tabId,
            workspaceId,
            browserSessionId,
            visible: 'true',
            focused: String(typeof document.hasFocus !== 'function' || document.hasFocus()),
            href: window.location.href,
            ...buildInfo,
          });
          const response = await fetch(`/api/diagram-agent?${presence}`, {
            cache: 'no-store',
            signal: pollController.signal,
            headers: { 'X-AnchorRead-Session-Secret': managementSecret },
          });
          if (!response.ok) {
            const failure = await response.json().catch(() => ({}));
            if (failure.code === 'BROWSER_BUILD_STALE') blockDiagramBrowserWrites(failure);
            emitConnection({ ...failure, status: failure.code === 'BROWSER_BUILD_STALE' ? 'stale' : (failure.code === 'CONNECTION_REPLACED' ? 'replaced' : 'disconnected') });
            await new Promise((resolve) => window.setTimeout(resolve, response.status === 409 ? 2_000 : 1_000));
            continue;
          }
          const payload = await response.json();
          emitConnection(payload.connection || {
            workspaceId,
            browserSessionId,
            tabId,
            clientId,
            status: 'connected',
            connected: true,
            online: true,
            writable: true,
            versionCompatible: true,
            expected: buildInfo,
            actual: buildInfo,
            ...buildInfo,
            currentClient: true,
          });
          for (const request of normalizeDiagramAgentRequests(payload)) {
            if (cancelled) break;
            if (!session.isOwner()) {
              await respond(request, undefined, new Error('AnchorRead browser tab no longer owns the workspace connection; retry the diagram command.'));
              continue;
            }
            try {
              const result = await executeDiagramAgentCommand(request.payload, {
                repository: workspaceRepository,
                onOpen: publishDrawing,
                onPresentation: publishPresentation,
                screenshot: captureDrawingScreenshot,
                includeMetrics: true,
                compactResponse: true,
                browserVersion: buildInfo,
              });
              await respond(request, result);
            } catch (error) {
              await respond(request, undefined, error);
            }
          }
        } catch (error) {
          if (!cancelled && error?.name !== 'AbortError') {
            await new Promise((resolve) => window.setTimeout(resolve, 1_000));
          }
        } finally {
          pollController = null;
        }
      }
    };
    const connect = async () => {
      while (!cancelled) {
        try {
          if (!refreshSession()) {
            await new Promise((resolve) => window.setTimeout(resolve, 500));
            continue;
          }
          await register();
          if (!cancelled) await poll();
          return;
        } catch (error) {
          if (error?.code === 'BROWSER_BUILD_STALE') blockDiagramBrowserWrites(error);
          emitConnection({ ...serializeDiagramAgentError(error), status: error?.code === 'BROWSER_BUILD_STALE' ? 'stale' : 'disconnected' });
          await new Promise((resolve) => window.setTimeout(resolve, 1_500));
        }
      }
    };
    const handlePageHide = () => releaseSession({ disconnect: true });
    window.addEventListener('pagehide', handlePageHide);
    connect();
    return () => {
      cancelled = true;
      window.clearInterval(leaseHeartbeat);
      releaseSession({ disconnect: true });
      syncChannel?.close();
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, [bridgeEnabled]);

  return null;
}
