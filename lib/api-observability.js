import * as Sentry from '@sentry/nextjs';
import {
  isSafeAnonymousTelemetryUserId,
  normalizeSentryRoute,
  safeTelemetryIdentifier,
} from './sentry-config.js';

const SentrySdk = Sentry.default || Sentry;

const SAFE_CONTEXT_KEYS = new Set([
  'action',
  'document_id',
  'drawing_id',
  'engine',
  'failure_kind',
  'model',
  'provider',
  'provider_request_id',
  'task',
  'upstream_code',
  'upstream_status',
]);

function createFallbackErrorId() {
  return `err-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createErrorId() {
  return globalThis.crypto?.randomUUID?.() || createFallbackErrorId();
}

function requestRoute(request) {
  try {
    const url = new URL(request.url);
    return normalizeSentryRoute(`${request.method || 'UNKNOWN'} ${url.pathname}`);
  } catch {
    return normalizeSentryRoute(`${request?.method || 'UNKNOWN'} /unknown`);
  }
}

function safeContext(context = {}) {
  const clean = {};
  for (const [key, value] of Object.entries(context || {})) {
    if (!SAFE_CONTEXT_KEYS.has(key)) continue;
    const normalized = safeTelemetryIdentifier(value);
    if (normalized !== 'unknown') clean[key] = normalized;
  }
  return clean;
}

function safeErrorCode(error, explicitCode) {
  const code = explicitCode || error?.code;
  return code ? safeTelemetryIdentifier(code) : undefined;
}

export function normalizeApiErrorStatus(value, fallback = 500) {
  const status = Number(value);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : fallback;
}

export function getAnonymousTelemetryUserId(request) {
  const userId = request?.headers?.get?.('x-anchorread-telemetry-user');
  return isSafeAnonymousTelemetryUserId(userId) ? userId : undefined;
}

function upstreamErrorContext(error) {
  if (!error || typeof error !== 'object') return {};
  return {
    provider: error.provider,
    model: error.model,
    failure_kind: error.failureKind,
    upstream_status: error.upstreamStatus,
    provider_request_id: error.providerRequestId,
    upstream_code: error.upstreamCode,
  };
}

export function getApiErrorContext({ request, operation, errorId = createErrorId(), status, code, context } = {}) {
  const route = requestRoute(request);
  return {
    errorId,
    operation: safeTelemetryIdentifier(operation, 'api.request'),
    apiRoute: route,
    status: normalizeApiErrorStatus(status),
    errorCode: safeErrorCode(null, code),
    context: safeContext(context),
  };
}

export function reportApiError({
  request,
  operation,
  error,
  errorId = createErrorId(),
  status = 500,
  code,
  context,
  capture,
} = {}) {
  const capturedError = error instanceof Error ? error : new Error(String(error || 'API request failed'));
  const shouldCapture = capture ?? (
    normalizeApiErrorStatus(status) >= 500 || capturedError.name === 'LLMProviderError'
  );
  const anonymousUserId = getAnonymousTelemetryUserId(request);
  const telemetry = getApiErrorContext({
    request,
    operation,
    errorId,
    status,
    code: safeErrorCode(capturedError, code),
    context: {
      ...upstreamErrorContext(capturedError),
      ...context,
    },
  });

  if (shouldCapture) {
    SentrySdk.withScope((scope) => {
      scope.setTag('error_id', telemetry.errorId);
      scope.setTag('operation', telemetry.operation);
      scope.setTag('api_route', telemetry.apiRoute);
      scope.setTag('http_status', String(telemetry.status));
      if (telemetry.errorCode) scope.setTag('error_code', telemetry.errorCode);
      for (const [key, value] of Object.entries(telemetry.context)) scope.setTag(key, value);
      if (anonymousUserId) scope.setUser({ id: anonymousUserId });
      scope.setContext('api', {
        error_id: telemetry.errorId,
        operation: telemetry.operation,
        route: telemetry.apiRoute,
        status: telemetry.status,
        ...(telemetry.errorCode ? { error_code: telemetry.errorCode } : {}),
        ...telemetry.context,
      });
      SentrySdk.addBreadcrumb({
        category: 'api',
        message: 'request_failed',
        level: 'error',
        data: {
          route: telemetry.apiRoute,
          status_code: telemetry.status,
          failure_kind: telemetry.context.failure_kind,
          provider: telemetry.context.provider,
          model: telemetry.context.model,
          request_id: telemetry.context.provider_request_id,
        },
      });
      SentrySdk.captureException(capturedError);
    });
  }

  // Keep server logs correlatable without writing prompts, responses, URLs, or credentials.
  console.error('[api-error]', {
    error_id: telemetry.errorId,
    operation: telemetry.operation,
    route: telemetry.apiRoute,
    status: telemetry.status,
    error_type: capturedError.name || 'Error',
    ...(telemetry.errorCode ? { error_code: telemetry.errorCode } : {}),
    ...telemetry.context,
  });

  return telemetry;
}

export function apiErrorResponse({
  request,
  operation,
  error,
  errorId = createErrorId(),
  status = 500,
  message,
  code,
  context,
  capture,
  headers,
} = {}) {
  const responseStatus = normalizeApiErrorStatus(status);
  const telemetry = reportApiError({
    request,
    operation,
    error,
    errorId,
    status: responseStatus,
    code,
    context,
    capture,
  });
  const responseBody = {
    error: message || error?.message || '请求失败',
    errorId: telemetry.errorId,
  };
  if (code || telemetry.errorCode) responseBody.code = code || telemetry.errorCode;
  const responseHeaders = new Headers(headers);
  responseHeaders.set('x-anchorread-error-reported', '1');
  responseHeaders.set('x-anchorread-error-id', telemetry.errorId);
  return Response.json(responseBody, { status: responseStatus, headers: responseHeaders });
}

async function attachErrorId(response, { request, operation, errorId }) {
  if (!response || response.status < 400) return response;
  const headers = new Headers(response.headers);
  const contentType = headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    if (response.status >= 500 && headers.get('x-anchorread-error-reported') !== '1') {
      reportApiError({
        request,
        operation: `${operation}.response_error`,
        error: new Error('API route returned an error response'),
        errorId,
        status: response.status,
      });
    }
    headers.set('x-anchorread-error-id', errorId);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }

  try {
    const body = await response.clone().json();
    const responseErrorId = body?.errorId || errorId;
    headers.set('x-anchorread-error-id', responseErrorId);
    if (response.status >= 500 && headers.get('x-anchorread-error-reported') !== '1') {
      reportApiError({
        request,
        operation: `${operation}.response_error`,
        error: new Error('API route returned an error response'),
        errorId: responseErrorId,
        status: response.status,
      });
    }
    if (!body || typeof body !== 'object' || Array.isArray(body) || body.errorId) {
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    }
    return Response.json({ ...body, errorId }, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch {
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
}

export function withApiObservability(operation, handler) {
  return async function observedApiHandler(request, ...args) {
    const errorId = createErrorId();
    const route = requestRoute(request);
    return SentrySdk.startSpan({
      name: safeTelemetryIdentifier(operation, 'api.request'),
      op: 'api.handler',
      attributes: {
        'app.api.operation': safeTelemetryIdentifier(operation, 'api.request'),
        'http.request.method': safeTelemetryIdentifier(request?.method, 'unknown'),
      },
    }, async (span) => {
      SentrySdk.addBreadcrumb({
        category: 'api',
        message: 'request_started',
        level: 'info',
        data: {
          route,
          method: request?.method,
        },
      });
      try {
        const response = await handler(request, ...args);
        span.setAttribute('http.response.status_code', response?.status || 200);
        span.setAttribute('app.api.outcome', response?.status >= 400 ? 'error' : 'ok');
        if (response?.status >= 500) span.setStatus?.({ code: 2, message: 'server_error' });
        return attachErrorId(response, { request, operation, errorId });
      } catch (error) {
        const status = normalizeApiErrorStatus(error?.status);
        span.setAttribute('http.response.status_code', status);
        span.setAttribute('app.api.outcome', 'error');
        span.setStatus?.({ code: 2, message: 'handler_error' });
        return apiErrorResponse({ request, operation, error, errorId, status });
      }
    });
  };
}
