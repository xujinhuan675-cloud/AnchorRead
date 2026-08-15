'use client';

import { Group, Panel, Separator } from 'react-resizable-panels';

export function ResizablePanelGroup({ className = '', ...props }) {
  return <Group className={`flex h-full w-full ${className}`} {...props} />;
}

export const ResizablePanel = Panel;

export function ResizableHandle({ className = '', ...props }) {
  return (
    <Separator
      className={`relative flex w-px items-center justify-center bg-gray-200 outline-none transition-colors hover:bg-gray-400 focus-visible:bg-gray-500 ${className}`}
      {...props}
    />
  );
}
