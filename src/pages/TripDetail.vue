<template>
  <main class="page" v-if="trip">
    <TripHeader :trip="trip" />
    <div class="toolbar">
      <el-button type="primary" @click="router.push('/spots')">添加景点</el-button>
      <el-button @click="router.push('/planner/' + trip.id + '/1')">编排第 1 天</el-button>
      <el-button @click="router.push('/sync')">离线合并</el-button>
      <el-button @click="router.push('/share')">分享预览</el-button>
    </div>
    <el-alert
      v-if="tripConflictCount"
      type="warning"
      :closable="false"
      show-icon
      :title="messages.conflictPending"
      class="conflict-banner"
    />
    <section class="grid">
      <BudgetChart :spent="stats.budget.spent" :remaining="stats.budget.remaining" />
      <div class="band"><strong>统计</strong><p>天数 {{ stats.days }} · 景点 {{ stats.spotCount }}</p><p class="muted">{{ stats.budget.warning }}</p></div>
    </section>
    <DayTimeline v-for="day in confirmedTripDays" :key="day.id" :day="day" :spots="spotStore.spots" />
    <ConflictPanel :trip-id="trip.id" />
  </main>
  <main v-else class="page"><EmptyState title="旅行不存在" /></main>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useTripStore } from '../stores/tripStore';
import { useSpotStore } from '../stores/spotStore';
import { useDayPlanStore } from '../stores/dayPlanStore';
import { useSyncStore } from '../stores/syncStore';
import { useTripStats } from '../hooks/useTripStats';
import TripHeader from '../components/common/TripHeader.vue';
import DayTimeline from '../components/common/DayTimeline.vue';
import BudgetChart from '../components/common/BudgetChart.vue';
import EmptyState from '../components/common/EmptyState.vue';
import ConflictPanel from '../components/common/ConflictPanel.vue';
import { messages } from '../constants/messages';
const route = useRoute();
const router = useRouter();
const tripStore = useTripStore();
const spotStore = useSpotStore();
const dayPlanStore = useDayPlanStore();
const syncStore = useSyncStore();
const trip = computed(() => tripStore.trips.find((item) => item.id === route.params.id));
// 未确认的冲突条目/整天不进入时间线与预算。
const confirmedTripDays = computed(() =>
  syncStore.confirmedDayPlans(dayPlanStore.dayPlans.filter((day) => day.trip_id === route.params.id)),
);
const tripBlockedByConflict = computed(() =>
  !!trip.value && syncStore.conflicts.some((c) => !c.resolved && c.entity === 'trip' && c.entityId === trip.value!.id),
);
const stats = computed(() => {
  if (!trip.value) return { days: 0, spotCount: 0, budget: { spent: 0, remaining: 0, warning: '' } };
  // 旅行计划本身有未决字段冲突时，确认前整块预算都不计入。
  if (tripBlockedByConflict.value) {
    return {
      days: 0,
      spotCount: 0,
      budget: { spent: 0, remaining: trip.value.budget, warning: messages.conflictPending },
    };
  }
  return useTripStats(trip.value, confirmedTripDays.value, spotStore.spots).value;
});
const tripConflictCount = computed(() => (trip.value ? syncStore.conflictsForTrip(trip.value.id).length : 0));
</script>
<style scoped>
.conflict-banner { margin-bottom: 12px; }
</style>
