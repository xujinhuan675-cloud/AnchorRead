'use client';

import { useState } from 'react';
import { Plus, Pencil, Trash2, WandSparkles } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import { CUSTOM_ACTION_SELECTION_PLACEHOLDER } from '@/lib/custom-actions';

const EMPTY_FORM = { id: '', name: '', description: '', promptTemplate: '' };

/**
 * 自定义动作管理器：新建/编辑/删除"选区派生内容"动作
 */
export default function CustomActionsManager({
  isOpen,
  onClose,
  actions = [],
  onSave,
  onRemove,
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

  const startEdit = (action) => {
    setForm({
      id: action.id,
      name: action.name,
      description: action.description || '',
      promptTemplate: action.promptTemplate,
    });
    setFormError('');
    setFormOpen(true);
  };

  const submit = async (event) => {
    event.preventDefault();
    setFormError('');
    try {
      await onSave?.({
        id: form.id || undefined,
        name: form.name,
        description: form.description,
        promptTemplate: form.promptTemplate,
      });
      setForm(EMPTY_FORM);
      setFormOpen(false);
    } catch (error) {
      setFormError(error?.message || '保存失败');
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="自定义动作" maxWidth="max-w-3xl">
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm text-gray-500">
            定义对选中文本执行的提示词模板，模板中用
            <code className="mx-1 rounded bg-gray-100 px-1 py-0.5 text-xs">{CUSTOM_ACTION_SELECTION_PLACEHOLDER}</code>
            代表选中文本。保存后出现在阅读界面的选区工具栏。
          </p>
          <button
            type="button"
            onClick={startCreate}
            className="flex h-9 shrink-0 items-center gap-1.5 rounded bg-gray-900 px-3 text-xs font-medium text-white hover:bg-gray-700"
          >
            <Plus size={14} aria-hidden="true" />
            新建动作
          </button>
        </div>

        {formOpen ? (
          <form onSubmit={submit} className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-medium text-gray-600">
                动作名称
                <input
                  type="text"
                  value={form.name}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder="例如：翻译成英文"
                  maxLength={40}
                  className="mt-1 h-9 w-full rounded border border-gray-200 bg-white px-2.5 text-sm text-gray-900 outline-none focus:border-gray-400"
                />
              </label>
              <label className="block text-xs font-medium text-gray-600">
                说明（可选）
                <input
                  type="text"
                  value={form.description}
                  onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                  placeholder="一句话描述这个动作"
                  className="mt-1 h-9 w-full rounded border border-gray-200 bg-white px-2.5 text-sm text-gray-900 outline-none focus:border-gray-400"
                />
              </label>
            </div>
            <label className="block text-xs font-medium text-gray-600">
              提示词模板（必须包含 {CUSTOM_ACTION_SELECTION_PLACEHOLDER}）
              <textarea
                value={form.promptTemplate}
                onChange={(event) => setForm((current) => ({ ...current, promptTemplate: event.target.value }))}
                rows={5}
                className="mt-1 w-full resize-y rounded border border-gray-200 bg-white px-2.5 py-2 text-sm leading-6 text-gray-900 outline-none focus:border-gray-400"
              />
            </label>
            {formError ? <p role="alert" className="text-xs text-red-600">{formError}</p> : null}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                className="h-9 rounded border border-gray-200 bg-white px-3 text-xs font-medium text-gray-600 hover:bg-gray-100"
              >
                取消
              </button>
              <button
                type="submit"
                className="h-9 rounded bg-gray-900 px-4 text-xs font-medium text-white hover:bg-gray-700"
              >
                保存动作
              </button>
            </div>
          </form>
        ) : null}

        {actions.length === 0 && !formOpen ? (
          <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center">
            <WandSparkles size={22} className="mx-auto text-gray-300" aria-hidden="true" />
            <p className="mt-2 text-sm text-gray-400">还没有自定义动作，点击「新建动作」开始。</p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
            {actions.map((action) => (
              <li key={action.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-900">{action.name}</p>
                  <p className="truncate text-xs text-gray-400">{action.description || action.promptTemplate}</p>
                </div>
                <button
                  type="button"
                  onClick={() => startEdit(action)}
                  className="flex h-8 w-8 items-center justify-center rounded text-gray-500 hover:bg-gray-100"
                  aria-label={`编辑 ${action.name}`}
                >
                  <Pencil size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => onRemove?.(action.id)}
                  className="flex h-8 w-8 items-center justify-center rounded text-red-500 hover:bg-red-50"
                  aria-label={`删除 ${action.name}`}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
