import type {
  ConflictResolution,
  DayMerge,
  FieldConflict,
  ItemMerge,
  MergeInput,
  MergeResult,
  OfflineSnapshot,
  OrderConflict,
  TripMerge,
} from '../../types/merge';
import { conflictKey, EXISTENCE, ORDER } from '../../types/merge';
import type { DayPlan, DayPlanItem } from '../../models/dayPlan';
import { DAY_PLAN_FIELDS, DAY_PLAN_ITEM_FIELDS } from '../../models/dayPlan';
import type { Spot } from '../../models/spot';
import { SPOT_FIELDS } from '../../models/spot';
import { TRIP_FIELDS } from '../../models/trip';
import type { Trip } from '../../models/trip';
import { mergeFields } from './threeWay';
import { mergeItemOrders, type OrderSideView } from './order';

const nowIso = () => new Date().toISOString();
const byId = <T extends { id: string }>(list: T[]) => new Map(list.map((x) => [x.id, x]));
const dayKeyOf = (d: Pick<DayPlan, 'trip_id' | 'day_index'>) => `${d.trip_id}#${d.day_index}`;

/** 把冲突转成拍平后统一的 FieldConflict 形态（顺序冲突用 ORDER 字段表达） */
function orderConflictToField(tripId: string, c: OrderConflict): FieldConflict {
  return {
    level: 'item',
    ownerId: tripId,
    dayIndex: c.localDayIndex,
    spotId: c.spotId,
    field: ORDER,
    base: null,
    local: { dayIndex: c.localDayIndex, order: c.localOrder, prev: c.localPrevSpotId, next: c.localNextSpotId },
    remote: { dayIndex: c.remoteDayIndex, order: c.remoteOrder, prev: c.remotePrevSpotId, next: c.remoteNextSpotId },
    localAuthor: c.localAuthor,
    remoteAuthor: c.remoteAuthor,
    localUpdatedAt: '',
    remoteUpdatedAt: '',
  };
}

function buildOrderView(dayPlans: DayPlan[]): OrderSideView {
  const dayIndexOf = new Map<string, number>();
  const items = new Map<string, DayPlanItem>();
  const days = new Map<number, string[]>();
  for (const day of dayPlans) {
    if (!days.has(day.day_index)) days.set(day.day_index, []);
    for (const item of day.items) {
      dayIndexOf.set(item.spot_id, day.day_index);
      items.set(item.spot_id, item);
      days.get(day.day_index)!.push(item.spot_id);
    }
  }
  return { dayIndexOf, items, days };
}

/** 构建同一 trip 的顺序视图（只含该 trip 的天） */
function buildTripOrderView(dayPlans: DayPlan[], tripId: string): OrderSideView {
  return buildOrderView(dayPlans.filter((d) => d.trip_id === tripId));
}

export function mergeSnapshots(input: MergeInput): MergeResult {
  const { local, remote } = input;
  const base = input.base;
  const resolutions = new Map<string, ConflictResolution>(
    (input.resolutions ?? []).map((r) => [r.key, r]),
  );
  const resolvedConflictKeys: string[] = [];

  // ---- 1. 景点（Spot）逐项字段合并 ----
  const spotResult = mergeSpots(base?.spots ?? [], local.spots, remote.spots, resolutions, resolvedConflictKeys);

  // ---- 2. 旅行计划（Trip）字段合并 + 其下每日行程 ----
  const tripMerges: TripMerge[] = [];
  const mergedTrips: Trip[] = [];
  const mergedDaysAcc: DayPlan[] = [];
  const allConflicts: FieldConflict[] = [...spotResult.conflicts];

  const tripIds = new Set([...local.trips.map((t) => t.id), ...remote.trips.map((t) => t.id)]);
  for (const tripId of tripIds) {
    const lt = byId(local.trips).get(tripId);
    const rt = byId(remote.trips).get(tripId);
    const bt = base ? byId(base.trips).get(tripId) : undefined;
    const tm = mergeOneTrip(tripId, bt, lt, rt, base, local, remote, resolutions, resolvedConflictKeys);
    tripMerges.push(tm);
    if (tm.trip) mergedTrips.push(tm.trip);
    for (const dm of tm.days) if (dm.day) mergedDaysAcc.push(dm.day);
    for (const c of tm.conflicts) allConflicts.push(c as FieldConflict);
    for (const dm of tm.days) {
      allConflicts.push(...dm.fieldConflicts);
      for (const im of dm.items) allConflicts.push(...im.conflicts);
      for (const oc of dm.orderConflicts) allConflicts.push(orderConflictToField(tripId, oc));
    }
  }

  return {
    mergedAt: nowIso(),
    ok: true,
    trips: mergedTrips,
    dayPlans: mergedDaysAcc,
    spots: spotResult.spots,
    tripMerges,
    spotConflicts: spotResult.conflicts,
    conflicts: allConflicts,
    resolvedConflictKeys,
  };
}

