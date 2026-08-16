'use client';

import {
  BookOpen,
  FilePlus2,
  PenTool,
  Settings2,
} from 'lucide-react';

function NavItem({ icon: Icon, label, active = false, onClick, compact = false }) {
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
    { icon: PenTool, label: '图解', active: mode === 'diagram', onClick: () => onModeChange('diagram') },
  ];

  if (mobile) {
    return (
      <nav className="flex shrink-0 border-b border-gray-200 bg-white md:hidden" aria-label="移动工作区导航">
        {[...primaryItems, { icon: Settings2, label: '配置', onClick: onConfig }].map((item) => (
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

      {/* 配置是低频管理入口，收在底部；代码仓库链接进一步收敛进配置面板 */}
      <div className="mt-auto flex flex-col items-center gap-1 border-t border-gray-200 pt-3">
        <NavItem icon={Settings2} label="配置" onClick={onConfig} />
      </div>
    </aside>
  );
}
