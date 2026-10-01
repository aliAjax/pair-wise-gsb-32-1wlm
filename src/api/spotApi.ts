import { SpotCategory } from '../constants/spot';
import type { Spot } from '../models/spot';
import { STORAGE_KEYS } from '../constants/storageVersion';
import { loadLocal, saveLocal } from '../utils/storage';

export const seedSpots: Spot[] = [
  { id: 'spot-westlake', name: '西湖苏堤', category: SpotCategory.NATURE, address: '杭州西湖区', lat: 30.246, lng: 120.143, rating: 4.9, price: 0, open_time: '全天', tags: ['湖景', '散步'], image: 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?w=800' },
  { id: 'spot-museum', name: '城市博物馆', category: SpotCategory.CULTURE, address: '市中心文化路', lat: 30.252, lng: 120.164, rating: 4.6, price: 60, open_time: '09:00-17:00', tags: ['历史', '亲子'], image: 'https://images.unsplash.com/photo-1566127444979-b3d2b654e3d7?w=800' },
  { id: 'spot-market', name: '烟火夜市', category: SpotCategory.FOOD, address: '河坊街', lat: 30.239, lng: 120.172, rating: 4.7, price: 120, open_time: '17:00-23:30', tags: ['小吃', '购物'], image: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=800' },
  { id: 'spot-park', name: '湖滨乐园', category: SpotCategory.ENTERTAINMENT, address: '湖滨商圈', lat: 30.259, lng: 120.169, rating: 4.5, price: 180, open_time: '10:00-21:00', tags: ['娱乐', '夜景'], image: 'https://images.unsplash.com/photo-1519608487953-e999c86e7455?w=800' },
];
export const spotApi = {
  list: () => loadLocal<Spot[]>(STORAGE_KEYS.spots, seedSpots),
  save: (spots: Spot[]) => saveLocal(STORAGE_KEYS.spots, spots),
};

