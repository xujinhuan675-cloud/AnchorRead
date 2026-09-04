import * as Sentry from '@sentry/nextjs';
import { createSentryOptions } from './lib/sentry-config.js';

Sentry.init(createSentryOptions({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
  release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
  tracesSampleRate: process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE,
}));

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
