import type { Trip, TripField } from '../models/trip';
import type { DayPlan, DayPlanItem, DayPlanField, DayPlanItemField } from '../models/dayPlan';
import type { Spot, SpotField } from '../models/spot';

/** 冲突所在的层级 */
export type MergeLevel = 'trip' | 'day' | 'item' | 'spot';

/** 移除（删除）本身也按一种字段冲突保留两版：保留 / 删除 */
export const EXISTENCE = '__existence__';
export type ExistenceField = typeof EXISTENCE;
/** 顺序移动冲突专用字段，与普通字段编辑、移除严格区分开 */
export const ORDER = '__order__';
export type OrderField = typeof ORDER;

/** 字段级冲突：同一字段两边都改、且值不同时保留两版 */
export interface FieldConflict<F extends string = string, V = unknown> {
  level: MergeLevel;
  /** 冲突归属：trip.id / day.id / item.spot_id / spot.id */
  ownerId: string;
  /** day_index，便于前端分组展示 */
  dayIndex?: number;
  /** 景点 id（item 级冲突时） */
  spotId?: string;
  field: F;
  base: V;
  local: V;
  remote: V;
  localAuthor: string;
  remoteAuthor: string;
  localUpdatedAt: string;
  remoteUpdatedAt: string;
}

/** 每日行程按景点对齐后的单条结果 */
export interface ItemMerge {
  /** 对齐键：行程内的景点 id */
  spotId: string;
  /** both=两边都有进入字段合并；local-only/remote-only 走新增或移除裁决 */
  kind: 'both' | 'local-only' | 'remote-only';
  /** 落在哪个 day_index（跨天移动时本地/远端可能不同） */
  dayIndex: number;
  item?: DayPlanItem;
  conflicts: FieldConflict<DayPlanItemField | ExistenceField>[];
}

export interface DayMerge {
  /** trip_id + day_index 对齐 */
  dayIndex: number;
  kind: 'both' | 'local-only' | 'remote-only';
  day?: DayPlan;
  fieldConflicts: FieldConflict<DayPlanField>[];
  /** 按景点逐项对齐的结果 */
  items: ItemMerge[];
  /** 这一天内的顺序移动冲突（移动与移除分开记录） */
  orderConflicts: OrderConflict[];
}

/** 顺序移动冲突：双方对同一景点的相邻关系/位置改法不一致；与删除互不吞并 */
export interface OrderConflict {
  spotId: string;
  /** 景点在本地/远端所在的 day_index；不同表示跨天移动冲突 */
  localDayIndex: number;
  remoteDayIndex: number;
  localPrevSpotId: string | null;
  remotePrevSpotId: string | null;
  localNextSpotId: string | null;
  remoteNextSpotId: string | null;
  localOrder: number;
  remoteOrder: number;
  localAuthor: string;
  remoteAuthor: string;
}

export interface TripMerge {
  kind: 'both' | 'local-only' | 'remote-only';
  trip?: Trip;
  conflicts: FieldConflict<TripField | ExistenceField>[];
  days: DayMerge[];
}

/** 一次完整合并（旅行计划 / 每日行程 / 景点）的输出 */
export interface MergeResult {
  mergedAt: string;
  /** 本次合并是否整体成功；失败时调用方应继续沿用上一份可读结果 */
  ok: boolean;
  error?: string;
  trips: Trip[];
  dayPlans: DayPlan[];
  spots: Spot[];
  tripMerges: TripMerge[];
  spotConflicts: FieldConflict<SpotField | ExistenceField>[];
  /** 拍平后的全部字段/存在性/顺序冲突（顺序冲突用 ORDER 字段表达） */
  conflicts: FieldConflict[];
  /** 本次新解决的冲突键列表（确认后从待确认区移除） */
  resolvedConflictKeys: string[];
}

/** 离线改动快照：一位作者离线前/回来时的一整套数据 */
export interface OfflineSnapshot {
  author: string;
  exportedAt: string;
  trips: Trip[];
  dayPlans: DayPlan[];
  spots: Spot[];
}

export interface MergeInput {
  /** 本机当前数据（合并基准中“本地”一侧） */
  local: OfflineSnapshot;
  /** 同伴离线改完带回来的数据（“远端”一侧） */
  remote: OfflineSnapshot;
  /**
   * 共同祖先（可选）：双方都基于它改时才能精确识别“移除/移动”。
   * 缺失时按仅存在一侧当作新增，不做删除裁决。
   */
  base?: OfflineSnapshot;
  /** 已由用户确认的冲突键，确认值直接落盘 */
  resolutions?: ConflictResolution[];
}

export interface ConflictResolution {
  key: string;
  /** 'local' | 'remote' 表示取哪一版，或直接给一个定值 */
  choose?: 'local' | 'remote';
  value?: unknown;
}

/** 冲突唯一键：层级 + 归属 + 字段 */
export function conflictKey(c: { level: MergeLevel; ownerId: string; field: string; spotId?: string; dayIndex?: number }): string {
  const day = c.dayIndex != null ? `#${c.dayIndex}` : '';
  const spot = c.spotId ? `:${c.spotId}` : '';
  return `${c.level}:${c.ownerId}${day}${spot}:${c.field}`;
}
