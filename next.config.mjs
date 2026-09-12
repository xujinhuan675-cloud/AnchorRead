import { withSentryConfig } from '@sentry/nextjs/config';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const packageVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;

function resolveBuildSha() {
  const configured = process.env.NEXT_PUBLIC_ANCHORREAD_BUILD_SHA
    || process.env.GITHUB_SHA
    || process.env.NEXT_PUBLIC_SENTRY_RELEASE
    || process.env.SENTRY_RELEASE;
  if (configured) return String(configured).replace(/^anchor-read@/u, '').trim();
  try {
    return execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'development';
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  // standalone 产物便于 Docker 部署（见 Dockerfile）
  output: 'standalone',
  env: {
    NEXT_PUBLIC_ANCHORREAD_BUILD_SHA: resolveBuildSha(),
    NEXT_PUBLIC_ANCHORREAD_BUILD_VERSION: process.env.NEXT_PUBLIC_ANCHORREAD_BUILD_VERSION || packageVersion,
  },
};

const hasSentrySourceMapConfig = Boolean(
  process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT
);
const sentryRelease = process.env.SENTRY_RELEASE || process.env.NEXT_PUBLIC_SENTRY_RELEASE;

if (process.env.SENTRY_SOURCEMAPS_REQUIRED === 'true' && (!hasSentrySourceMapConfig || !sentryRelease)) {
  throw new Error(
    'Sentry source maps are required for this build. Set SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT, and SENTRY_RELEASE.'
  );
}

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  telemetry: false,
  silent: false,
  widenClientFileUpload: true,
  release: sentryRelease ? {
    name: sentryRelease,
    create: true,
    finalize: true,
  } : undefined,
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