// ---------------- Spot ----------------

function mergeSpots(
  base: Spot[],
  local: Spot[],
  remote: Spot[],
  resolutions: Map<string, ConflictResolution>,
  resolvedKeys: string[],
) {
  const spots: Spot[] = [];
  const conflicts: FieldConflict<any>[] = [];
  const ids = new Set([...local.map((s) => s.id), ...remote.map((s) => s.id)]);
  for (const id of ids) {
    const ls = byId(local).get(id);
    const rs = byId(remote).get(id);
    const bs = byId(base).get(id);
    const existence = resolveExistence({
      base: bs,
      local: ls,
      remote: rs,
      resolutions,
      resolvedKeys,
      level: 'spot',
      ownerId: id,
    });
    if (existence === 'absent') continue;

    const fieldMerge = mergeFields<Spot, any>({
      base: bs,
      local: ls,
      remote: rs,
      fields: SPOT_FIELDS,
      level: 'spot',
      ownerId: id,
      resolutions,
      resolvedKeys,
    });
    if (fieldMerge.merged) spots.push(fieldMerge.merged);
    conflicts.push(...fieldMerge.conflicts);
    const exConflict = existenceConflictIfPending({
      base: bs,
      local: ls,
      remote: rs,
      level: 'spot',
      ownerId: id,
    }, resolutions);
    if (exConflict) conflicts.push(exConflict);
  }
  return { spots, conflicts };
}

// ---------------- Trip ----------------

function mergeOneTrip(
  tripId: string,
  bt: Trip | undefined,
  lt: Trip | undefined,
  rt: Trip | undefined,
  base: OfflineSnapshot | undefined,
  local: OfflineSnapshot,
  remote: OfflineSnapshot,
  resolutions: Map<string, ConflictResolution>,
  resolvedKeys: string[],
): TripMerge {
  const existence = resolveExistence({
    base: bt,
    local: lt,
    remote: rt,
    resolutions,
    resolvedKeys,
    level: 'trip',
    ownerId: tripId,
  });
  if (existence === 'absent') {
    return { kind: lt ? 'local-only' : 'remote-only', trip: undefined, conflicts: [], days: [] };
  }

  const fieldMerge = mergeFields<Trip, any>({
    base: bt,
    local: lt,
    remote: rt,
    fields: TRIP_FIELDS,
    level: 'trip',
    ownerId: tripId,
    resolutions,
    resolvedKeys,
  });
  const conflicts: FieldConflict<any>[] = [...fieldMerge.conflicts];
  const exConflict = existenceConflictIfPending({
    base: bt,
    local: lt,
    remote: rt,
    level: 'trip',
    ownerId: tripId,
  }, resolutions);
  if (exConflict) conflicts.push(exConflict);

  const days = mergeTripDays(tripId, base, local, remote, resolutions, resolvedKeys);
  const kind: TripMerge['kind'] = lt && rt ? 'both' : lt ? 'local-only' : 'remote-only';
  return { kind, trip: fieldMerge.merged, conflicts, days };
}

// ---------------- DayPlan + Items ----------------

