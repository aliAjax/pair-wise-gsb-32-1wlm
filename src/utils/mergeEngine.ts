import type { DayPlan, DayPlanItem } from '../models/dayPlan';
import type { Spot } from '../models/spot';
import type { Trip } from '../models/trip';
import type {
  ConflictVersion,
  DeletedRecord,
  MergeConflict,
  MergeField,
  MergeResult,
  SyncBase,
  SyncMeta,
  SyncSnapshot,
} from '../models/sync';

/**
 * 离线改动三方合并引擎（纯函数）。
 * base = 上次共同基线，local = 本机现状，remote = 同伴离线导出。
 * 约定：
 * - Trip 按 id 对齐；DayPlan 按 (trip_id, day_index) 对齐；同一日内 item 按 spot_id 对齐。
 * - 删除（墓碑）与移动分开判断：只有相对基线改了内容才算"编辑"，纯移动不算编辑。
 * - 非冲突改动直接合并；字段不一致或"删除 vs 编辑"保留两版，写入 conflicts 等待确认。
 */

type AnyObject = Record<string, unknown>;

const ITEM_META_FIELDS = ['updated_by', 'updated_at'] as const;

export const dayTombstoneId = (tripId: string, dayIndex: number) => `${tripId}#${dayIndex}`;
export const itemTombstoneId = (tripId: string, dayIndex: number, spotId: string) => `${tripId}#${dayIndex}#${spotId}`;

function nowIso() {
  return new Date().toISOString();
}

function asObject(record: unknown): AnyObject {
  return (record || {}) as AnyObject;
}

function metaOf(record?: unknown): SyncMeta {
  const r = asObject(record);
  return {
    updated_by: (r.updated_by as string) || '未署名',
    updated_at: (r.updated_at as string) || (r.created_at as string) || '',
  };
}

function stableClone(record: unknown, skip: Set<string>): AnyObject {
  const source = asObject(record);
  const clone: AnyObject = {};
  for (const key of Object.keys(source)) {
    if (!skip.has(key)) clone[key] = source[key];
  }
  return clone;
}

