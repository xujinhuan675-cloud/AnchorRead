'use client';

import { Group, Panel, Separator } from 'react-resizable-panels';
import { GripVertical } from 'lucide-react';

export function ResizablePanelGroup({ className = '', ...props }) {
  return <Group className={`flex h-full w-full ${className}`} {...props} />;
}

export const ResizablePanel = Panel;

export function ResizableHandle({ className = '', withHandle = false, ...props }) {
  return (
    <Separator
      className={`group relative flex w-px items-center justify-center bg-gray-200 outline-none transition-colors hover:bg-gray-400 focus-visible:bg-gray-500 ${className}`}
      {...props}
    >
      {withHandle && (
        <span className="absolute z-10 flex h-8 w-4 items-center justify-center rounded border border-gray-200 bg-white text-gray-400 shadow-sm group-hover:text-gray-700">
          <GripVertical size={12} aria-hidden="true" />
        </span>
      )}
    </Separator>
  );
}
