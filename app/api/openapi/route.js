import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const dynamic = 'force-dynamic';

/**
 * GET /api/openapi
 * 对外提供 OpenAPI YAML 规范（docs/openapi.yaml），方便外部集成与文档浏览。
 */
export async function GET() {
  try {
    const yaml = await readFile(join(process.cwd(), 'docs', 'openapi.yaml'), 'utf8');
    return new NextResponse(yaml, {
      status: 200,
      headers: {
        'Content-Type': 'text/yaml; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  } catch {
    return NextResponse.json({ error: 'OpenAPI 文档不可用' }, { status: 404 });
  }
}
