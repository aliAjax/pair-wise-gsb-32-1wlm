<template>
  <main class="page">
    <TripHeader v-if="trip" :trip="trip" />
    <el-alert v-if="mergeStore.hasPendingConflicts" type="warning" :closable="false" show-icon
      title="存在尚未确认的合并冲突" :description="messages.mergePendingBlocked" style="margin: 10px 0" />
    <DayTimeline v-for="day in visibleDays" :key="day.id" :day="day" :spots="spotStore.spots" />
    <el-empty v-if="!visibleDays.length" description="暂无可分享的已确认行程" />
    <el-button @click="copyText">复制行程文本</el-button>
  </main>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import { useTripStore } from '../stores/tripStore';
import { useSpotStore } from '../stores/spotStore';
import { useDayPlanStore } from '../stores/dayPlanStore';
import { useMergeStore } from '../stores/mergeStore';
import { confirmedDayPlans, confirmedTrips } from '../utils/merge/pending';
import TripHeader from '../components/common/TripHeader.vue';
import DayTimeline from '../components/common/DayTimeline.vue';
import { messages } from '../constants/messages';

const tripStore = useTripStore();
const spotStore = useSpotStore();
const dayPlanStore = useDayPlanStore();
const mergeStore = useMergeStore();

// 分享只读取已确认版本：有未决冲突的整个计划 / 景点条目都不进入预览
const shareableTrips = computed(() => confirmedTrips(tripStore.trips, mergeStore.pending));
const trip = computed(() => shareableTrips.value[0] ?? tripStore.trips[0]);
const visibleDays = computed(() =>
  trip.value ? confirmedDayPlans(dayPlanStore.dayPlans, mergeStore.pending, trip.value.id).filter((d) => d.items.length) : [],
);

function copyText() {
  const lines = [`TripWeaver 行程单：${trip.value?.title || '未命名'}`];
  for (const day of visibleDays.value) {
    lines.push(`第 ${day.day_index} 天 ${day.date}`);
    for (const item of day.items) lines.push(`- ${item.start_time}-${item.end_time} ${item.spot_id}`);
  }
  navigator.clipboard?.writeText(lines.join('\n'));
}
</script>
