import { NextResponse } from 'next/server';
import {
  claimDiagramAgentRequests,
  cancelDiagramAgentRequest,
  createDiagramAgentRequest,
  resolveDiagramAgentRequest,
  waitForDiagramAgentRequests,
} from '@/lib/diagram-agent-broker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function requestHostname(request) {
  try {
    return new URL(request.url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function isLoopback(request) {
  return new Set(['localhost', '127.0.0.1', '::1']).has(requestHostname(request));
}

function authorized(request, action) {
  // This bridge deliberately serves the local Codex + local browser loop only.
  // A deployed AnchorRead instance must not expose a browser command queue.
  if (!isLoopback(request)) return false;
  const expected = String(process.env.ANCHORREAD_DIAGRAM_BRIDGE_TOKEN || '').trim();
  const supplied = String(request.headers.get('x-anchorread-bridge-token') || '').trim();
  if (action === 'poll' || action === 'resolve') return true;
  if (expected) return supplied === expected;
  return true;
}

function jsonError(message, status = 400, code = 'BRIDGE_ERROR') {
  return NextResponse.json({ ok: false, error: message, code }, { status });
}

export async function GET(request) {
  const url = new URL(request.url);
  const action = url.searchParams.get('action') || 'poll';
  if (!authorized(request, action)) return jsonError('Diagram bridge authorization failed.', 401, 'UNAUTHORIZED');
  if (action !== 'poll') return jsonError(`Unsupported diagram bridge GET action: ${action}`);
  const clientId = url.searchParams.get('clientId') || '';
  const waitMs = Math.max(0, Math.min(Number(url.searchParams.get('waitMs')) || 0, 25_000));
  const requests = waitMs
    ? await waitForDiagramAgentRequests(clientId, { waitMs })
    : claimDiagramAgentRequests(clientId);
  return NextResponse.json({ ok: true, requests });
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('Diagram bridge expects a JSON request body.');
  }
  const action = String(body?.action || '');
  if (!authorized(request, action)) return jsonError('Diagram bridge authorization failed.', 401, 'UNAUTHORIZED');
  if (action === 'submit') {
    const command = body?.request;
    if (!command || typeof command !== 'object' || !command.tool) {
      return jsonError('A diagram bridge request must include tool and args.');
    }
    try {
      const { id, promise } = createDiagramAgentRequest(command, { ttlMs: body?.ttlMs });
      const timeoutMs = Math.max(1_000, Math.min(Number(body?.timeoutMs) || 45_000, 120_000));
      const timeout = new Promise((_, reject) => {
        const timer = setTimeout(() => {
          const error = new Error('No open AnchorRead browser claimed the diagram request before timeout.');
          error.code = 'BRIDGE_TIMEOUT';
          cancelDiagramAgentRequest(id, error);
          reject(error);
        }, timeoutMs);
        timer.unref?.();
      });
      const result = await Promise.race([promise, timeout]);
      return NextResponse.json({ ok: true, requestId: id, result });
    } catch (error) {
      const status = error?.code === 'BRIDGE_QUEUE_FULL' ? 429 : 504;
      return jsonError(String(error?.message || error), status, error?.code || 'BRIDGE_ERROR');
    }
  }
  if (action === 'resolve') {
    const accepted = resolveDiagramAgentRequest(
      body?.id,
      body?.claimToken,
      body?.error ? undefined : body?.result,
      body?.error,
    );
    if (!accepted) return jsonError('Unknown or already resolved diagram bridge request.', 409, 'STALE_REQUEST');
    return NextResponse.json({ ok: true });
  }
  return jsonError(`Unsupported diagram bridge action: ${action}`);
}
