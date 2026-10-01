import type { ConflictResolution, MergeResult, OfflineSnapshot } from '../types/merge';
import { STORAGE_KEYS } from '../constants/storageVersion';
import { loadLocal, saveLocal } from '../utils/storage';

/** 合并持久化：快照、待确认冲突、上一份可读结果分别独立存储，互不覆盖 */
export const mergeApi = {
  saveSnapshot(slot: 'local' | 'remote' | 'base', snapshot: OfflineSnapshot) {
    saveLocal(STORAGE_KEYS.mergeSnapshot(slot), snapshot);
  },
  loadSnapshot(slot: 'local' | 'remote' | 'base'): OfflineSnapshot | undefined {
    return loadLocal<OfflineSnapshot | undefined>(STORAGE_KEYS.mergeSnapshot(slot), undefined);
  },
  clearSnapshots() {
    (['local', 'remote', 'base'] as const).forEach((slot) => localStorage.removeItem(STORAGE_KEYS.mergeSnapshot(slot)));
  },

  /** 上一份成功的可读合并结果：合并失败重试时继续沿用，绝不丢给用户坏数据 */
  saveLastGood(result: MergeResult) {
    saveLocal(STORAGE_KEYS.lastGoodMerge, result);
  },
  loadLastGood(): MergeResult | undefined {
    return loadLocal<MergeResult | undefined>(STORAGE_KEYS.lastGoodMerge, undefined);
  },

  savePending(result: MergeResult) {
    saveLocal(STORAGE_KEYS.pendingMerge, result);
  },
  loadPending(): MergeResult | undefined {
    return loadLocal<MergeResult | undefined>(STORAGE_KEYS.pendingMerge, undefined);
  },
  clearPending() {
    localStorage.removeItem(STORAGE_KEYS.pendingMerge);
  },

  loadResolutions(): ConflictResolution[] {
    return loadLocal<ConflictResolution[]>(STORAGE_KEYS.mergeResolutions, []);
  },
  saveResolutions(resolutions: ConflictResolution[]) {
    saveLocal(STORAGE_KEYS.mergeResolutions, resolutions);
  },
  clearResolutions() {
    localStorage.removeItem(STORAGE_KEYS.mergeResolutions);
  },
};
