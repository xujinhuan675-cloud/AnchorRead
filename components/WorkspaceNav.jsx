'use client';

import {
  BookOpen,
  Code2,
  FilePlus2,
  KeyRound,
  PenTool,
  Settings2,
} from 'lucide-react';

const REPO_URL = 'https://github.com/xujinhuan675-cloud/smart-excalidraw-next';

function NavItem({ icon: Icon, label, active = false, onClick, href, compact = false }) {
  const className = `relative flex shrink-0 items-center justify-center transition-colors ${
    compact
      ? 'h-12 min-w-14 flex-1 gap-1.5 px-2 text-xs'
      : 'h-14 w-16 flex-col gap-1 text-[11px]'
  } ${
    active
      ? 'bg-gray-900 text-white'
      : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
  }`;
  const icon = <Icon size={compact ? 18 : 19} strokeWidth={1.8} aria-hidden="true" />;

  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" title={label} className={className}>
        {icon}
        <span>{label}</span>
      </a>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-current={active ? 'page' : undefined}
      className={className}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

export default function WorkspaceNav({
  mode,
  onNewArticle,
  onModeChange,
  onConfig,
  onPassword,
  mobile = false,
}) {
  const primaryItems = [
    { icon: BookOpen, label: '阅读', active: mode === 'article', onClick: () => onModeChange('article') },
    { icon: PenTool, label: '图表', active: mode === 'diagram', onClick: () => onModeChange('diagram') },
    { icon: Settings2, label: '配置', onClick: onConfig },
  ];

  if (mobile) {
    return (
      <nav className="flex shrink-0 border-b border-gray-200 bg-white md:hidden" aria-label="移动工作区导航">
        {primaryItems.map((item) => (
          <NavItem key={item.label} {...item} compact />
        ))}
        <NavItem icon={KeyRound} label="密码" onClick={onPassword} compact />
      </nav>
    );
  }

  return (
    <aside className="hidden w-[88px] shrink-0 flex-col items-center border-r border-gray-200 bg-white py-4 md:flex">
      <button
        type="button"
        onClick={onNewArticle}
        title="新建文章"
        aria-label="新建文章"
        className="mb-5 flex h-11 w-11 items-center justify-center rounded-lg bg-gray-900 text-white shadow-sm transition-colors hover:bg-gray-700"
      >
        <FilePlus2 size={20} strokeWidth={1.8} aria-hidden="true" />
      </button>

      <nav className="flex flex-col items-center gap-1" aria-label="工作区导航">
        {primaryItems.map((item) => (
          <NavItem key={item.label} {...item} />
        ))}
      </nav>

      <div className="mt-auto flex flex-col items-center gap-1 border-t border-gray-200 pt-3">
        <NavItem icon={KeyRound} label="密码" onClick={onPassword} />
        <NavItem icon={Code2} label="代码" href={REPO_URL} />
      </div>
    </aside>
  );
}
