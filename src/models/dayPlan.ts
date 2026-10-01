export interface DayPlanItem {
  spot_id: string;
  start_time: string;
  end_time: string;
  note: string;
  transport: 'walk' | 'metro' | 'taxi' | 'train';
  /** 最后一次修改人 */
  author?: string;
  /** 最后一次修改时间（ISO） */
  updated_at?: string;
}

export interface DayPlan {
  id: string;
  trip_id: string;
  day_index: number;
  date: string;
  items: DayPlanItem[];
  /** 最后一次修改人（日期调整等） */
  author?: string;
  /** 最后一次修改时间（ISO） */
  updated_at?: string;
}

export const DAY_PLAN_FIELDS = ['day_index', 'date'] as const;
export type DayPlanField = (typeof DAY_PLAN_FIELDS)[number];

export const DAY_PLAN_ITEM_FIELDS = ['start_time', 'end_time', 'note', 'transport'] as const;
export type DayPlanItemField = (typeof DAY_PLAN_ITEM_FIELDS)[number];
