import * as Sentry from '@sentry/nextjs';
import { createSentryOptions } from './lib/sentry-config.js';

Sentry.init(createSentryOptions({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT,
  release: process.env.SENTRY_RELEASE,
  tracesSampleRate: process.env.SENTRY_TRACES_SAMPLE_RATE,
}));
