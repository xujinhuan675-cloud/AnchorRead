import { NextResponse } from 'next/server';
import {
  getDiagramMcpAuthorizationInfo,
} from '@/lib/diagram-mcp-authorization';
import { getDiagramMcpRuntimeInfo } from '@/lib/diagram-mcp-pairing-store';

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
  return NextResponse.json({
    ok: true,
    ...getDiagramMcpAuthorizationInfo(request, getDiagramMcpRuntimeInfo()),
  }, { headers: responseHeaders() });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: responseHeaders() });
}

