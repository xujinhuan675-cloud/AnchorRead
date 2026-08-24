'use client';

/**
 * 明暗主题切换按钮（移植自 infinite-canvas whiteboard 的 animated-theme-toggler.tsx）
 * 改写点：TS -> JSX；去掉 react-i18next 依赖，sr-only 文案回退到 aria-label；其余 View Transition 逻辑原样保留
 */
import { useCallback, useRef } from 'react';
import { flushSync } from 'react-dom';
import { Moon, Sun } from 'lucide-react';
import { useAppTheme } from '@/lib/theme';

function polygonCollapsed(cx, cy, vertexCount) {
  const pairs = Array.from({ length: vertexCount }, () => `${cx}px ${cy}px`).join(', ');
  return `polygon(${pairs})`;
}

function getThemeTransitionClipPaths(variant, cx, cy, maxRadius, viewportWidth, viewportHeight) {
  switch (variant) {
    case 'circle':
      return [`circle(0px at ${cx}px ${cy}px)`, `circle(${maxRadius}px at ${cx}px ${cy}px)`];
    case 'square': {
      const halfW = Math.max(cx, viewportWidth - cx);
      const halfH = Math.max(cy, viewportHeight - cy);
      const halfSide = Math.max(halfW, halfH) * 1.05;
      const end = [`${cx - halfSide}px ${cy - halfSide}px`, `${cx + halfSide}px ${cy - halfSide}px`, `${cx + halfSide}px ${cy + halfSide}px`, `${cx - halfSide}px ${cy + halfSide}px`].join(', ');
      return [polygonCollapsed(cx, cy, 4), `polygon(${end})`];
    }
    case 'triangle': {
      const scale = maxRadius * 2.2;
      const dx = (Math.sqrt(3) / 2) * scale;
      const verts = [`${cx}px ${cy - scale}px`, `${cx + dx}px ${cy + 0.5 * scale}px`, `${cx - dx}px ${cy + 0.5 * scale}px`].join(', ');
      return [polygonCollapsed(cx, cy, 3), `polygon(${verts})`];
    }
    case 'diamond': {
      // 略大于 view-transition 圆形半径，保证轴向覆盖与圆形揭示一致
      const R = maxRadius * Math.SQRT2;
      const end = [`${cx}px ${cy - R}px`, `${cx + R}px ${cy}px`, `${cx}px ${cy + R}px`, `${cx - R}px ${cy}px`].join(', ');
      return [polygonCollapsed(cx, cy, 4), `polygon(${end})`];
    }
    case 'hexagon': {
      const R = maxRadius * Math.SQRT2;
      const verts = [];
      for (let i = 0; i < 6; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 3;
        verts.push(`${cx + R * Math.cos(a)}px ${cy + R * Math.sin(a)}px`);
      }
      return [polygonCollapsed(cx, cy, 6), `polygon(${verts.join(', ')})`];
    }
    case 'rectangle': {
      const halfW = Math.max(cx, viewportWidth - cx);
      const halfH = Math.max(cy, viewportHeight - cy);
      const end = [`${cx - halfW}px ${cy - halfH}px`, `${cx + halfW}px ${cy - halfH}px`, `${cx + halfW}px ${cy + halfH}px`, `${cx - halfW}px ${cy + halfH}px`].join(', ');
      return [polygonCollapsed(cx, cy, 4), `polygon(${end})`];
    }
    case 'star': {
      // 轻微外扩，保证过渡最后一帧不会留出 1px 缝隙
      const R = maxRadius * Math.SQRT2 * 1.03;
      const innerRatio = 0.42;
      const starPolygon = (radius) => {
        const verts = [];
        for (let i = 0; i < 5; i++) {
          const outerA = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
          verts.push(`${cx + radius * Math.cos(outerA)}px ${cy + radius * Math.sin(outerA)}px`);
          const innerA = outerA + Math.PI / 5;
          verts.push(`${cx + radius * innerRatio * Math.cos(innerA)}px ${cy + radius * innerRatio * Math.sin(innerA)}px`);
        }
        return `polygon(${verts.join(', ')})`;
      };
      const startR = Math.max(2, R * 0.025);
      return [starPolygon(startR), starPolygon(R)];
    }
    default:
      return [`circle(0px at ${cx}px ${cy}px)`, `circle(${maxRadius}px at ${cx}px ${cy}px)`];
  }
}

export default function ThemeToggler({ className, duration = 400, variant, fromCenter = false, theme, targetTheme, onThemeChange, children, ...props }) {
  const shape = variant ?? 'circle';
  const { theme: observedTheme, setTheme: setObservedTheme } = useAppTheme();
  const isDark = (theme ?? observedTheme) === 'dark';
  const buttonRef = useRef(null);

  const toggleTheme = useCallback(() => {
    const button = buttonRef.current;
    if (!button) return;

    const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;

    let x;
    let y;
    if (fromCenter) {
      x = viewportWidth / 2;
      y = viewportHeight / 2;
    } else {
      const { top, left, width, height } = button.getBoundingClientRect();
      x = left + width / 2;
      y = top + height / 2;
    }

    const maxRadius = Math.hypot(Math.max(x, viewportWidth - x), Math.max(y, viewportHeight - y));

    const applyThemeChange = () => {
      const nextTheme = targetTheme ?? (isDark ? 'light' : 'dark');
      if (nextTheme === (isDark ? 'dark' : 'light')) return;
      if (onThemeChange) onThemeChange(nextTheme);
      else setObservedTheme(nextTheme);
    };

    if (typeof document.startViewTransition !== 'function') {
      applyThemeChange();
      return;
    }

    const clipPath = getThemeTransitionClipPaths(shape, x, y, maxRadius, viewportWidth, viewportHeight);

    const root = document.documentElement;
    root.dataset.magicuiThemeVt = 'active';
    root.style.setProperty('--magicui-theme-toggle-vt-duration', `${duration}ms`);
    // 用 CSS 固定收起态 clip-path，避免 Firefox 在快照与 ready.then() JS 动画之间无裁剪地绘制新主题
    root.style.setProperty('--magicui-theme-vt-clip-from', clipPath[0]);
    const cleanup = () => {
      delete root.dataset.magicuiThemeVt;
      root.style.removeProperty('--magicui-theme-toggle-vt-duration');
      root.style.removeProperty('--magicui-theme-vt-clip-from');
    };

    const transition = document.startViewTransition(() => {
      flushSync(applyThemeChange);
    });
    if (typeof transition?.finished?.finally === 'function') {
      transition.finished.finally(cleanup);
    } else {
      cleanup();
    }

    const ready = transition?.ready;
    if (ready && typeof ready.then === 'function') {
      ready.then(() => {
        document.documentElement.animate(
          {
            clipPath,
          },
          {
            duration,
            // star：linear 避免缓动过冲与多边形插值在 t→1 时打架；VT 组时长已在上方同步
            easing: shape === 'star' ? 'linear' : 'ease-in-out',
            fill: 'forwards',
            pseudoElement: '::view-transition-new(root)',
          },
        );
      });
    }
  }, [shape, fromCenter, duration, isDark, targetTheme, onThemeChange, setObservedTheme]);

  return (
    <button type="button" ref={buttonRef} onClick={toggleTheme} className={className} {...props}>
      {children ?? (isDark ? <Sun /> : <Moon />)}
      <span className="sr-only">{props['aria-label'] || '切换主题'}</span>
    </button>
  );
}
