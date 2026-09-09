import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config.js');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config.js');
  }
}

export function onRequestError(error, request, context) {
  Sentry.withScope((scope) => {
    scope.setTag('operation', 'request.error');
    scope.setContext('request', {
      method: request?.method,
      route: request?.path || request?.url,
    });
    Sentry.captureRequestError(error, request, context);
  });
}
