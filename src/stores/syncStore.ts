import { defineStore } from 'pinia';
import type { DayPlan, DayPlanItem } from '../models/dayPlan';
import type { Spot } from '../models/spot';
import type { Trip } from '../models/trip';
import type { MergeConflict, MergeResult, SyncBase, SyncProfile, SyncSnapshot } from '../models/sync';
import { mergeSnapshots, inferLocalTombstones } from '../utils/mergeEngine';
import { parseSnapshot, syncApi } from '../api/syncApi';
import { useTripStore } from './tripStore';
import { useDayPlanStore } from './dayPlanStore';
import { useSpotStore } from './spotStore';
import { messages } from '../constants/messages';
import { toast } from '../utils/message';

interface ImportOutcome {
  ok: boolean;
  retried: boolean;
  stats?: MergeResult['stats'];
}

export const useSyncStore = defineStore('sync', {
  state: () => ({
    profile: syncApi.loadProfile() as SyncProfile,
    base: syncApi.loadBase() as SyncBase | null,
    conflicts: syncApi.loadConflicts() as MergeConflict[],
    /** 上一份可读结果：合并彻底失败时恢复使用，绝不把损坏状态留给用户。 */
    lastResult: syncApi.loadLastResult() as SyncBase | null,
    lastStats: null as MergeResult['stats'] | null,
    lastError: '',
  }),
  getters: {
    pendingCount: (state) => state.conflicts.filter((conflict) => !conflict.resolved).length,
    /** 该 trip 上仍待确认的冲突（字段级 / 整天存在性）。 */
    conflictsForTrip: (state) => (tripId: string) =>
      state.conflicts.filter((conflict) => !conflict.resolved && conflict.tripId === tripId),
  },
  actions: {
    setAuthor(author: string) {
      this.profile = { ...this.profile, author: author.trim() || '我' };
      syncApi.saveProfile(this.profile);
    },

    /** 首次协作前建立基线；之后每次合并提交成功都会刷新。 */
    ensureBase() {
      if (this.base) return;
      this.base = this.buildBaseFromLocal();
      syncApi.saveBase(this.base);
    },

    /** 演示/调试用：丢弃旧基线，以当前现状重新建立共同基线。 */
    rebuildBase() {
      this.base = this.buildBaseFromLocal();
      syncApi.saveBase(this.base);
    },

    buildBaseFromLocal(): SyncBase {
      const tripStore = useTripStore();
      const dayPlanStore = useDayPlanStore();
      const spotStore = useSpotStore();
      return {
        trips: JSON.parse(JSON.stringify(tripStore.trips)) as Trip[],
        dayPlans: JSON.parse(JSON.stringify(dayPlanStore.dayPlans)) as DayPlan[],
        spots: JSON.parse(JSON.stringify(spotStore.spots)) as Spot[],
        tombstones: { trips: [], dayPlans: [], dayItems: [], spots: [] },
      };
    },

    snapshotLocal(): SyncSnapshot {
      const tripStore = useTripStore();
      const dayPlanStore = useDayPlanStore();
      const spotStore = useSpotStore();
      const trips = JSON.parse(JSON.stringify(tripStore.trips)) as Trip[];
      const dayPlans = JSON.parse(JSON.stringify(dayPlanStore.dayPlans)) as DayPlan[];
      const spots = JSON.parse(JSON.stringify(spotStore.spots)) as Spot[];
      // 基线里有、本机已经删掉的记录，在导出时补成墓碑，同伴才能识别这是删除而非未动。
      const tombstones = this.base
        ? inferLocalTombstones({ trips, dayPlans, spots, base: this.base, author: this.profile.author })
        : { trips: [], dayPlans: [], dayItems: [], spots: [] };
      return {
        deviceId: this.profile.deviceId,
        author: this.profile.author,
        exportedAt: new Date().toISOString(),
        trips,
        dayPlans,
        spots,
        tombstones,
      };
    },

    /**
     * 合并同伴离线快照：先在纯函数引擎里算一遍（不触碰现状），
     * 抛错则整体重试一次；两次都失败就回退到上一份可读结果。
     */
    importSnapshot(raw: string): ImportOutcome {
      this.lastError = '';
      let remote: SyncSnapshot;
      try {
        remote = parseSnapshot(raw);
      } catch {
        this.lastError = messages.snapshotInvalid;
        toast.fail(messages.snapshotInvalid);
        return { ok: false, retried: false };
      }
      this.ensureBase();

      let result: MergeResult | null = null;
      let retried = false;
      for (let attempt = 0; attempt < 2 && !result; attempt += 1) {
        try {
          result = mergeSnapshots(this.snapshotLocal(), remote, this.base);
        } catch (error) {
          console.warn('[sync] merge attempt failed', error);
          if (attempt === 0) retried = true;
        }
      }

      if (!result) {
        this.restoreLastResult();
        toast.fail(messages.syncFailedKeepLast);
        return { ok: false, retried };
      }

      try {
        this.commit(result);
      } catch (error) {
        console.warn('[sync] commit failed, retrying once', error);
        try {
          result = mergeSnapshots(this.snapshotLocal(), remote, this.base);
          this.commit(result);
          retried = true;
        } catch (secondError) {
          console.warn('[sync] commit failed again', secondError);
          this.restoreLastResult();
          toast.fail(messages.syncFailedKeepLast);
          return { ok: false, retried: true };
        }
      }

      this.lastStats = result.stats;
      if (retried) toast.ok(messages.syncRetrySucceeded);
      if (result.stats.conflicts > 0) toast.warn(messages.conflictPending);
      else toast.ok(messages.syncImported);
      return { ok: true, retried, stats: result.stats };
    },

    commit(result: MergeResult) {
      const tripStore = useTripStore();
      const dayPlanStore = useDayPlanStore();
      const spotStore = useSpotStore();
      // 先把新基线落盘成功，再切换内存现状；任一步失败都由调用方重试/回退。
      const nextBase: SyncBase = {
        trips: result.trips,
        dayPlans: result.dayPlans,
        spots: result.spots,
        tombstones: result.tombstones,
      };
      syncApi.saveBase(nextBase);
      tripStore.replaceAll(result.trips);
      dayPlanStore.replaceAll(result.dayPlans);
      spotStore.replaceAll(result.spots);
      this.conflicts = result.conflicts;
      syncApi.saveConflicts(this.conflicts);
      this.base = nextBase;
      this.lastResult = nextBase;
      syncApi.saveLastResult(nextBase);
    },

    restoreLastResult() {
      if (!this.lastResult) return;
      try {
        const tripStore = useTripStore();
        const dayPlanStore = useDayPlanStore();
        const spotStore = useSpotStore();
        tripStore.replaceAll(this.lastResult.trips);
        dayPlanStore.replaceAll(this.lastResult.dayPlans);
        spotStore.replaceAll(this.lastResult.spots);
      } catch (error) {
        console.warn('[sync] restore last readable result failed', error);
      }
    },

    // -----------------------------------------------------------------------
    // 冲突确认：存在性冲突可删/可留；字段冲突选本机或同伴版本。
    // -----------------------------------------------------------------------

    resolveConflict(conflictId: string, choice: 'local' | 'remote') {
      const conflict = this.conflicts.find((item) => item.id === conflictId);
      if (!conflict || conflict.resolved) return;
      const tripStore = useTripStore();
      const dayPlanStore = useDayPlanStore();
      const spotStore = useSpotStore();
      const chosen = choice === 'local' ? conflict.local.value : conflict.remote.value;

      if (conflict.kind === 'existence') {
        this.applyExistenceChoice(conflict, choice, chosen as Record<string, unknown> | null);
      } else if (conflict.entity === 'trip') {
        const trip = tripStore.trips.find((item) => item.id === conflict.entityId);
        if (trip) (trip as Record<string, unknown>)[conflict.field] = chosen;
      } else if (conflict.entity === 'spot') {
        const spot = spotStore.spots.find((item) => item.id === conflict.entityId);
        if (spot) (spot as Record<string, unknown>)[conflict.field] = chosen;
      } else if (conflict.entity === 'dayPlan') {
        const day = dayPlanStore.dayPlans.find((item) => item.id === conflict.entityId);
        if (day) (day as Record<string, unknown>)[conflict.field] = chosen;
      } else if (conflict.entity === 'dayItem' && conflict.dayId && conflict.spotId) {
        const day = dayPlanStore.dayPlans.find((item) => item.id === conflict.dayId);
        const item = day?.items.find((entry) => entry.spot_id === conflict.spotId);
        if (item) (item as Record<string, unknown>)[conflict.field] = chosen;
      }

      conflict.resolved = choice;
      this.persistStoresAndBase();
      toast.ok(messages.conflictResolved);
    },

    applyExistenceChoice(conflict: MergeConflict, choice: 'local' | 'remote', chosen: Record<string, unknown> | null) {
      const tripStore = useTripStore();
      const dayPlanStore = useDayPlanStore();
      const spotStore = useSpotStore();
      const keepRecord = choice === 'local' ? conflict.local.value : conflict.remote.value;

      if (conflict.entity === 'trip') {
        if (chosen === null || !keepRecord) {
          tripStore.removeTripSilently(conflict.entityId);
        } else if (!tripStore.trips.some((trip) => trip.id === conflict.entityId)) {
          tripStore.trips.unshift(keepRecord as Trip);
        }
      } else if (conflict.entity === 'dayPlan' && conflict.dayId) {
        if (chosen === null || !keepRecord) {
          dayPlanStore.removeDaySilently(conflict.dayId);
        } else if (!dayPlanStore.dayPlans.some((day) => day.id === conflict.dayId)) {
          dayPlanStore.dayPlans.push(keepRecord as unknown as DayPlan);
        }
      } else if (conflict.entity === 'dayItem' && conflict.dayId && conflict.spotId) {
        const day = dayPlanStore.dayPlans.find((item) => item.id === conflict.dayId);
        if (!day) return;
        if (chosen === null || !keepRecord) {
          day.items = day.items.filter((item) => item.spot_id !== conflict.spotId);
        } else if (!day.items.some((item) => item.spot_id === conflict.spotId)) {
          day.items.push(keepRecord as unknown as DayPlanItem);
        }
      } else if (conflict.entity === 'spot') {
        if (chosen === null || !keepRecord) {
          spotStore.spots = spotStore.spots.filter((spot) => spot.id !== conflict.entityId);
        } else if (!spotStore.spots.some((spot) => spot.id === conflict.entityId)) {
          spotStore.spots.push(keepRecord as unknown as Spot);
        }
      }
    },

    /** 确认后：实体 stores 落盘，并用当前现状重建基线（墓碑沿用上一份，保留未处理删除）。 */
    persistStoresAndBase() {
      const tripStore = useTripStore();
      const dayPlanStore = useDayPlanStore();
      const spotStore = useSpotStore();
      tripStore.persist();
      dayPlanStore.persist();
      spotStore.persist();
      syncApi.saveConflicts(this.conflicts);
      const remaining = this.conflicts.some((conflict) => !conflict.resolved);
      if (!remaining) {
        this.base = {
          trips: JSON.parse(JSON.stringify(tripStore.trips)) as Trip[],
          dayPlans: JSON.parse(JSON.stringify(dayPlanStore.dayPlans)) as DayPlan[],
          spots: JSON.parse(JSON.stringify(spotStore.spots)) as Spot[],
          // 确认时选择"删除"的内容补成墓碑，避免下次同步时被同伴的旧版本复活。
          tombstones: inferLocalTombstones({
            trips: tripStore.trips,
            dayPlans: dayPlanStore.dayPlans,
            spots: spotStore.spots,
            base: this.base,
            author: this.profile.author,
          }),
        };
        syncApi.saveBase(this.base);
        this.lastResult = this.base;
        syncApi.saveLastResult(this.base);
      }
    },

    // -----------------------------------------------------------------------
    // 确认前视图：预算、分享预览、时间线只消费这里，未决内容一律先藏起来。
    // -----------------------------------------------------------------------

    /**
     * 确认后的每日行程（供预算 / 分享 / 时间线消费）：
     * - 整天存在性冲突、日期字段冲突未确认 → 整天剔除；
     * - 某天内景点条目（字段或存在性）冲突未确认 → 该条目剔除，其余照常。
     */
    confirmedDayPlans(dayPlans: DayPlan[]): DayPlan[] {
      const pending = this.conflicts.filter((conflict) => !conflict.resolved);
      return dayPlans
        .map((day) => {
          const dayLevelConflict = pending.some(
            (conflict) => conflict.entity === 'dayPlan' && conflict.dayId === day.id,
          );
          if (dayLevelConflict) return null;
          const pendingItemSpotIds = new Set(
            pending
              .filter((conflict) => conflict.entity === 'dayItem' && conflict.dayId === day.id)
              .map((conflict) => conflict.spotId as string),
          );
          if (!pendingItemSpotIds.size) return day;
          return { ...day, items: day.items.filter((item) => !pendingItemSpotIds.has(item.spot_id)) } as DayPlan;
        })
        .filter(Boolean) as DayPlan[];
    },

    /** 有未决 trip 字段冲突的旅行不进入确认视图（其下属日也不进入预算）。 */
    confirmedTrips(trips: Trip[]): Trip[] {
      const blockedTripIds = new Set(
        this.conflicts
          .filter((conflict) => !conflict.resolved && conflict.entity === 'trip')
          .map((conflict) => conflict.entityId),
      );
      return trips.filter((trip) => !blockedTripIds.has(trip.id));
    },
  },
});
