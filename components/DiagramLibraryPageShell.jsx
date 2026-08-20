'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import AppTopNav from '@/components/AppTopNav';
import ConfigManager from '@/components/ConfigManager';
import DiagramLibrary from '@/components/reader-lab/DiagramLibrary';
import { buildNewDiagramHref } from '@/lib/diagram-library';

export default function DiagramLibraryPageShell() {
  const router = useRouter();
  const [isConfigManagerOpen, setIsConfigManagerOpen] = useState(false);

  const handleNavigate = (slug) => {
    if (slug === 'read') router.push('/');
    else if (slug === 'reader-lab') router.push('/reader-lab');
    else if (slug === 'diagram') router.push('/diagrams');
  };

  return (
    <div className="flex h-dvh min-h-[520px] flex-col overflow-hidden bg-background dark:bg-stone-950">
      <AppTopNav
        activeSlug="diagram"
        onNavigate={handleNavigate}
        onConfig={() => setIsConfigManagerOpen(true)}
      />
      <div className="min-h-0 flex-1 overflow-hidden">
        <DiagramLibrary
          onCreateDrawing={() => router.push(buildNewDiagramHref())}
          onOpenDrawing={(_drawing, href) => router.push(href)}
        />
      </div>
      <ConfigManager isOpen={isConfigManagerOpen} onClose={() => setIsConfigManagerOpen(false)} />
    </div>
  );
}
