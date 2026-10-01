import { defineStore } from 'pinia';
import type { DayPlan, DayPlanItem } from '../models/dayPlan';
import { dayPlanApi } from '../api/dayPlanApi';
import { messages } from '../constants/messages';
import { toast } from '../utils/message';
import { useSyncStore } from './syncStore';

export const useDayPlanStore = defineStore('dayPlan', {
  state: () => ({ dayPlans: dayPlanApi.list() as DayPlan[] }),
  actions: {
    ensureDay(tripId: string, dayIndex = 1, date = new Date().toISOString().slice(0, 10)) {
      let day = this.dayPlans.find((item) => item.trip_id === tripId && item.day_index === dayIndex);
      if (!day) {
        const syncStore = useSyncStore();
        const now = new Date().toISOString();
        day = {
          id: crypto.randomUUID(),
          trip_id: tripId,
          day_index: dayIndex,
          date,
          items: [],
          updated_by: syncStore.profile.author,
          updated_at: now,
        };
        this.dayPlans.push(day);
      }
      return day;
    },
    addSpot(tripId: string, spotId: string, dayIndex = 1) {
      const syncStore = useSyncStore();
      const day = this.ensureDay(tripId, dayIndex);
      if (day.items.some((item) => item.spot_id === spotId)) return;
      const now = new Date().toISOString();
      const item: DayPlanItem = {
        spot_id: spotId,
        start_time: '10:00',
        end_time: '12:00',
        note: '现场调整',
        transport: 'metro',
        updated_by: syncStore.profile.author,
        updated_at: now,
      };
      day.items.push(item);
      this.persist();
      toast.ok(messages.spotAdded);
    },
    /**
     * 拖拽排序：移动与内容编辑分开记元数据。被拖拽的条目与换位经过的条目
     * 相对基线位置都变了，统一盖移动时间戳，保证离线侧能识别"纯移动"。
     */
    reorder(tripId: string, dayIndex: number, from: number, to: number) {
      const syncStore = useSyncStore();
      const day = this.ensureDay(tripId, dayIndex);
      const [moved] = day.items.splice(from, 1);
      if (moved) {
        day.items.splice(to, 0, moved);
        const now = new Date().toISOString();
        for (const item of day.items) {
          item.updated_by = syncStore.profile.author;
          item.updated_at = now;
        }
        day.updated_by = syncStore.profile.author;
        day.updated_at = now;
      }
      this.persist();
    },
    removeDaySilently(dayId: string) {
      this.dayPlans = this.dayPlans.filter((day) => day.id !== dayId);
    },
    replaceAll(dayPlans: DayPlan[]) {
      this.dayPlans = dayPlans;
    },
    persist() {
      dayPlanApi.save(this.dayPlans);
    },
  },
});
