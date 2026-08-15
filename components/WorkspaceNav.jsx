'use client';

import {
  BookOpen,
  FilePlus2,
  PenTool,
  Settings2,
} from 'lucide-react';

const REPO_URL = 'https://github.com/xujinhuan675-cloud/smart-excalidraw-next';

// GitHub 品牌图标 lucide 已不再维护，直接内联官方字形，避免依赖告警
function GithubIcon({ size = 19 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  );
}

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
      </nav>
    );
  }

  return (
    <aside className="hidden w-[88px] shrink-0 flex-col items-center border-r border-gray-200 bg-white py-4 md:flex">
      <nav className="flex flex-col items-center gap-1" aria-label="工作区导航">
        <NavItem icon={FilePlus2} label="新建文章" onClick={onNewArticle} />
        {primaryItems.map((item) => (
          <NavItem key={item.label} {...item} />
        ))}
      </nav>

      <div className="mt-auto flex flex-col items-center gap-1 border-t border-gray-200 pt-3">
        <NavItem icon={GithubIcon} label="代码" href={REPO_URL} />
      </div>
    </aside>
  );
}
