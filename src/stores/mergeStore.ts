import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type {
  ConflictResolution,
  FieldConflict,
  MergeInput,
  MergeResult,
  OfflineSnapshot,
} from '../types/merge';
import { EXISTENCE, ORDER, conflictKey } from '../types/merge';
import { mergeSnapshots } from '../utils/merge/engine';
import { withRetry } from '../utils/merge/retry';
import { buildPendingIndex, isOrderConflict, isRemovalConflict, type PendingIndex } from '../utils/merge/pending';
import { mergeApi } from '../api/mergeApi';
import { messages } from '../constants/messages';
import { toast } from '../utils/message';

/** 单次合并最多尝试次数（首跑 + 重试），仍失败则沿用上一份可读结果 */
const MAX_ATTEMPTS = 3;

export const useMergeStore = defineStore('merge', () => {
  const lastResult = ref<MergeResult | undefined>(mergeApi.loadPending() ?? mergeApi.loadLastGood());
  const merging = ref(false);
  const lastError = ref('');
  const attemptsUsed = ref(0);

  const pending = computed<PendingIndex>(() =>
    lastResult.value ? buildPendingIndex(lastResult.value.conflicts) : buildPendingIndex([]),
  );
  const conflicts = computed<FieldConflict[]>(() => lastResult.value?.conflicts ?? []);
  const hasPendingConflicts = computed(() => conflicts.value.length > 0);
  const lastGood = ref<MergeResult | undefined>(mergeApi.loadLastGood());

  /**
   * 执行离线合并。合并内部出现异常时重试，重试仍失败：
   * - 不覆盖已有数据，继续保留上一份可读结果（lastGood）；
   * - 返回 ok=false 并记录 lastError 供页面提示。
   */
  async function runMerge(input: MergeInput): Promise<MergeResult> {
    merging.value = true;
    lastError.value = '';
    try {
      const { result, tries } = await withRetry(() => mergeSnapshots(input), MAX_ATTEMPTS);
      attemptsUsed.value = tries;
      lastError.value = '';
      persistResult(result);
      merging.value = false;
      if (result.conflicts.length) toast.warn(messages.mergeConflictsPending);
      else toast.ok(messages.mergeClean);
      return result;
    } catch (error) {
      merging.value = false;
      attemptsUsed.value = MAX_ATTEMPTS;
      lastError.value = error instanceof Error ? error.message : String(error);
      // 关键：绝不用坏数据覆盖现有结果，继续展示上一份可读结果（lastGood）
      if (lastGood.value) lastResult.value = lastGood.value;
      toast.fail(messages.mergeFailedRetry);
      return buildUnreadablePlaceholder(lastError.value);
    }
  }

  /** 用当前确认结果重新合并（确认即重新跑一次合并，确认值落盘） */
  async function resolveConflict(resolution: ConflictResolution, input: MergeInput) {
    const previous = lastResult.value;
    const mergedResolutions = mergeResolutions(input.resolutions ?? [], [resolution]);
    const next = await runMerge({ ...input, resolutions: mergedResolutions });
    if (!next.ok && previous) {
      // 重算失败：恢复确认前的可读结果
      lastResult.value = previous;
    }
    return next;
  }

  /** 批量确认后重跑 */
  async function resolveAll(resolutions: ConflictResolution[], input: MergeInput) {
    return runMerge({ ...input, resolutions: mergeResolutions(input.resolutions ?? [], resolutions) });
  }

  function persistResult(result: MergeResult) {
    lastResult.value = result;
    if (result.ok) {
      lastGood.value = result;
      mergeApi.saveLastGood(result);
    }
    if (result.conflicts.length) mergeApi.savePending(result);
    else mergeApi.clearPending();
  }

  function clear() {
    lastResult.value = undefined;
    mergeApi.clearPending();
  }

  const fieldConflicts = computed(() => conflicts.value.filter((c) => !isRemovalConflict(c) && !isOrderConflict(c)));
  const removalConflicts = computed(() => conflicts.value.filter(isRemovalConflict));
  const orderConflicts = computed(() => conflicts.value.filter(isOrderConflict));

  return {
    lastResult,
    lastGood,
    merging,
    lastError,
    attemptsUsed,
    pending,
    conflicts,
    fieldConflicts,
    removalConflicts,
    orderConflicts,
    hasPendingConflicts,
    runMerge,
    resolveConflict,
    resolveAll,
    persistResult,
    clear,
  };
});

function mergeResolutions(existing: ConflictResolution[], additions: ConflictResolution[]): ConflictResolution[] {
  const map = new Map(existing.map((r) => [r.key, r]));
  for (const r of additions) map.set(r.key, r);
  return [...map.values()];
}

function buildUnreadablePlaceholder(error: string): MergeResult {
  return {
    mergedAt: new Date().toISOString(),
    ok: false,
    error,
    trips: [],
    dayPlans: [],
    spots: [],
    tripMerges: [],
    spotConflicts: [],
    conflicts: [],
    resolvedConflictKeys: [],
  };
}

export { conflictKey, EXISTENCE, ORDER };
export type { MergeInput, OfflineSnapshot };
