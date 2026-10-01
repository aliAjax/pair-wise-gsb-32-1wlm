import type { FieldConflict, MergeResult } from '../../types/merge';
import { EXISTENCE, ORDER } from '../../types/merge';
import type { DayPlan, DayPlanItem } from '../../models/dayPlan';
import type { Trip } from '../../models/trip';

export interface PendingIndex {
  /** 含任意未决冲突的 trip id（预算/分享跳过整个计划） */
  trips: Set<string>;
  /** 含任意未决冲突的 day key：tripId#dayIndex */
  days: Set<string>;
  /** 含任意未决冲突的景点条目 key：tripId#dayIndex:spotId */
  items: Set<string>;
  /** 含任意未决冲突的 spot id */
  spots: Set<string>;
}

const dayKey = (tripId: string, dayIndex?: number) => `${tripId}#${dayIndex ?? ''}`;
const itemKey = (tripId: string, dayIndex: number | undefined, spotId?: string) =>
  `${tripId}#${dayIndex ?? ''}:${spotId ?? ''}`;

/** 根据未决冲突建立待确认索引；确认前预算与分享预览只读取“干净”部分 */
export function buildPendingIndex(conflicts: FieldConflict[]): PendingIndex {
  const pending: PendingIndex = { trips: new Set(), days: new Set(), items: new Set(), spots: new Set() };
  for (const c of conflicts) {
    if (c.level === 'trip') {
      pending.trips.add(c.ownerId);
    } else if (c.level === 'day') {
      // day 冲突 ownerId 记的是 tripId（dayIndex 保证键唯一），整计划进入待确认
      pending.days.add(dayKey(c.ownerId, c.dayIndex));
      pending.trips.add(c.ownerId);
    } else if (c.level === 'item') {
      pending.trips.add(c.ownerId);
      pending.items.add(itemKey(c.ownerId, c.dayIndex, c.spotId));
      if (c.field === ORDER && c.spotId) {
        // 顺序冲突只挡该景点，不整天剔除
        pending.spots.add(c.spotId);
      }
    } else if (c.level === 'spot') {
      pending.spots.add(c.ownerId);
    }
  }
  return pending;
}

/** 一个条目的所有冲突是否都已确认（用于 UI 单条判定） */
export function isItemPending(pending: PendingIndex, tripId: string, dayIndex: number, spotId: string): boolean {
  return pending.items.has(itemKey(tripId, dayIndex, spotId));
}

export function isTripPending(pending: PendingIndex, tripId: string): boolean {
  return pending.trips.has(tripId);
}

export function isSpotPending(pending: PendingIndex, spotId: string): boolean {
  return pending.spots.has(spotId);
}

/**
 * 返回可进入预算/分享的“干净版”每日行程：
 * - 含未决冲突的景点条目整条剔除（字段、移除、顺序任一未决都剔除）；
 * - 空天保留以维持天数观感，但不参与预算金额。
 */
export function confirmedDayPlans(dayPlans: DayPlan[], pending: PendingIndex, tripId?: string): DayPlan[] {
  return dayPlans
    .filter((day) => !tripId || day.trip_id === tripId)
    .map((day) => {
      const items: DayPlanItem[] = day.items.filter((item) => !isItemPending(pending, day.trip_id, day.day_index, item.spot_id));
      return { ...day, items };
    });
}

/** 可进入预算/分享的旅行计划（含未决冲突的整个计划先不对外） */
export function confirmedTrips(trips: Trip[], pending: PendingIndex): Trip[] {
  return trips.filter((trip) => !isTripPending(pending, trip.id));
}

/** 冲突是否属于“移除”类型 */
export function isRemovalConflict(c: FieldConflict): boolean {
  return c.field === EXISTENCE;
}

/** 冲突是否属于“移动”类型（与移除、字段编辑分开） */
export function isOrderConflict(c: FieldConflict): boolean {
  return c.field === ORDER;
}

/** 从合并结果生成待确认索引（便捷入口） */
export function pendingIndexOf(result: MergeResult): PendingIndex {
  return buildPendingIndex(result.conflicts);
}
