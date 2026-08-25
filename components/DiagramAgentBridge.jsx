'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { executeDiagramAgentCommand } from '@/lib/diagram-agent-commands';
import { getDiagramRouteId } from '@/lib/diagram-route-id';
import { workspaceRepository } from '@/lib/local-workspace-db';
import { buildDiagramPath } from '@/lib/workspace-routes';

export const DIAGRAM_AGENT_DRAWING_EVENT = 'anchor-read:diagram-agent-drawing';

export default function DiagramAgentBridge() {
  const router = useRouter();
  const clientIdRef = useRef(null);

  useEffect(() => {
    if (!clientIdRef.current) {
      const randomId = typeof crypto?.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      clientIdRef.current = `anchorread-${randomId}`;
    }
    let cancelled = false;
    const controller = new AbortController();
    const clientId = clientIdRef.current;
    const respond = async (request, result, error) => {
      await fetch('/api/diagram-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'resolve',
          id: request.id,
          claimToken: request.claimToken,
          ...(error ? { error: String(error?.message || error) } : { result }),
        }),
      }).catch(() => {});
    };
    const publishDrawing = (drawing, { open = true } = {}) => {
      window.dispatchEvent(new CustomEvent(DIAGRAM_AGENT_DRAWING_EVENT, {
        detail: { drawing, open },
      }));
      if (open) router.push(buildDiagramPath(getDiagramRouteId(drawing)));
    };
    const poll = async () => {
      while (!cancelled) {
        try {
          const response = await fetch(`/api/diagram-agent?action=poll&waitMs=20000&clientId=${encodeURIComponent(clientId)}`, {
            cache: 'no-store',
            signal: controller.signal,
          });
          if (!response.ok) continue;
          const payload = await response.json();
          for (const request of payload.requests || []) {
            if (cancelled) break;
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
        }
      }
    };
    poll();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [router]);

  return null;
}
