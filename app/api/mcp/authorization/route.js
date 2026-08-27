import { NextResponse } from 'next/server';
import {
  getDiagramMcpAuthorizationInfo,
} from '@/lib/diagram-mcp-authorization';
import { getDiagramMcpOAuthRuntimeInfo } from '@/lib/diagram-mcp-oauth';
import { getDiagramMcpRuntimeInfo } from '@/lib/diagram-mcp-pairing-store';
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

export async function GET(request) {
  const info = getDiagramMcpAuthorizationInfo(request, {
    ...getDiagramMcpRuntimeInfo(),
    ...getDiagramMcpOAuthRuntimeInfo(),
  });
  return NextResponse.json({
    ok: true,
    ...info,
    // This endpoint is retained as a compatibility alias for older clients;
    // standards-based clients should use /.well-known/oauth-protected-resource/mcp.
    resource: info.resource,
    authorization_servers: [requestOrigin(request)],
  }, { headers: responseHeaders() });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: responseHeaders() });
}
