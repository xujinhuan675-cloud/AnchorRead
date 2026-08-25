'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { executeDiagramAgentCommand } from '@/lib/diagram-agent-commands';
import { getDiagramRouteId } from '@/lib/diagram-route-id';
import { workspaceRepository } from '@/lib/local-workspace-db';
import { buildDiagramPath } from '@/lib/workspace-routes';
import {
  createDiagramAgentIdentity,
  createDiagramAgentSession,
  createDiagramSyncChannel,
} from '@/lib/diagram-agent-session';

export const DIAGRAM_AGENT_DRAWING_EVENT = 'anchor-read:diagram-agent-drawing';
export const DIAGRAM_AGENT_CONNECTION_EVENT = 'anchor-read:diagram-agent-connection';

export default function DiagramAgentBridge() {
  const router = useRouter();
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
    });
    const emitConnection = (detail) => {
      window.dispatchEvent(new CustomEvent(DIAGRAM_AGENT_CONNECTION_EVENT, { detail }));
    };
    const isActiveTab = () => document.visibilityState !== 'hidden';
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
    const refreshSession = () => session.acquire({ visible: document.visibilityState !== 'hidden', focused: typeof document.hasFocus !== 'function' || document.hasFocus() });
    const respond = async (request, result, error) => {
      await fetch('/api/diagram-agent', {
        method: 'POST',
        headers: pairingHeaders,
        body: JSON.stringify({
          action: 'resolve',
          ...pairingBody(),
          id: request.id,
          claimToken: request.claimToken,
          ...(error ? { error: String(error?.message || error) } : { result }),
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
      if (!response.ok) throw new Error(payload.error || `Pairing registration failed (${response.status}).`);
      emitConnection(payload.connection);
      return payload.connection;
    };
    const publishDrawing = (drawing, { open = true } = {}) => {
      window.dispatchEvent(new CustomEvent(DIAGRAM_AGENT_DRAWING_EVENT, {
        detail: { drawing, open },
      }));
      syncChannel?.postMessage({
        type: 'drawing-upsert',
        sourceTabId: tabId,
        drawing,
        emittedAt: Date.now(),
      });
      if (open) router.push(buildDiagramPath(getDiagramRouteId(drawing)));
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
            waitMs: '20000',
            clientId,
            tabId,
            workspaceId,
            browserSessionId,
            visible: String(document.visibilityState !== 'hidden'),
            focused: String(typeof document.hasFocus !== 'function' || document.hasFocus()),
            href: window.location.href,
          });
          const response = await fetch(`/api/diagram-agent?${presence}`, {
            cache: 'no-store',
            signal: pollController.signal,
            headers: { 'X-AnchorRead-Session-Secret': managementSecret },
          });
          if (!response.ok) {
            const failure = await response.json().catch(() => ({}));
            emitConnection({ status: failure.code === 'CONNECTION_REPLACED' ? 'replaced' : 'disconnected', error: failure.error });
            await new Promise((resolve) => window.setTimeout(resolve, response.status === 409 ? 2_000 : 1_000));
            continue;
          }
          emitConnection({ workspaceId, browserSessionId, tabId, clientId, status: 'connected', connected: true, currentClient: true });
          const payload = await response.json();
          for (const request of payload.requests || []) {
            if (cancelled) break;
            // A tab that lost focus after claiming a request must not open or
            // mutate the user's newly focused tab. Return a retryable error.
            if (!isActiveTab() || !session.isOwner()) {
              await respond(request, undefined, new Error('AnchorRead browser tab is no longer active; retry the diagram command.'));
              continue;
            }
            try {
              const result = await executeDiagramAgentCommand(request.payload, {
                repository: workspaceRepository,
                onOpen: publishDrawing,
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
    const handleFocus = () => { refreshSession(); };
    const handleBlur = () => {
      // Keep a visible tab available while the user works in another app;
      // hidden tabs still release immediately through visibilitychange.
      if (document.visibilityState === 'hidden') releaseSession({ disconnect: true });
      else refreshSession();
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') releaseSession({ disconnect: true });
      else refreshSession();
    };
    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);
    document.addEventListener('visibilitychange', handleVisibility);
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
          emitConnection({ status: 'disconnected', error: String(error?.message || error) });
          await new Promise((resolve) => window.setTimeout(resolve, 1_500));
        }
      }
    };
    connect();
    return () => {
      cancelled = true;
      releaseSession({ disconnect: true });
      syncChannel?.close();
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [bridgeEnabled, router]);

  return null;
}
