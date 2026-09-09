import { NextResponse } from 'next/server';
import { testConnection } from '@/lib/llm-client';
import { apiErrorResponse, withApiObservability } from '@/lib/api-observability';

/**
 * GET /api/configs/test-connection
 * Test connection to a provider API
 */
async function handlePOST(request) {
  try {
    const { config } = await request.json();

    if (!config) {
      return NextResponse.json(
        { error: 'Missing required parameter: config' },
        { status: 400 }
      );
    }

    const result = await testConnection(config);

    return NextResponse.json(result);
  } catch (error) {
    return apiErrorResponse({ request, operation: 'llm.test_connection', error, status: 500, message: error.message || '连接测试失败' });
  }
}

export const POST = withApiObservability('llm.test_connection', handlePOST);
