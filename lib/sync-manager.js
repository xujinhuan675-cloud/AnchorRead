/**
 * 同步编排：把工作区推送到存储适配器 / 从适配器拉回本地。
 * 与具体适配器解耦，便于测试与扩展新的云存储。
 */

import { exportWorkspace, importWorkspace } from './workspace-file.js';
import { SyncStorageError } from './sync-storage.js';

/** 把工作区推送到适配器，返回本次同步时间戳 */
export async function pushWorkspace(adapter, repository, additionalData = {}, { now = Date.now() } = {}) {
  if (!adapter || typeof adapter.save !== 'function') {
    throw new SyncStorageError('无效的同步存储适配器。');
  }
  const payload = await exportWorkspace(repository, additionalData);
  await adapter.save(JSON.stringify(payload));
  return now;
}

/** 从适配器拉回工作区；远端为空时抛错提示 */
export async function pullWorkspace(adapter, repository, { replace = false } = {}) {
  if (!adapter || typeof adapter.load !== 'function') {
    throw new SyncStorageError('无效的同步存储适配器。');
  }
  const raw = await adapter.load();
  if (!raw) throw new SyncStorageError('远端尚无工作区备份，请先推送一次。');
  return importWorkspace(repository, raw, { replace });
}

/**
 * 比较本地与远端时间戳，给出冲突处理建议：
 * 'push' 本地更新、'pull' 远端更新、'same' 一致
 */
export function resolveSyncDirection(localSyncedAt, remoteExportedAt) {
  const local = Number.isFinite(localSyncedAt) ? localSyncedAt : 0;
  const remote = Number.isFinite(remoteExportedAt) ? remoteExportedAt : 0;
  if (local === remote) return 'same';
  return local > remote ? 'push' : 'pull';
}

/** 读取远端备份的导出时间（不导入），用于冲突提示 */
export async function peekRemoteExportedAt(adapter) {
  const raw = await adapter.load();
  if (!raw) return null;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Number.isFinite(parsed?.exportedAt) ? parsed.exportedAt : null;
  } catch {
    throw new SyncStorageError('远端备份不是有效的 JSON，可能已损坏。');
  }
}
