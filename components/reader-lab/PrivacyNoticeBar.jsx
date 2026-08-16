'use client';

import { Download, ShieldCheck } from 'lucide-react';

/**
 * 全局隐私提示横幅：所有页面统一显示，含免费卖点与宣传语，
 * 告知数据仅存本地并提供一键导出备份入口
 */
export default function PrivacyNoticeBar({ onExport }) {
  return (
    <div className="flex min-h-8 shrink-0 items-center gap-2 border-b border-gray-200 bg-[#eef5f2] px-3 text-[11px] leading-4 text-gray-600 sm:px-4">
      <ShieldCheck size={13} className="shrink-0 text-teal-700" aria-hidden="true" />
      {/* 单行展示：窄屏末尾截断，不折行挤压工作区 */}
      <span className="truncate">
        数据由你掌控：所有数据仅保存在本地浏览器，支持随时导出备份。记住的术语无需重复解释。仅在你主动生成 AI 解读时，相关内容才会发送至你配置的模型，兼顾隐私与成本。
      </span>
      <button
        type="button"
        onClick={onExport}
        className="ml-auto hidden shrink-0 items-center gap-1 font-medium text-teal-800 hover:text-teal-950 sm:flex"
      >
        <Download size={12} /> 导出
      </button>
    </div>
  );
}