function mergeTripDays(
  tripId: string,
  base: OfflineSnapshot | undefined,
  local: OfflineSnapshot,
  remote: OfflineSnapshot,
  resolutions: Map<string, ConflictResolution>,
  resolvedKeys: string[],
): DayMerge[] {
  const bDays = (base?.dayPlans ?? []).filter((d) => d.trip_id === tripId);
  const lDays = local.dayPlans.filter((d) => d.trip_id === tripId);
  const rDays = remote.dayPlans.filter((d) => d.trip_id === tripId);

  const dayIndexes = new Set<number>([
    ...bDays.map((d) => d.day_index),
    ...lDays.map((d) => d.day_index),
    ...rDays.map((d) => d.day_index),
  ]);

  // 先做顺序合并（只处理仍存在的景点，移除另行裁决）
  const orderViewBase = buildTripOrderView(base?.dayPlans ?? [], tripId);
  const orderViewLocal = buildTripOrderView(lDays, tripId);
  const orderViewRemote = buildTripOrderView(rDays, tripId);
  const aliveSpotIds = new Set<string>([
    ...[...orderViewLocal.dayIndexOf.keys()],
    ...[...orderViewRemote.dayIndexOf.keys()],
  ]);
  const orderResult = mergeItemOrders(
    [...aliveSpotIds],
    orderViewBase,
    orderViewLocal,
    orderViewRemote,
    new Map(
      [...resolutions.entries()]
        .filter(([k]) => k.startsWith(`item:${tripId}`) && k.endsWith(`:${ORDER}`))
        .map(([k, v]) => [k, { choose: (v.choose ?? 'local') as 'local' | 'remote' }]),
    ),
    (spotId) => conflictKey({ level: 'item', ownerId: tripId, dayIndex: orderViewLocal.dayIndexOf.get(spotId), spotId, field: ORDER }),
  );
  if (orderResult.conflicts.length === 0) {
    // 确认掉的顺序冲突（键带具体天）
    for (const spotId of aliveSpotIds) {
      const key = conflictKey({ level: 'item', ownerId: tripId, dayIndex: orderViewLocal.dayIndexOf.get(spotId), spotId, field: ORDER });
      if (resolutions.has(key)) resolvedKeys.push(key);
    }
  }

  const dayMerges: DayMerge[] = [];

  for (const dayIndex of [...dayIndexes].sort((a, b) => a - b)) {
    const bd = bDays.find((d) => d.day_index === dayIndex);
    const ld = lDays.find((d) => d.day_index === dayIndex);
    const rd = rDays.find((d) => d.day_index === dayIndex);

    // 该天最终会放哪些景点（来自顺序合并的裁决）
    const finalOrder = orderResult.orders.get(dayIndex) ?? [];
    const spotIdsToday = new Set(finalOrder);

    const fieldMerge = mergeFields<DayPlan, any>({
      base: bd,
      local: ld,
      remote: rd,
      fields: DAY_PLAN_FIELDS,
      level: 'day',
      ownerId: tripId,
      dayIndex,
      resolutions,
      resolvedKeys,
    });

    const items: ItemMerge[] = [];
    for (const spotId of spotIdsToday) {
      const li = orderViewLocal.items.get(spotId);
      const ri = orderViewRemote.items.get(spotId);
      const bi = orderViewBase.items.get(spotId);

      // 存在性（移除）裁决 —— 与顺序移动完全分开
      const existence = resolveExistence({
        base: bi,
        local: li,
        remote: ri,
        resolutions,
        resolvedKeys,
        level: 'item',
        ownerId: tripId,
        dayIndex,
        spotId,
      });
      if (existence === 'absent') continue;

      const itemFieldMerge = mergeFields<DayPlanItem, any>({
        base: bi,
        local: li,
        remote: ri,
        fields: DAY_PLAN_ITEM_FIELDS,
        level: 'item',
        ownerId: tripId,
        dayIndex,
        spotId,
        resolutions,
        resolvedKeys,
      });

      const merged: DayPlanItem = itemFieldMerge.merged
        ? { ...itemFieldMerge.merged, spot_id: spotId }
        : ({ spot_id: spotId } as DayPlanItem);

      const itemConflicts: FieldConflict<any>[] = [...itemFieldMerge.conflicts];
      const ex = existenceConflictIfPending({
        base: bi,
        local: li,
        remote: ri,
        level: 'item',
        ownerId: tripId,
        dayIndex,
        spotId,
      }, resolutions);
      if (ex) itemConflicts.push(ex);

      items.push({
        spotId,
        dayIndex,
        kind: li && ri ? 'both' : li ? 'local-only' : 'remote-only',
        item: merged,
        conflicts: itemConflicts,
      });
    }

    // 归属到这一天的顺序冲突
    const orderConflicts = orderResult.conflicts.filter((c) => orderResult.targetDay.get(c.spotId) === dayIndex);

    // 只有该天在任意一侧真实存在，或确实有内容时才产出 DayPlan
    const dayExists = bd || ld || rd || items.length > 0;
    if (!dayExists) continue;

    const mergedDay: DayPlan = fieldMerge.merged
      ? {
          ...fieldMerge.merged,
          id: bd?.id ?? ld?.id ?? rd?.id ?? crypto.randomUUID(),
          trip_id: tripId,
          day_index: dayIndex,
          date: fieldMerge.merged.date ?? bd?.date ?? ld?.date ?? rd?.date ?? '',
          items: items.map((im) => im.item!),
        }
      : ({
          id: bd?.id ?? ld?.id ?? rd?.id ?? crypto.randomUUID(),
          trip_id: tripId,
          day_index: dayIndex,
          date: bd?.date ?? ld?.date ?? rd?.date ?? '',
          items: items.map((im) => im.item!),
        } as DayPlan);

    dayMerges.push({
      dayIndex,
      kind: ld && rd ? 'both' : ld ? 'local-only' : 'remote-only',
      day: mergedDay,
      fieldConflicts: fieldMerge.conflicts,
      items,
      orderConflicts,
    });
  }

  return dayMerges;
}

