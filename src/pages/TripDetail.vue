<template>
  <main class="page" v-if="trip">
    <TripHeader :trip="trip" />
    <div class="toolbar">
      <el-button type="primary" @click="router.push('/spots')">添加景点</el-button>
      <el-button @click="router.push('/planner/' + trip.id + '/1')">编排第 1 天</el-button>
      <el-button @click="router.push('/merge')">结伴合并</el-button>
      <el-button @click="router.push('/share')">分享预览</el-button>
    </div>
    <el-alert v-if="tripPending" type="warning" :closable="false" show-icon
      title="本计划有尚未确认的合并冲突" :description="messages.mergePendingBlocked"
      style="margin: 10px 0" />
    <section class="grid">
      <BudgetChart :spent="stats.value.budget.spent" :remaining="stats.value.budget.remaining" />
      <div class="band"><strong>统计</strong><p>天数 {{ stats.value.days }} · 已确认景点 {{ stats.value.spotCount }}</p><p class="muted">{{ stats.value.budget.warning }}</p></div>
    </section>
    <DayTimeline v-for="day in visibleDays" :key="day.id" :day="day" :spots="spotStore.spots" />
  </main>
  <main v-else class="page"><EmptyState title="旅行不存在" /></main>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useTripStore } from '../stores/tripStore';
import { useSpotStore } from '../stores/spotStore';
import { useDayPlanStore } from '../stores/dayPlanStore';
import { useMergeStore } from '../stores/mergeStore';
import { useTripStats } from '../hooks/useTripStats';
import { confirmedDayPlans } from '../utils/merge/pending';
import { messages } from '../constants/messages';
import TripHeader from '../components/common/TripHeader.vue';
import DayTimeline from '../components/common/DayTimeline.vue';
import BudgetChart from '../components/common/BudgetChart.vue';
import EmptyState from '../components/common/EmptyState.vue';
const route = useRoute();
const router = useRouter();
const tripStore = useTripStore();
const spotStore = useSpotStore();
const dayPlanStore = useDayPlanStore();
const mergeStore = useMergeStore();
const trip = computed(() => tripStore.trips.find((item) => item.id === route.params.id));
const tripDays = computed(() => dayPlanStore.dayPlans.filter((day) => day.trip_id === route.params.id));
// 已确认（可进预算/分享）的每日行程：未决冲突景点整条剔除
const visibleDays = computed(() =>
  trip.value ? confirmedDayPlans(tripDays.value, mergeStore.pending, trip.value.id) : [],
);
const tripPending = computed(() => trip.value && mergeStore.pending.trips.has(trip.value.id));
const stats = computed(() =>
  trip.value
    ? useTripStats(trip.value, dayPlanStore.dayPlans, spotStore.spots, mergeStore.pending)
    : { value: { days: 0, spotCount: 0, budget: { spent: 0, remaining: 0, warning: '' } } },
);
</script>
