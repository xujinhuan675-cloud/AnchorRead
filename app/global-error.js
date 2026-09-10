'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';
import { isChunkLoadError, recoverChunkLoadError } from '@/lib/chunk-load-recovery';

export default function GlobalError({ error, reset }) {
  useEffect(() => {
    Sentry.withScope((scope) => {
      scope.setTag('operation', 'ui.global_error');
      scope.setContext('ui', {
        component: 'GlobalError',
        route: window.location.pathname,
      });
      Sentry.captureException(error);
    });
    if (isChunkLoadError(error)) {
      void Sentry.flush(1_000).then(
        () => recoverChunkLoadError(error),
        () => recoverChunkLoadError(error)
      );
    }
  }, [error]);

  return (
    <html lang="zh-CN">
      <body>
        <main style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
          <h1>页面加载出错</h1>
          <p>可以重试加载当前页面。</p>
          <button type="button" onClick={() => reset()}>重试</button>
        </main>
      </body>
    </html>
  );
}
