import { defineStore } from 'pinia';
import { TripStatus } from '../constants/trip';
import type { Trip } from '../models/trip';
import { tripApi } from '../api/tripApi';
import { messages } from '../constants/messages';
import { toast } from '../utils/message';
import { useSyncStore } from './syncStore';

export const useTripStore = defineStore('trip', {
  state: () => ({ trips: tripApi.list() as Trip[], statusFilter: 'all' as TripStatus | 'all' }),
  getters: {
    filteredTrips: (state) => state.statusFilter === 'all' ? state.trips : state.trips.filter((trip) => trip.status === state.statusFilter),
  },
  actions: {
    createTrip(title = '杭州周末慢旅行') {
      const syncStore = useSyncStore();
      const now = new Date().toISOString();
      const trip: Trip = {
        id: crypto.randomUUID(),
        title,
        destination: '杭州',
        start_date: new Date().toISOString().slice(0, 10),
        end_date: new Date(Date.now() + 86400000 * 2).toISOString().slice(0, 10),
        budget: 3200,
        currency: 'CNY',
        members: ['我', '朋友'],
        status: TripStatus.PLANNING,
        created_at: now,
        updated_by: syncStore.profile.author,
        updated_at: now,
      };
      this.trips.unshift(trip);
      this.persist();
      syncStore.ensureBase();
      toast.ok(messages.tripCreated);
      return trip.id;
    },
    removeTrip(id: string) {
      this.trips = this.trips.filter((trip) => trip.id !== id);
      this.persist();
      toast.ok(messages.tripDeleted);
    },
    /** 冲突确认选择"删除"时使用，不弹提示。 */
    removeTripSilently(id: string) {
      this.trips = this.trips.filter((trip) => trip.id !== id);
    },
    /** 合并提交时整体替换为合并结果。 */
    replaceAll(trips: Trip[]) {
      this.trips = trips;
    },
    persist() {
      tripApi.save(this.trips);
    },
  },
});
