'use client';

/** Shared Excalidraw-style toolbar surface for canvas controls. */
export default function CanvasToolbar({ children, className = '', style, floating = false, ...props }) {
  return (
    <div
      {...props}
      className={`flex items-center gap-1 rounded-lg bg-[#ececf4] p-0.5 dark:bg-[hsl(240,8%,15%)] ${floating ? 'shadow-[0_0_0_1px_#fff] backdrop-blur dark:shadow-[0_0_0_1px_hsl(0,0%,7%)]' : ''} ${className}`.trim()}
      style={style}
    >
      {children}
    </div>
  );
}
