'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import AppTopNav from '@/components/AppTopNav';
import ConfigManager from '@/components/ConfigManager';
import ReaderLabWorkspace, { OPEN_GLOSSARY_EVENT, OPEN_TOOLBAR_CONFIG_EVENT } from '@/components/ReaderLabWorkspace';

// 文档库（/reader-lab）路由的页面外壳：全局顶栏 + 完整阅读工作区
export default function ReaderLabPageShell() {
  const router = useRouter();
  const [isConfigManagerOpen, setIsConfigManagerOpen] = useState(false);

  // 首页/图解是首页路由的两个视图：跳回首页并用 view 参数带上目标视图
  const handleNavigate = (slug) => {
    if (slug === 'read') router.push('/');
    else if (slug === 'diagram') router.push('/?view=diagram');
  };

  return (
    <div className="flex h-dvh min-h-[520px] flex-col overflow-hidden bg-[#f5f7f6] dark:bg-stone-950">
      <AppTopNav
        activeSlug="reader-lab"
        onNavigate={handleNavigate}
        onConfig={() => setIsConfigManagerOpen(true)}
        onToolbarConfig={() => window.dispatchEvent(new Event(OPEN_TOOLBAR_CONFIG_EVENT))}
        onGlossary={() => window.dispatchEvent(new Event(OPEN_GLOSSARY_EVENT))}
      />
      <main className="min-h-0 flex-1 overflow-hidden">
        <ReaderLabWorkspace layout="reader-lab" />
      </main>
      <ConfigManager isOpen={isConfigManagerOpen} onClose={() => setIsConfigManagerOpen(false)} />
    </div>
  );
}
