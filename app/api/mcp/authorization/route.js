import { NextResponse } from 'next/server';
import {
  getDiagramMcpAuthorizationInfo,
} from '@/lib/diagram-mcp-authorization';
import { getDiagramMcpOAuthRuntimeInfo } from '@/lib/diagram-mcp-oauth';
import { getDiagramMcpRuntimeInfo } from '@/lib/diagram-mcp-pairing-store';
import { getDiagramAgentTransport } from '@/lib/diagram-agent-transport';
import { requestOrigin } from '@/lib/diagram-mcp-oauth-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function responseHeaders() {
  return {
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, MCP-Protocol-Version',
  };
}

function brokerUnavailable(error) {
  return ['BROKER_BUSY', 'BROKER_CONFIG_ERROR', 'BROKER_UNAVAILABLE'].includes(String(error?.code || ''));
}

export async function GET(request) {
  try {
    const transport = getDiagramAgentTransport();
    await transport.assertReady?.();
    const transportRuntime = transport.runtimeInfo || {};
    if (transportRuntime.requestBroker === 'redis' && !String(process.env.ANCHORREAD_REDIS_URL || '').trim()) {
      const error = new Error('ANCHORREAD_REDIS_URL is required when ANCHORREAD_DIAGRAM_BROKER=redis.');
      error.code = 'BROKER_CONFIG_ERROR';
      throw error;
    }
    const info = getDiagramMcpAuthorizationInfo(request, {
      ...getDiagramMcpRuntimeInfo(),
      ...getDiagramMcpOAuthRuntimeInfo(),
      ...transportRuntime,
    });
    return NextResponse.json({
      ok: true,
      ...info,
      // This endpoint is retained as a compatibility alias for older clients;
      // standards-based clients should use /.well-known/oauth-protected-resource/mcp.
      resource: info.resource,
      authorization_servers: [requestOrigin(request)],
    }, { headers: {
      ...responseHeaders(),
      'X-AnchorRead-Instance-Id': transportRuntime.instanceId || 'unknown',
      'X-AnchorRead-Request-Broker': transportRuntime.requestBroker || 'memory',
    } });
  } catch (error) {
    if (!brokerUnavailable(error)) throw error;
    return NextResponse.json({ ok: false, code: error.code, error: error.message }, {
      status: 503,
      headers: { ...responseHeaders(), 'X-AnchorRead-Request-Broker': 'redis' },
    });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: responseHeaders() });
}
