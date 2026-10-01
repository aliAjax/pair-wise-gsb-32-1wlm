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
  /** 离线协作合并字段：最后修改人与修改时间（老数据缺失时按 created_at 兜底）。 */
  updated_by?: string;
  updated_at?: string;
}
