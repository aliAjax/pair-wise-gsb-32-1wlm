import type { FieldConflict } from '../../types/merge';
import { conflictKey } from '../../types/merge';
import { deepEqual } from './equality';

/** 带作者与修改时间的记录（Trip / DayPlan / DayPlanItem / Spot 的公共元信息） */
export interface Authored {
  author?: string;
  updated_at?: string;
}

interface MergeFieldsOptions<R, F extends string> {
  base: R | undefined;
  local: R | undefined;
  remote: R | undefined;
  fields: readonly F[];
  level: FieldConflict['level'];
  ownerId: string;
  dayIndex?: number;
  spotId?: string;
  /** 已确认的冲突键集合 */
  resolutions: Map<string, { choose?: 'local' | 'remote'; value?: unknown }>;
  /** 本次合并被确认掉的冲突键会追加到这里 */
  resolvedKeys: string[];
}

export interface MergeFieldsResult<R, F extends string> {
  merged: R | undefined;
  conflicts: FieldConflict<F>[];
}

const ts = (r: Authored | undefined) => r?.updated_at || '';
const authorOf = (r: Authored | undefined, fallback: string) => r?.author || fallback;
const later = (a: Authored | undefined, b: Authored | undefined) => (ts(a) >= ts(b) ? a : b);

/**
 * 字段级三路合并：
 * - 只有一侧改了某字段：直接生效（不冲突内容直接合入）；
 * - 两侧改成相同值：直接生效；
 * - 两侧都改且不同：保留两版等待确认；确认前该字段沿用祖先值（拿不到祖先则取本地值）。
 */
export function mergeFields<R extends Authored, F extends string>(
  options: MergeFieldsOptions<R, F>,
): MergeFieldsResult<R, F> {
  const { base, local, remote, fields } = options;
  const sides: ('local' | 'remote')[] = ['local', 'remote'];
  // 任一侧缺记录时由调用方裁决存在性，这里只处理字段。
  if (!local || !remote) return { merged: (local || remote) as R | undefined, conflicts: [] };

  const draft: Record<string, unknown> = { ...((base || {}) as Record<string, unknown>), ...(local as Record<string, unknown>) };
  const conflicts: FieldConflict<F>[] = [];

  for (const field of fields) {
    const bv = base ? (base as Record<string, unknown>)[field] : undefined;
    const lv = (local as Record<string, unknown>)[field];
    const rv = (remote as Record<string, unknown>)[field];
    const localChanged = !base || !deepEqual(lv, bv);
    const remoteChanged = !base || !deepEqual(rv, bv);

    let winner: unknown;
    if (!localChanged) winner = rv;
    else if (!remoteChanged) winner = lv;
    else if (deepEqual(lv, rv)) winner = lv;
    else {
      const key = conflictKey({ level: options.level, ownerId: options.ownerId, field, dayIndex: options.dayIndex, spotId: options.spotId });
      const resolution = options.resolutions.get(key);
      const conflict: FieldConflict<F> = {
        level: options.level,
        ownerId: options.ownerId,
        dayIndex: options.dayIndex,
        spotId: options.spotId,
        field,
        base: bv,
        local: lv,
        remote: rv,
        localAuthor: authorOf(local, '本地'),
        remoteAuthor: authorOf(remote, '同伴'),
        localUpdatedAt: ts(local),
        remoteUpdatedAt: ts(remote),
      };
      if (resolution) {
        winner = resolution.choose === 'remote' ? rv : resolution.choose === 'local' ? lv : resolution.value;
        options.resolvedKeys.push(key);
      } else {
        // 确认前：不确定字段不落任何一边的新值，回退祖先（或本地），预算/分享据此忽略整项
        winner = base ? bv : lv;
        conflicts.push(conflict);
      }
    }
    draft[field] = winner;
  }

  // 元信息：以实际贡献最新改动的一侧为准
  const metaSource = sides.reduce<Authored | undefined>((acc, side) => {
    const rec = side === 'local' ? local : remote;
    return acc ? later(acc, rec) : rec;
  }, undefined);
  draft.author = metaSource?.author || local.author || remote.author;
  draft.updated_at = metaSource?.updated_at || local.updated_at || remote.updated_at;

  return { merged: draft as R, conflicts };
}
