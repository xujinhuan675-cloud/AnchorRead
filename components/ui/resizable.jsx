'use client';

import { Group, Panel, Separator } from 'react-resizable-panels';

export function ResizablePanelGroup({ className = '', ...props }) {
  return <Group className={`flex h-full w-full ${className}`} {...props} />;
}

export const ResizablePanel = Panel;

export function ResizableHandle({ className = '', ...props }) {
  return (
    <Separator
      className={`relative flex w-px items-center justify-center bg-stone-200 dark:bg-white/15 outline-none transition-colors hover:bg-stone-400 dark:hover:bg-stone-500 focus-visible:bg-stone-500 ${className}`}
      {...props}
    />
  );
}
