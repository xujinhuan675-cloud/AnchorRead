import { withSentryConfig } from '@sentry/nextjs/config';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // standalone 产物便于 Docker 部署（见 Dockerfile）
  output: 'standalone',
};

const hasSentrySourceMapConfig = Boolean(
  process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT
);

if (process.env.SENTRY_SOURCEMAPS_REQUIRED === 'true' && !hasSentrySourceMapConfig) {
  throw new Error(
    'Sentry source maps are required for this build. Set SENTRY_AUTH_TOKEN, SENTRY_ORG, and SENTRY_PROJECT.'
  );
}

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  telemetry: false,
  silent: false,
  sourcemaps: {
    disable: !hasSentrySourceMapConfig,
    deleteSourcemapsAfterUpload: true,
  },
  webpack: {
    treeshake: {
      removeDebugLogging: true,
      excludeReplayIframe: true,
      excludeReplayShadowDOM: true,
    },
  },
});
