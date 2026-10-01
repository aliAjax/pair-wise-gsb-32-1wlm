export type TransportMode = 'walk' | 'metro' | 'taxi' | 'train';

export interface DayPlanItem {
  spot_id: string;
  start_time: string;
  end_time: string;
  note: string;
  transport: TransportMode;
  /** 离线协作合并字段：该景点条目最后移动/修改的作者与时间，用于顺序裁决与冲突留档。 */
  updated_by?: string;
  updated_at?: string;
}

export interface DayPlan {
  id: string;
  trip_id: string;
  day_index: number;
  date: string;
  items: DayPlanItem[];
  /** 每日行程自身（日期等）的作者与修改时间。 */
  updated_by?: string;
  updated_at?: string;
}
