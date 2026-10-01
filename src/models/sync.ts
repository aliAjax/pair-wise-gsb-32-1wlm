import type { DayPlan } from './dayPlan';
import type { Spot } from './spot';
import type { Trip } from './trip';

/** 离线协作时每一处改动都会带上作者与修改时间，合并按它们裁决顺序与冲突。 */
export interface SyncMeta {
  updated_by: string;
  updated_at: string;
}

/** 已删除的对象以墓碑形式只保留在同步基线里，用于区分"没改过"和"被删了"。 */
export interface DeletedRecord extends SyncMeta {
  id: string;
  deleted_at: string;
}

export type MergeEntity = 'trip' | 'dayPlan' | 'dayItem' | 'spot';
/** 实体内部字段冲突字段名为字段名；存在性冲突（删除 vs 编辑）固定为 __existence__。 */
export type MergeField = string;
export type MergeConflictKind = 'field' | 'existence';

export interface ConflictVersion {
  author: string;
  at: string;
  value: unknown;
}

export interface MergeConflict {
  id: string;
  entity: MergeEntity;
  entityId: string;
  /** 归属的 Trip（DayPlan / DayPlanItem 冲突都带上，便于按旅行筛选面板）。 */
  tripId?: string;
  /** dayItem 归属的 DayPlan（trip_id + day_index 对齐后）。 */
  dayId?: string;
  dayIndex?: number;
  spotId?: string;
  field: MergeField;
  kind: MergeConflictKind;
  local: ConflictVersion;
  remote: ConflictVersion;
  resolved?: 'local' | 'remote';
}

/** 本机同步身份（作者名随每次改动写入 updated_by）。 */
export interface SyncProfile {
  deviceId: string;
  author: string;
}

/** 同伴离线导出 / 本机导入的同步快照。 */
export interface SyncSnapshot {
  deviceId: string;
  author: string;
  exportedAt: string;
  trips: Trip[];
  dayPlans: DayPlan[];
  spots: Spot[];
  tombstones: {
    trips: DeletedRecord[];
    dayPlans: DeletedRecord[];
    dayItems: DeletedRecord[];
    spots: DeletedRecord[];
  };
}

/** 上次合并后已确认的共同基线；墓碑仅存活在这里。 */
export type SyncBase = Pick<SyncSnapshot, 'trips' | 'dayPlans' | 'spots' | 'tombstones'>;

export interface MergeStats {
  added: number;
  updated: number;
  removed: number;
  conflicts: number;
}

export interface MergeResult {
  trips: Trip[];
  dayPlans: DayPlan[];
  spots: Spot[];
  tombstones: SyncBase['tombstones'];
  conflicts: MergeConflict[];
  stats: MergeStats;
}

export type { Trip, DayPlan, Spot };
