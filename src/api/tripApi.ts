import type { Trip } from '../models/trip';
import { STORAGE_KEYS } from '../constants/storageVersion';
import { loadLocal, saveLocal } from '../utils/storage';

export const tripApi = {
  list: () => loadLocal<Trip[]>(STORAGE_KEYS.trips, []),
  save: (trips: Trip[]) => saveLocal(STORAGE_KEYS.trips, trips),
};

