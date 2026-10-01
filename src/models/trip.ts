import { TripStatus } from '../constants/trip';

export interface Trip {
  id: string;
  title: string;
  destination: string;
  start_date: string;
  end_date: string;
  budget: number;
  currency: string;
  members: string[];
  status: TripStatus;
  created_at: string;
  /** 最后一次修改人，离线结伴合并时按作者区分来源 */
  author?: string;
  /** 最后一次修改时间（ISO），合并时作为字段级裁决依据 */
  updated_at?: string;
}

export const TRIP_FIELDS = [
  'title',
  'destination',
  'start_date',
  'end_date',
  'budget',
  'currency',
  'members',
  'status',
] as const;

export type TripField = (typeof TRIP_FIELDS)[number];
