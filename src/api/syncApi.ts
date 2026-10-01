import type { MergeConflict, SyncBase, SyncProfile, SyncSnapshot } from '../models/sync';
import { STORAGE_KEYS } from '../constants/storageVersion';
import { loadLocal, saveLocal } from '../utils/storage';

export const syncApi = {
  loadBase: () => loadLocal<SyncBase | null>(STORAGE_KEYS.syncBase, null),
  saveBase: (base: SyncBase) => saveLocal(STORAGE_KEYS.syncBase, base),
  loadConflicts: () => loadLocal<MergeConflict[]>(STORAGE_KEYS.syncConflicts, []),
  saveConflicts: (conflicts: MergeConflict[]) => saveLocal(STORAGE_KEYS.syncConflicts, conflicts),
  loadProfile: () =>
    loadLocal<SyncProfile>(STORAGE_KEYS.syncProfile, {
      deviceId: (globalThis.crypto?.randomUUID?.() || 'device-local') as string,
      author: '我',
    }),
  saveProfile: (profile: SyncProfile) => saveLocal(STORAGE_KEYS.syncProfile, profile),
  loadLastResult: () => loadLocal<SyncBase | null>(STORAGE_KEYS.syncLastResult, null),
  saveLastResult: (result: SyncBase) => saveLocal(STORAGE_KEYS.syncLastResult, result),
};

/** 解析同伴发来的快照文本/文件内容；格式不符时抛错交由合并流程重试与回退。 */
export function parseSnapshot(raw: string): SyncSnapshot {
  const parsed = JSON.parse(raw) as Partial<SyncSnapshot>;
  if (!parsed || !Array.isArray(parsed.trips) || !Array.isArray(parsed.dayPlans) || !Array.isArray(parsed.spots)) {
    throw new Error('INVALID_SNAPSHOT');
  }
  return {
    deviceId: String(parsed.deviceId || 'remote-device'),
    author: String(parsed.author || '同伴'),
    exportedAt: String(parsed.exportedAt || new Date().toISOString()),
    trips: parsed.trips,
    dayPlans: parsed.dayPlans,
    spots: parsed.spots,
    tombstones: parsed.tombstones || { trips: [], dayPlans: [], dayItems: [], spots: [] },
  };
}
