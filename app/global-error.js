'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

export default function GlobalError({ error, reset }) {
  useEffect(() => {
    Sentry.captureException(error);
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