// ---------------- 存在性（移除）裁决 ----------------

type ExistenceOutcome = 'present' | 'absent';

interface ExistenceCheckArgs {
  base: object | undefined;
  local: unknown;
  remote: unknown;
  level: FieldConflict['level'];
  ownerId: string;
  dayIndex?: number;
  spotId?: string;
}

interface ExistenceArgs extends ExistenceCheckArgs {
  resolutions: Map<string, ConflictResolution>;
  resolvedKeys: string[];
}

/**
 * 存在性三路裁决：
 * - 祖先存在、仅一方删除 => 非冲突，直接按删除生效；
 * - 双方都删 => 删除生效；
 * - 一方删除、另一方修改（与祖先不同）=> 移除冲突，两版保留待确认；
 * - 祖先不存在、仅一方新增 => 新增直接生效。
 */
function resolveExistence(args: ExistenceArgs): ExistenceOutcome {
  const { base, local, remote } = args;
  if (local && remote) return 'present';
  if (!local && !remote) return 'absent';
  if (!base) return 'present'; // 一侧新增
  // 祖先存在，恰有一侧删除
  const survivorSide: 'local' | 'remote' = local ? 'local' : 'remote';
  const survivor = (local || remote) as { [k: string]: unknown } | undefined;
  const key = conflictKey({ level: args.level, ownerId: args.ownerId, field: EXISTENCE, dayIndex: args.dayIndex, spotId: args.spotId });
  const resolution = args.resolutions.get(key);
  if (resolution) {
    args.resolvedKeys.push(key);
    // choose 指向存活侧 => 保留；指向删除侧 => 删除
    return resolution.choose === survivorSide ? 'present' : 'absent';
  }
  // 未确认：存活方还改过内容 => 移除冲突，保留待确认；存活方等于祖先 => 删除是唯一改动，直接生效
  const changed = survivor && JSON.stringify(sortCopy(survivor)) !== JSON.stringify(sortCopy(base as Record<string, unknown>));
  return changed ? 'present' : 'absent';
}

function existenceConflictIfPending(args: ExistenceCheckArgs, resolutions?: Map<string, ConflictResolution>): FieldConflict | null {
  const { base, local, remote } = args;
  if (!base || (local && remote) || (!local && !remote)) return null;
  const survivor = (local || remote) as Record<string, unknown> | undefined;
  const changed = survivor && JSON.stringify(sortCopy(survivor)) !== JSON.stringify(sortCopy(base as Record<string, unknown>));
  if (!changed) return null; // 纯删除已直接生效
  const key = conflictKey({ level: args.level, ownerId: args.ownerId, field: EXISTENCE, dayIndex: args.dayIndex, spotId: args.spotId });
  if (resolutions?.has(key)) return null; // 已确认，不再挂待确认
  return {
    level: args.level,
    ownerId: args.ownerId,
    dayIndex: args.dayIndex,
    spotId: args.spotId,
    field: EXISTENCE,
    base: { exists: true },
    local: local ? { exists: true, version: local } : { exists: false },
    remote: remote ? { exists: true, version: remote } : { exists: false },
    localAuthor: (local as { author?: string })?.author || '本地',
    remoteAuthor: (remote as { author?: string })?.author || '同伴',
    localUpdatedAt: (local as { updated_at?: string })?.updated_at || '',
    remoteUpdatedAt: (remote as { updated_at?: string })?.updated_at || '',
  };
}

function sortCopy(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortCopy);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, sortCopy(v)]),
    );
  }
  return value;
}
