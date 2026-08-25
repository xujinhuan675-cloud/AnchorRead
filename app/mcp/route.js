import { handleDiagramMcpHttpRequest } from '@/lib/diagram-mcp-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  return handleDiagramMcpHttpRequest(request);
}

export async function POST(request) {
  return handleDiagramMcpHttpRequest(request);
}

export async function DELETE(request) {
  return handleDiagramMcpHttpRequest(request);
}

export async function OPTIONS(request) {
  return handleDiagramMcpHttpRequest(request);
}

