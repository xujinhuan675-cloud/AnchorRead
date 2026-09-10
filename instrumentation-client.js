import * as Sentry from '@sentry/nextjs';
import {
  createSentryOptions,
  getOrCreateAnonymousTelemetryUserId,
} from './lib/sentry-config.js';

Sentry.init(createSentryOptions({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
  release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
  service: 'anchorread-web',
  tracesSampleRate: process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE,
}));

const anonymousUserId = getOrCreateAnonymousTelemetryUserId();
if (anonymousUserId) Sentry.setUser({ id: anonymousUserId });

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
