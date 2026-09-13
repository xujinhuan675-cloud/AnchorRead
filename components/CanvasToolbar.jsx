'use client';

/** Shared Excalidraw-style toolbar surface for canvas controls. */
export default function CanvasToolbar({ children, className = '', style, floating = false, ...props }) {
  return (
    <div
      {...props}
      className={`canvas-toolbar-surface flex items-center gap-1 rounded-lg p-0.5 ${floating ? 'shadow-[0_0_0_1px_#fff] backdrop-blur dark:shadow-[0_0_0_1px_hsl(0,0%,7%)]' : ''} ${className}`.trim()}
      style={style}
    >
      {children}
    </div>
  );
}
