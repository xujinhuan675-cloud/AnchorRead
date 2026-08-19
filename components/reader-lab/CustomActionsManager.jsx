'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, Plus, Pencil, Trash2, WandSparkles } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import { CUSTOM_ACTION_SELECTION_PLACEHOLDER } from '@/lib/custom-actions';

const EMPTY_FORM = { id: '', name: '', description: '', promptTemplate: '', builtin: false };

function ToggleSwitch({ checked, label, onToggle }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onToggle}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? 'bg-stone-900' : 'bg-stone-200 dark:bg-white/15'}`}
    >
      <span
        aria-hidden="true"
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`}
      />
    </button>
  );
}

/**
 * 浮动工具栏管理器：内置动作与自定义动作合并为同一列表，
 * 统一启用/停用、排序与编辑表单（名称/说明/模板）；
 * 内置动作仅以标签区分，不可删除
 */
export default function CustomActionsManager({
  isOpen,
  onClose,
  actions = [],
  onSave,
  onSaveBuiltin,
  onRemove,
  onToggle,
  onMove,
}) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [formOpen, setFormOpen] = useState(false);
  const [formError, setFormError] = useState('');

  // 关闭弹窗时在事件回调里重置表单（新建/编辑入口本身也会重置）
  const handleClose = () => {
    setForm(EMPTY_FORM);
    setFormOpen(false);
    setFormError('');
    onClose?.();
  };

  const startCreate = () => {
    setForm({ ...EMPTY_FORM, promptTemplate: `请用通俗易懂的语言解释以下内容：\n\n${CUSTOM_ACTION_SELECTION_PLACEHOLDER}` });
    setFormError('');
    setFormOpen(true);
  };

  // 内置与自定义动作共用同一编辑表单：名称/说明/模板都可改
  const startEdit = (action) => {
    setForm({
      id: action.id,
      name: action.name,
      description: action.description || '',
      promptTemplate: action.promptTemplate,
      builtin: Boolean(action.builtin),
    });
    setFormError('');
    setFormOpen(true);
  };

  const submit = async (event) => {
    event.preventDefault();
    setFormError('');
    try {
      if (form.builtin) {
        await onSaveBuiltin?.(form.id, {
          name: form.name,
          description: form.description,
          promptTemplate: form.promptTemplate,
        });
      } else {
        await onSave?.({
          id: form.id || undefined,
          name: form.name,
          description: form.description,
          promptTemplate: form.promptTemplate,
        });
      }
      setForm(EMPTY_FORM);
      setFormOpen(false);
    } catch (error) {
      setFormError(error?.message || '保存失败');
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="浮动工具栏" maxWidth="max-w-3xl">
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm text-stone-500">
            选中文本后浮动工具栏的动作都在这里，按列表顺序上屏，每条动作的名称、说明与提示词模板都可编辑，模板中用
            <code className="mx-1 rounded bg-stone-100 dark:bg-white/10 px-1 py-0.5 text-xs">{CUSTOM_ACTION_SELECTION_PLACEHOLDER}</code>
            代表选中文本。「内置」动作不可删除；内置模板保持默认时按原效果锚定到原文，修改后按模板执行。
          </p>
          <button
            type="button"
            onClick={startCreate}
            className="flex h-9 shrink-0 items-center gap-1.5 rounded bg-stone-900 px-3 text-xs font-medium text-white hover:bg-stone-700 dark:bg-stone-300"
          >
            <Plus size={14} aria-hidden="true" />
            新建动作
          </button>
        </div>

        {formOpen ? (
          <form onSubmit={submit} className="space-y-3 rounded-lg border border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-white/5 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-medium text-stone-600 dark:text-stone-400">
                动作名称
                <input
                  type="text"
                  value={form.name}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder="例如：翻译成英文"
                  maxLength={40}
                  className="mt-1 h-9 w-full rounded border border-stone-200 dark:border-stone-800 bg-white px-2.5 text-sm text-stone-900 dark:text-stone-100 outline-none focus:border-stone-400"
                />
              </label>
              <label className="block text-xs font-medium text-stone-600 dark:text-stone-400">
                说明（可选）
                <input
                  type="text"
                  value={form.description}
                  onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                  placeholder="一句话描述这个动作"
                  className="mt-1 h-9 w-full rounded border border-stone-200 dark:border-stone-800 bg-white px-2.5 text-sm text-stone-900 dark:text-stone-100 outline-none focus:border-stone-400"
                />
              </label>
            </div>
            <label className="block text-xs font-medium text-stone-600 dark:text-stone-400">
              提示词模板（必须包含 {CUSTOM_ACTION_SELECTION_PLACEHOLDER}）
              <textarea
                value={form.promptTemplate}
                onChange={(event) => setForm((current) => ({ ...current, promptTemplate: event.target.value }))}
                rows={5}
                className="mt-1 w-full resize-y rounded border border-stone-200 dark:border-stone-800 bg-white px-2.5 py-2 text-sm leading-6 text-stone-900 dark:text-stone-100 outline-none focus:border-stone-400"
              />
            </label>
            {formError ? <p role="alert" className="text-xs text-red-600">{formError}</p> : null}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                className="h-9 rounded border border-stone-200 dark:border-stone-800 bg-white px-3 text-xs font-medium text-stone-600 dark:text-stone-400 hover:bg-stone-100 dark:bg-white/10"
              >
                取消
              </button>
              <button
                type="submit"
                className="h-9 rounded bg-stone-900 px-4 text-xs font-medium text-white hover:bg-stone-700 dark:bg-stone-300"
              >
                保存动作
              </button>
            </div>
          </form>
        ) : null}

        {actions.length === 0 && !formOpen ? (
          <div className="rounded-lg border border-dashed border-stone-300 dark:border-stone-700 p-8 text-center">
            <WandSparkles size={22} className="mx-auto text-stone-300 dark:text-stone-600" aria-hidden="true" />
            <p className="mt-2 text-sm text-stone-400">浮动工具栏还没有动作，点击「新建动作」开始。</p>
          </div>
        ) : (
          <ul className="divide-y divide-stone-100 dark:divide-stone-800 rounded-lg border border-stone-200 dark:border-stone-800">
            {actions.map((action, index) => (
              <li key={action.id} className="flex items-center gap-3 px-4 py-3">
                <ToggleSwitch
                  checked={action.enabled !== false}
                  label={`启用 ${action.name}`}
                  onToggle={() => onToggle?.(action)}
                />
                <div className="min-w-0 flex-1">
                  <p className={`truncate text-sm font-medium ${action.enabled === false ? 'text-stone-400' : 'text-stone-900 dark:text-stone-100'}`}>{action.name}</p>
                  <p className="truncate text-xs text-stone-400">{action.description || action.promptTemplate}</p>
                </div>
                <div className="flex shrink-0 flex-col">
                  <button
                    type="button"
                    onClick={() => onMove?.(action.id, 'up')}
                    disabled={index === 0}
                    className="flex h-4 w-8 items-center justify-center rounded text-stone-500 hover:bg-stone-100 dark:bg-white/10 disabled:opacity-30"
                    aria-label={`上移 ${action.name}`}
                  >
                    <ChevronUp size={13} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onMove?.(action.id, 'down')}
                    disabled={index === actions.length - 1}
                    className="flex h-4 w-8 items-center justify-center rounded text-stone-500 hover:bg-stone-100 dark:bg-white/10 disabled:opacity-30"
                    aria-label={`下移 ${action.name}`}
                  >
                    <ChevronDown size={13} aria-hidden="true" />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => startEdit(action)}
                  className="flex h-8 w-8 items-center justify-center rounded text-stone-500 hover:bg-stone-100 dark:bg-white/10"
                  aria-label={`编辑 ${action.name}`}
                >
                  <Pencil size={14} aria-hidden="true" />
                </button>
                {action.builtin ? (
                  /* 内置徽标占据自定义行删除按钮的列位，保证各行列对齐 */
                  <span className="flex h-8 w-8 items-center justify-center">
                    <span className="rounded bg-stone-100 dark:bg-white/10 px-1.5 py-0.5 text-[10px] font-medium text-stone-500">内置</span>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => onRemove?.(action.id)}
                    className="flex h-8 w-8 items-center justify-center rounded text-red-500 hover:bg-red-50"
                    aria-label={`删除 ${action.name}`}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
