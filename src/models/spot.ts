import { SpotCategory } from '../constants/spot';

export interface Spot {
  id: string;
  name: string;
  category: SpotCategory;
  address: string;
  lat: number;
  lng: number;
  rating: number;
  price: number;
  open_time: string;
  tags: string[];
  image: string;
  /** 最后一次修改人 */
  author?: string;
  /** 最后一次修改时间（ISO） */
  updated_at?: string;
}

export const SPOT_FIELDS = [
  'name',
  'category',
  'address',
  'lat',
  'lng',
  'rating',
  'price',
  'open_time',
  'tags',
  'image',
] as const;

export type SpotField = (typeof SPOT_FIELDS)[number];