function deepEqual(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** 忽略作者/时间元数据，判断业务内容是否一致（数组按值比较）。 */
export function sameContent(a: unknown, b: unknown, skipMeta = true) {
  if (a === b) return true;
  if (!a || !b) return false;
  const skip = skipMeta ? new Set<string>(ITEM_META_FIELDS as unknown as string[]) : new Set<string>();
  return deepEqual(stableClone(a, skip), stableClone(b, skip));
}

function versionOf(record: unknown, fallbackAuthor: string): ConflictVersion {
  if (!record) return { author: fallbackAuthor, at: nowIso(), value: null };
  // 墓碑记录代表"删除"，冲突版本的值固定为 null，不把墓碑本身展示出去。
  if (typeof record === 'object' && 'deleted_at' in record) {
    const meta = metaOf(record);
    return { author: meta.updated_by || fallbackAuthor, at: (record as AnyObject).deleted_at as string || meta.updated_at, value: null };
  }
  const meta = metaOf(record);
  return { author: meta.updated_by, at: meta.updated_at, value: stableClone(record, new Set(ITEM_META_FIELDS)) };
}

function findTombstone(tombstones: DeletedRecord[], id: string) {
  return tombstones.find((t) => t.id === id);
}

export interface MergeCounter {
  added: number;
  updated: number;
  removed: number;
}

/**
 * 通用实体合并：Trip / Spot 复用。
 * @param keyOf 记录对齐键（Trip 用 id，Spot 用 id）
 * @param scalarFields 需要逐字段裁决的字段
 * @param unionFields 双方都改时取并集的数组字段（members / tags）
 */
function mergeEntities<T extends object>(opts: {
  entity: MergeConflict['entity'];
  local: T[];
  remote: T[];
  base: T[];
  tombstones: { local: DeletedRecord[]; remote: DeletedRecord[]; base: DeletedRecord[] };
  keyOf: (record: T) => string;
  scalarFields: MergeField[];
  unionFields?: MergeField[];
  conflicts: MergeConflict[];
  counter: MergeCounter;
  tripIdOf?: (record: T) => string | undefined;
}): { alive: T[]; deleted: DeletedRecord[] } {
  const { entity, keyOf, scalarFields, unionFields = [], conflicts, counter } = opts;
  const indexOf = (list: T[]) => new Map(list.map((record) => [keyOf(record), record]));
  const localMap = indexOf(opts.local);
  const remoteMap = indexOf(opts.remote);
  const baseMap = indexOf(opts.base);
  const keys = new Set<string>([...localMap.keys(), ...remoteMap.keys(), ...baseMap.keys()]);
  const alive: T[] = [];
  const deleted: DeletedRecord[] = [];
  const newTombstone = (id: string, meta: SyncMeta): DeletedRecord => ({
    id,
    deleted_at: meta.updated_at || nowIso(),
    updated_by: meta.updated_by,
    updated_at: meta.updated_at || nowIso(),
  });

  for (const key of keys) {
    const l = localMap.get(key);
    const r = remoteMap.get(key);
    const b = baseMap.get(key);
    const lTomb = findTombstone(opts.tombstones.local, key);
    const rTomb = findTombstone(opts.tombstones.remote, key);
    const lDeleted = !l && !!lTomb;
    const rDeleted = !r && !!rTomb;
    const wasAlive = !!b;
    const baseDeleted = !wasAlive && !!findTombstone(opts.tombstones.base, key);

    // 基线里就没有：一边新增。另一边若已删（加完又删），以删除为准且不算冲突。
    if (!wasAlive && !baseDeleted) {
      if (l && r) {
        if (sameContent(l, r)) {
          alive.push(l);
        } else {
          const merged = { ...l } as T & AnyObject;
          pushFieldConflicts(conflicts, {
            entity,
            entityId: key,
            tripId: opts.tripIdOf?.(l),
            base: undefined,
            local: l,
            remote: r,
            scalarFields,
            unionFields,
            applyTo: merged,
          });
          alive.push(merged as T);
        }
        counter.added += 1;
      } else if (l && !rDeleted) {
        alive.push(l);
        counter.added += 1;
      } else if (r && !lDeleted) {
        alive.push(r);
        counter.added += 1;
      }
      continue;
    }

    // 基线中存在（alive）：按删除 / 编辑组合裁决。
    const localState: 'alive' | 'deleted' | 'untouched' = l ? 'alive' : lDeleted ? 'deleted' : 'untouched';
    const remoteState: 'alive' | 'deleted' | 'untouched' = r ? 'alive' : rDeleted ? 'deleted' : 'untouched';

    if (localState === 'untouched' && remoteState === 'untouched') {
      if (b) alive.push(b);
      continue;
    }
    if (localState === 'deleted' && remoteState === 'deleted') {
      deleted.push(newTombstone(key, metaOf(lTomb || rTomb)));
      counter.removed += 1;
      continue;
    }
    if (localState === 'deleted' && remoteState === 'untouched') {
      deleted.push(newTombstone(key, metaOf(lTomb)));
      counter.removed += 1;
      continue;
    }
    if (remoteState === 'deleted' && localState === 'untouched') {
      deleted.push(newTombstone(key, metaOf(rTomb)));
      counter.removed += 1;
      continue;
    }
    // 删除 vs 编辑：保留两版（存在性冲突），暂存未删的那版但不进入确认视图。
    if (localState === 'deleted' && r) {
      conflicts.push({
        id: crypto.randomUUID(),
        entity,
        entityId: key,
        tripId: opts.tripIdOf?.(r),
        field: '__existence__',
        kind: 'existence',
        local: versionOf(lTomb, metaOf(lTomb).updated_by),
        remote: versionOf(r, '同伴'),
      });
      alive.push(r);
      counter.removed += 1;
      continue;
    }
    if (remoteState === 'deleted' && l) {
      conflicts.push({
        id: crypto.randomUUID(),
        entity,
        entityId: key,
        tripId: opts.tripIdOf?.(l),
        field: '__existence__',
        kind: 'existence',
        local: versionOf(l, '我'),
        remote: versionOf(rTomb, metaOf(rTomb).updated_by),
      });
      alive.push(l);
      counter.removed += 1;
      continue;
    }
    if (l && r) {
      if (sameContent(l, r)) {
        alive.push(l);
      } else if (b && sameContent(l, b) && !sameContent(r, b)) {
        alive.push(r);
        counter.updated += 1;
      } else if (b && sameContent(r, b) && !sameContent(l, b)) {
        alive.push(l);
        counter.updated += 1;
      } else {
        const merged = { ...l } as T & AnyObject;
        pushFieldConflicts(conflicts, {
          entity,
          entityId: key,
          tripId: opts.tripIdOf?.(l),
          base: b,
          local: l,
          remote: r,
          scalarFields,
          unionFields,
          applyTo: merged,
        });
        alive.push(merged as T);
        counter.updated += 1;
      }
    }
  }

  // 基线里已有的墓碑继续带下去（压缩留给后续，合并阶段不丢删除信息）。
  for (const tomb of opts.tombstones.base) {
    if (!deleted.some((item) => item.id === tomb.id) && !alive.some((item) => keyOf(item) === tomb.id)) {
      deleted.push(tomb);
    }
  }
  return { alive, deleted };
}

function pushFieldConflicts(conflicts: MergeConflict[], opts: {
  entity: MergeConflict['entity'];
  entityId: string;
  tripId?: string;
  dayId?: string;
  dayIndex?: number;
  spotId?: string;
  base?: unknown;
  local: unknown;
  remote: unknown;
  scalarFields: MergeField[];
  unionFields: MergeField[];
  applyTo: AnyObject;
}) {
  const l = asObject(opts.local);
  const r = asObject(opts.remote);
  const b = opts.base ? asObject(opts.base) : undefined;
  for (const field of opts.scalarFields) {
    const lv = l[field];
    const rv = r[field];
    if (deepEqual(lv, rv)) {
      opts.applyTo[field] = lv;
      continue;
    }
    if (b && deepEqual(lv, b[field])) {
      opts.applyTo[field] = rv;
      continue;
    }
    if (b && deepEqual(rv, b[field])) {
      opts.applyTo[field] = lv;
      continue;
    }
    // 双方都改且不一致：暂存本机版本，冲突留两版等待确认。
    opts.applyTo[field] = lv;
    const lm = metaOf(l);
    const rm = metaOf(r);
    conflicts.push({
      id: crypto.randomUUID(),
      entity: opts.entity,
      entityId: opts.entityId,
      tripId: opts.tripId,
      dayId: opts.dayId,
      dayIndex: opts.dayIndex,
      spotId: opts.spotId,
      field,
      kind: 'field',
      local: { author: lm.updated_by, at: lm.updated_at, value: lv },
      remote: { author: rm.updated_by, at: rm.updated_at, value: rv },
    });
  }
  for (const field of opts.unionFields) {
    const mergedArray = Array.from(new Set([...((l[field] as unknown[]) || []), ...((r[field] as unknown[]) || [])]));
    opts.applyTo[field] = mergedArray;
  }
}

// ---------------------------------------------------------------------------
// 顺序合并：删除与移动分开。把"本机相对基线"和"同伴相对基线"的顺序变化各自抽成
// 约束（移动条目之间的相对顺序），再用约束拓扑排序融合；约束冲突（环）时由条目
// 更新时间（更晚的移动，作者随元数据）裁决，绝不整组覆盖任一方的顺序。
// ---------------------------------------------------------------------------

function lcsIndices(left: string[], right: string[]): Array<[number, number]> {
  const dp: number[][] = Array.from({ length: left.length + 1 }, () => new Array(right.length + 1).fill(0));
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      dp[i][j] = left[i] === right[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      pairs.push([i, j]);
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return pairs;
}

/** 相对基线被移动过的共同条目（LCS 之外即位置变化；纯新增不算移动）。 */
function movedSet(sideOrder: string[], baseOrder: string[]): Set<string> {
  const sideCommon = sideOrder.filter((id) => baseOrder.includes(id));
  const baseCommon = baseOrder.filter((id) => sideOrder.includes(id));
  const pairs = lcsIndices(sideCommon, baseCommon);
  const stable = new Set(pairs.map(([si]) => sideCommon[si]));
  return new Set(sideCommon.filter((id) => !stable.has(id)));
}

/**
 * 合并同一天内的景点顺序（删除已在更上游处理，这里只排存活条目）。
 *
 * 锚点插入法：
 * - 未被主张移动的条目先按基线顺序铺好；
 * - 只被一侧移动/新增的条目，按该侧序列里的相邻锚点插入，另一侧顺序原样保留；
 * - 两侧都移动同一批条目且主张冲突时，由条目 updated_at 更晚一方的序列统一裁决；
 * - 任何没有主张的相对关系都回落到基线名次，绝不整组覆盖任一方顺序。
 */
export function mergeDayOrder(opts: {
  local: DayPlanItem[];
  remote: DayPlanItem[];
  base: DayPlanItem[];
}): DayPlanItem[] {
  const { local, remote, base } = opts;
  const localOrder = local.map((item) => item.spot_id);
  const remoteOrder = remote.map((item) => item.spot_id);
  const baseOrder = base.map((item) => item.spot_id);

  const itemMap = new Map<string, DayPlanItem>();
  for (const item of base) itemMap.set(item.spot_id, item);
  for (const item of local) itemMap.set(item.spot_id, item);
  for (const item of remote) itemMap.set(item.spot_id, item);

  const survivors = new Set([...localOrder, ...remoteOrder]);
  const baseRank = new Map((baseOrder.length ? baseOrder : [...localOrder, ...remoteOrder]).map((id, index) => [id, index]));
  const movedLocal = movedSet(localOrder, baseOrder);
  const movedRemote = movedSet(remoteOrder, baseOrder);
  const localMoveTime = Math.max(...local.filter((i) => movedLocal.has(i.spot_id)).map((i) => Date.parse(metaOf(i).updated_at) || 0), 0);
  const remoteMoveTime = Math.max(...remote.filter((i) => movedRemote.has(i.spot_id)).map((i) => Date.parse(metaOf(i).updated_at) || 0), 0);
  const localWinsMove = localMoveTime >= remoteMoveTime;

  // 每个被移动/新增的条目选择主张侧：只有一侧动 => 听该侧；两侧都动 => 时间晚者胜。
  const preferred = new Map<string, { side: 1 | 2; rank: number }>();
  localOrder.forEach((id, rank) => {
    const moved = movedLocal.has(id) || !baseRank.has(id);
    if (!moved) return;
    if (movedRemote.has(id) && !localWinsMove) return;
    if (!preferred.has(id)) preferred.set(id, { side: 1, rank });
  });
  remoteOrder.forEach((id, rank) => {
    const moved = movedRemote.has(id) || !baseRank.has(id);
    if (!moved) return;
    if (movedLocal.has(id) && localWinsMove) return;
    preferred.set(id, { side: 2, rank });
  });

  // 未被主张的条目按基线顺序铺底。
  const result: string[] = [...survivors]
    .filter((id) => !preferred.has(id))
    .sort((a, b) => (baseRank.get(a) ?? Number.MAX_SAFE_INTEGER) - (baseRank.get(b) ?? Number.MAX_SAFE_INTEGER));

  const insertions = [...preferred.entries()]
    .map(([id, pref]) => ({ id, ...pref }))
    .sort((a, b) => a.rank - b.rank || (baseRank.get(a.id) ?? 0) - (baseRank.get(b.id) ?? 0));

  for (const { id, side, rank } of insertions) {
    const order = side === 1 ? localOrder : remoteOrder;
    let insertAt = -1;
    // 前锚点：该侧序列中前一个存活且已放置的条目。
    for (let k = rank - 1; k >= 0 && insertAt < 0; k -= 1) {
      const anchor = result.indexOf(order[k]);
      if (survivors.has(order[k]) && anchor >= 0) insertAt = anchor + 1;
    }
    // 后锚点兜底。
    for (let k = rank + 1; k < order.length && insertAt < 0; k += 1) {
      const anchor = result.indexOf(order[k]);
      if (survivors.has(order[k]) && anchor >= 0) insertAt = anchor;
    }
    const existed = result.indexOf(id);
    if (existed >= 0) result.splice(existed, 1);
    result.splice(insertAt < 0 ? result.length : insertAt, 0, id);
  }

  return result.map((id) => itemMap.get(id)!).filter(Boolean);
}

// ---------------------------------------------------------------------------
// DayPlan 合并：按 (trip_id, day_index) 对齐；同一日内 items 按 spot_id 逐项对齐，
// 删除与移动分开判断，顺序最后交给 mergeDayOrder。
// ---------------------------------------------------------------------------

const DAY_SCALAR_FIELDS: MergeField[] = ['date'];
const ITEM_SCALAR_FIELDS: MergeField[] = ['start_time', 'end_time', 'note', 'transport'];

/** 规范化一天：去掉 id/元数据，景点按 spot_id 排序，使"纯移动顺序"不被当作内容编辑。 */
function canonicalDay(day: DayPlan): AnyObject {
  return {
    trip_id: day.trip_id,
    day_index: day.day_index,
    date: day.date,
    items: [...day.items]
      .map((item) => stableClone(item, new Set<string>(ITEM_META_FIELDS as unknown as string[])))
      .sort((a, b) => String(a.spot_id).localeCompare(String(b.spot_id))),
  };
}

type ItemTombTuple = { tripId: string; dayIndex: number; spotId: string; tomb: DeletedRecord };

function parseItemTombstone(tomb: DeletedRecord): ItemTombTuple | null {
  const parts = tomb.id.split('#');
  if (parts.length !== 3) return null;
  return { tripId: parts[0], dayIndex: Number(parts[1]), spotId: parts[2], tomb };
}

function itemTombOf(list: DeletedRecord[], tripId: string, dayIndex: number, spotId: string) {
  return list.find((t) => t.id === itemTombstoneId(tripId, dayIndex, spotId));
}

function mergeDayPlans(opts: {
  local: DayPlan[];
  remote: DayPlan[];
  base: DayPlan[];
  /** 整天墓碑（id 形如 tripId#dayIndex）与景点条目墓碑（tripId#dayIndex#spotId）分组传入。 */
  dayTombstones: { local: DeletedRecord[]; remote: DeletedRecord[]; base: DeletedRecord[] };
  itemTombstoneList: { local: DeletedRecord[]; remote: DeletedRecord[]; base: DeletedRecord[] };
  conflicts: MergeConflict[];
  counter: MergeCounter;
}): { alive: DayPlan[]; deleted: DeletedRecord[] } {
  const { conflicts, counter } = opts;
  const keyOf = (day: DayPlan) => dayTombstoneId(day.trip_id, day.day_index);
  const indexOf = (list: DayPlan[]) => new Map(list.map((day) => [keyOf(day), day]));
  const localMap = indexOf(opts.local);
  const remoteMap = indexOf(opts.remote);
  const baseMap = indexOf(opts.base);
  const keys = new Set([...localMap.keys(), ...remoteMap.keys(), ...baseMap.keys()]);
  const alive: DayPlan[] = [];
  const deleted: DeletedRecord[] = [];
  const emittedItemTombstones: DeletedRecord[] = [];
  const newDayTomb = (key: string, source: SyncMeta): DeletedRecord => ({
    id: key,
    deleted_at: source.updated_at || nowIso(),
    updated_by: source.updated_by,
    updated_at: source.updated_at || nowIso(),
  });
  const pushItemTomb = (tripId: string, dayIndex: number, spotId: string, source: SyncMeta) => {
    const tomb: DeletedRecord = {
      id: itemTombstoneId(tripId, dayIndex, spotId),
      deleted_at: source.updated_at || nowIso(),
      updated_by: source.updated_by,
      updated_at: source.updated_at || nowIso(),
    };
    if (!emittedItemTombstones.some((item) => item.id === tomb.id)) emittedItemTombstones.push(tomb);
  };

  const itemTombstones = {
    local: opts.itemTombstoneList.local.map(parseItemTombstone).filter(Boolean) as ItemTombTuple[],
    remote: opts.itemTombstoneList.remote.map(parseItemTombstone).filter(Boolean) as ItemTombTuple[],
    base: opts.itemTombstoneList.base.map(parseItemTombstone).filter(Boolean) as ItemTombTuple[],
  };

  for (const key of keys) {
    const [tripId, dayIndexRaw] = key.split('#');
    const dayIndex = Number(dayIndexRaw);
    const l = localMap.get(key);
    const r = remoteMap.get(key);
    const b = baseMap.get(key);
    const lDayTomb = findTombstone(opts.dayTombstones.local, key);
    const rDayTomb = findTombstone(opts.dayTombstones.remote, key);
    const dayId = l?.id || r?.id || b?.id || crypto.randomUUID();

    // 一天的新增（基线没有这一天）。
    if (!b) {
      if (l && r) {
        alive.push(mergeOneDay({ tripId, dayIndex, dayId, base: undefined, local: l, remote: r, conflicts, counter, itemTombstoneList: opts.itemTombstoneList, pushItemTomb }));
      } else if (l) {
        alive.push(l);
        counter.added += 1;
      } else if (r) {
        alive.push(r);
        counter.added += 1;
      } else if (lDayTomb || rDayTomb) {
        deleted.push(newDayTomb(key, metaOf(lDayTomb || rDayTomb)));
      }
      continue;
    }

    const lState: 'alive' | 'deleted' | 'untouched' = l ? 'alive' : lDayTomb ? 'deleted' : 'untouched';
    const rState: 'alive' | 'deleted' | 'untouched' = r ? 'alive' : rDayTomb ? 'deleted' : 'untouched';

    // 删除整天 vs 未动（含纯调序也算明确改动）：
    // - 另一侧内容（日期/景点）与顺序都没动 => 删除直接生效；
    // - 另一侧动过内容或顺序 => 删除与改动意图冲突，保留两版。
    const dayChanged = (day: DayPlan) => {
      const contentChanged = !sameContent(canonicalDay(day), canonicalDay(b));
      const sameOrder = JSON.stringify(day.items.map((i) => i.spot_id)) === JSON.stringify(b.items.map((i) => i.spot_id));
      return contentChanged || !sameOrder;
    };
    if (lState === 'deleted' && (rState === 'deleted' || (r && !dayChanged(r)))) {
      deleted.push(newDayTomb(key, metaOf(lDayTomb || rDayTomb)));
      counter.removed += 1;
      continue;
    }
    if (rState === 'deleted' && l && !dayChanged(l)) {
      deleted.push(newDayTomb(key, metaOf(rDayTomb)));
      counter.removed += 1;
      continue;
    }
    if (lState === 'deleted' && r) {
      conflicts.push({
        id: crypto.randomUUID(),
        entity: 'dayPlan',
        entityId: dayId,
        tripId,
        dayId,
        dayIndex,
        field: '__existence__',
        kind: 'existence',
        local: versionOf(lDayTomb, metaOf(lDayTomb).updated_by),
        remote: versionOf(r, '同伴'),
      });
      alive.push(r);
      counter.removed += 1;
      continue;
    }
    if (rState === 'deleted' && l) {
      conflicts.push({
        id: crypto.randomUUID(),
        entity: 'dayPlan',
        entityId: dayId,
        tripId,
        dayId,
        dayIndex,
        field: '__existence__',
        kind: 'existence',
        local: versionOf(l, '我'),
        remote: versionOf(rDayTomb, metaOf(rDayTomb).updated_by),
      });
      alive.push(l);
      counter.removed += 1;
      continue;
    }
    if (lState === 'untouched' && rState === 'untouched') {
      alive.push(b);
      continue;
    }
    if (l && r) {
      alive.push(mergeOneDay({ tripId, dayIndex, dayId, base: b, local: l, remote: r, conflicts, counter, itemTombstoneList: opts.itemTombstoneList, pushItemTomb }));
    } else if (l) {
      alive.push(l);
    } else if (r) {
      alive.push(r);
    }
  }

  // 基线里的整天墓碑与景点墓碑都继续带下去，避免再次同步时"删除复活"。
  for (const tomb of [...opts.dayTombstones.base, ...opts.itemTombstoneList.base]) {
    if (!deleted.some((item) => item.id === tomb.id) && !alive.some((day) => keyOf(day) === tomb.id)) {
      deleted.push(tomb);
    }
  }
  return { alive, deleted: [...deleted, ...emittedItemTombstones] };
}

function mergeOneDay(opts: {
  tripId: string;
  dayIndex: number;
  dayId: string;
  base?: DayPlan;
  local: DayPlan;
  remote: DayPlan;
  conflicts: MergeConflict[];
  counter: MergeCounter;
  itemTombstoneList: { local: DeletedRecord[]; remote: DeletedRecord[]; base: DeletedRecord[] };
  pushItemTomb: (tripId: string, dayIndex: number, spotId: string, source: SyncMeta) => void;
}): DayPlan {
  const { tripId, dayIndex, dayId, base, local: l, remote: r, conflicts, counter, itemTombstoneList, pushItemTomb } = opts;
  const newer = (l.updated_at || '') > (r.updated_at || '') ? l : r;
  const merged: DayPlan = {
    id: dayId,
    trip_id: tripId,
    day_index: dayIndex,
    date: l.date,
    items: [],
    updated_by: metaOf(newer).updated_by,
    updated_at: metaOf(newer).updated_at,
  };

  pushFieldConflicts(conflicts, {
    entity: 'dayPlan',
    entityId: dayId,
    tripId,
    dayId,
    dayIndex,
    base,
    local: l,
    remote: r,
    scalarFields: DAY_SCALAR_FIELDS,
    unionFields: [],
    applyTo: merged as unknown as AnyObject,
  });

  const baseItems = base?.items || [];
  const itemIndex = (list: DayPlanItem[]) => new Map(list.map((item) => [item.spot_id, item]));
  const li = itemIndex(l.items);
  const ri = itemIndex(r.items);
  const bi = itemIndex(baseItems);
  const spotIds = new Set([...li.keys(), ...ri.keys(), ...bi.keys()]);
  const keptLocal: DayPlanItem[] = [];
  const keptRemote: DayPlanItem[] = [];
  const keptBase: DayPlanItem[] = [];

  for (const spotId of spotIds) {
    const itemL = li.get(spotId);
    const itemR = ri.get(spotId);
    const itemB = bi.get(spotId);
    const tombL = itemTombOf(itemTombstoneList.local, tripId, dayIndex, spotId);
    const tombR = itemTombOf(itemTombstoneList.remote, tripId, dayIndex, spotId);
    const wasAlive = !!itemB;

    if (!wasAlive) {
      if (itemL && itemR) {
        if (sameContent(itemL, itemR)) {
          keptLocal.push(itemL);
          keptRemote.push(itemR);
          keptBase.push(itemL);
          counter.added += 1;
        } else {
          const newItem: DayPlanItem = { ...itemL };
          pushFieldConflicts(conflicts, {
            entity: 'dayItem',
            entityId: dayId,
            tripId,
            dayId,
            dayIndex,
            spotId,
            base: undefined,
            local: itemL,
            remote: itemR,
            scalarFields: ITEM_SCALAR_FIELDS,
            unionFields: [],
            applyTo: newItem as unknown as AnyObject,
          });
          keptLocal.push(newItem);
          keptRemote.push(itemR);
          counter.added += 1;
        }
      } else if (itemL) {
        keptLocal.push(itemL);
        counter.added += 1;
      } else if (itemR) {
        keptRemote.push(itemR);
        counter.added += 1;
      }
      continue;
    }

    const lState = itemL ? 'alive' : tombL ? 'deleted' : 'untouched';
    const rState = itemR ? 'alive' : tombR ? 'deleted' : 'untouched';
    // 移动与删除是两种独立意图：另一侧只要移动过（相对基线位置变化）或改过内容，
    // 就不能被静默删除，保留两版等待确认；只有另一侧完全未动时删除才直接生效。
    const lOrderIds = l.items.map((item) => item.spot_id);
    const rOrderIds = r.items.map((item) => item.spot_id);
    const bOrderIds = baseItems.map((item) => item.spot_id);
    const localMovedItems = movedSet(lOrderIds, bOrderIds);
    const remoteMovedItems = movedSet(rOrderIds, bOrderIds);

    if (lState === 'deleted' || rState === 'deleted') {
      const other = lState === 'deleted' ? itemR : itemL;
      const otherTomb = lState === 'deleted' ? tombL : tombR;
      const otherMoved = lState === 'deleted' ? remoteMovedItems.has(spotId) : localMovedItems.has(spotId);
      const otherEdited = other ? !sameContent(other, itemB) : false;
      const otherClaimed = other && (otherEdited || otherMoved);
      const bothDeleted = lState === 'deleted' && rState === 'deleted';
      if (bothDeleted || !otherClaimed) {
        const source = otherTomb || (lState === 'deleted' ? tombL : tombR);
        pushItemTomb(tripId, dayIndex, spotId, metaOf(source));
        counter.removed += 1;
        continue;
      }
      conflicts.push({
        id: crypto.randomUUID(),
        entity: 'dayItem',
        entityId: dayId,
        tripId,
        dayId,
        dayIndex,
        spotId,
        field: '__existence__',
        kind: 'existence',
        local: lState === 'deleted' ? versionOf(tombL, metaOf(tombL).updated_by) : versionOf(itemL, '我'),
        remote: rState === 'deleted' ? versionOf(tombR, metaOf(tombR).updated_by) : versionOf(itemR, '同伴'),
      });
      if (itemL) keptLocal.push(itemL);
      if (itemR) keptRemote.push(itemR);
      counter.removed += 1;
      continue;
    }

    if (lState === 'untouched' && rState === 'untouched') {
      if (itemB) {
        keptLocal.push(itemB);
        keptRemote.push(itemB);
        keptBase.push(itemB);
      }
      continue;
    }
    if (itemL && itemR) {
      if (sameContent(itemL, itemR)) {
        keptLocal.push(itemL);
        keptRemote.push(itemR);
        keptBase.push(itemB || itemL);
      } else if (sameContent(itemL, itemB)) {
        keptLocal.push(itemR);
        keptRemote.push(itemR);
        keptBase.push(itemB || itemR);
        counter.updated += 1;
      } else if (sameContent(itemR, itemB)) {
        keptLocal.push(itemL);
        keptRemote.push(itemL);
        keptBase.push(itemB || itemL);
        counter.updated += 1;
      } else {
        const newItem: DayPlanItem = { ...itemL };
        pushFieldConflicts(conflicts, {
          entity: 'dayItem',
          entityId: dayId,
          tripId,
          dayId,
          dayIndex,
          spotId,
          base: itemB,
          local: itemL,
          remote: itemR,
          scalarFields: ITEM_SCALAR_FIELDS,
          unionFields: [],
          applyTo: newItem as unknown as AnyObject,
        });
        keptLocal.push(newItem);
        keptRemote.push(itemR);
        keptBase.push(itemB);
        counter.updated += 1;
      }
    } else if (itemL) {
      // 只在一侧存活（同伴没动它）：两侧序列都带上，顺序合并不会丢条目。
      keptLocal.push(itemL);
      keptRemote.push(itemL);
      if (itemB) keptBase.push(itemB);
    } else if (itemR) {
      keptLocal.push(itemR);
      keptRemote.push(itemR);
      if (itemB) keptBase.push(itemB);
    }
  }

  merged.items = mergeDayOrder({ local: keptLocal, remote: keptRemote, base: keptBase });
  return merged;
}

// ---------------------------------------------------------------------------
// 入口：把快照归一成三方输入，逐实体合并。
// ---------------------------------------------------------------------------

type TombstoneGroups = SyncBase['tombstones'];

function emptyTombstones(): TombstoneGroups {
  return { trips: [], dayPlans: [], dayItems: [], spots: [] };
}

function snapshotBasket(snapshot: Partial<SyncSnapshot> | null | undefined): {
  trips: Trip[];
  dayPlans: DayPlan[];
  spots: Spot[];
  tombstones: TombstoneGroups;
} {
  return {
    trips: snapshot?.trips || [],
    dayPlans: snapshot?.dayPlans || [],
    spots: snapshot?.spots || [],
    tombstones: snapshot?.tombstones || emptyTombstones(),
  };
}

/** 供导出/演示复用：把基线里有、本机现状没有的记录补成本机墓碑。 */
export function inferLocalTombstones(input: {
  trips: Trip[];
  dayPlans: DayPlan[];
  spots: Spot[];
  base: SyncBase | null;
  author: string;
}): TombstoneGroups {
  const result: TombstoneGroups = {
    trips: input.base ? [...input.base.tombstones.trips] : [],
    dayPlans: input.base ? [...input.base.tombstones.dayPlans] : [],
    dayItems: input.base ? [...input.base.tombstones.dayItems] : [],
    spots: input.base ? [...input.base.tombstones.spots] : [],
  };
  const stamp = (id: string): DeletedRecord => ({
    id,
    deleted_at: nowIso(),
    updated_by: input.author,
    updated_at: nowIso(),
  });
  if (!input.base) return result;

  const tripIds = new Set(input.trips.map((trip) => trip.id));
  for (const trip of input.base.trips) {
    if (!tripIds.has(trip.id) && !result.trips.some((t) => t.id === trip.id)) {
      result.trips.push(stamp(trip.id));
    }
  }
  const dayKeys = new Set(input.dayPlans.map((day) => dayTombstoneId(day.trip_id, day.day_index)));
  for (const day of input.base.dayPlans) {
    const key = dayTombstoneId(day.trip_id, day.day_index);
    if (!dayKeys.has(key) && !result.dayPlans.some((t) => t.id === key)) {
      result.dayPlans.push(stamp(key));
    }
  }
  const spotIds = new Set(input.spots.map((spot) => spot.id));
  for (const spot of input.base.spots) {
    if (!spotIds.has(spot.id) && !result.spots.some((t) => t.id === spot.id)) {
      result.spots.push(stamp(spot.id));
    }
  }
  for (const day of input.base.dayPlans) {
    const current = input.dayPlans.find((item) => item.trip_id === day.trip_id && item.day_index === day.day_index);
    for (const baseItem of day.items) {
      const id = itemTombstoneId(day.trip_id, day.day_index, baseItem.spot_id);
      const stillThere = current?.items.some((item) => item.spot_id === baseItem.spot_id);
      if (!stillThere && !result.dayItems.some((t) => t.id === id)) {
        result.dayItems.push(stamp(id));
      }
    }
  }
  return result;
}

export function mergeSnapshots(local: SyncSnapshot, remote: SyncSnapshot, base: SyncBase | null): MergeResult {
  const l = snapshotBasket(local);
  const r = snapshotBasket(remote);
  const b = snapshotBasket(base);
  const conflicts: MergeConflict[] = [];
  const counter: MergeCounter = { added: 0, updated: 0, removed: 0 };

  const tripMerge = mergeEntities<Trip>({
    entity: 'trip',
    local: l.trips,
    remote: r.trips,
    base: b.trips,
    tombstones: { local: l.tombstones.trips, remote: r.tombstones.trips, base: b.tombstones.trips },
    keyOf: (trip) => trip.id,
    scalarFields: ['title', 'destination', 'start_date', 'end_date', 'budget', 'currency', 'status'],
    unionFields: ['members'],
    conflicts,
    counter,
  });

  const spotMerge = mergeEntities<Spot>({
    entity: 'spot',
    local: l.spots,
    remote: r.spots,
    base: b.spots,
    tombstones: { local: l.tombstones.spots, remote: r.tombstones.spots, base: b.tombstones.spots },
    keyOf: (spot) => spot.id,
    scalarFields: ['name', 'category', 'address', 'lat', 'lng', 'rating', 'price', 'open_time', 'image'],
    unionFields: ['tags'],
    conflicts,
    counter,
  });

  const dayMerge = mergeDayPlans({
    local: l.dayPlans,
    remote: r.dayPlans,
    base: b.dayPlans,
    dayTombstones: {
      local: l.tombstones.dayPlans,
      remote: r.tombstones.dayPlans,
      base: b.tombstones.dayPlans,
    },
    itemTombstoneList: {
      local: l.tombstones.dayItems,
      remote: r.tombstones.dayItems,
      base: b.tombstones.dayItems,
    },
    conflicts,
    counter,
  });

  return {
    trips: tripMerge.alive,
    spots: spotMerge.alive,
    dayPlans: dayMerge.alive,
    tombstones: {
      trips: tripMerge.deleted,
      spots: spotMerge.deleted,
      dayPlans: dayMerge.deleted.filter((t) => t.id.split('#').length === 2),
      dayItems: dayMerge.deleted.filter((t) => t.id.split('#').length === 3),
    },
    conflicts,
    stats: { ...counter, conflicts: conflicts.length },
  };
}
