<template>
  <main class="page">
    <TripHeader v-if="trip" :trip="trip" />
    <el-alert
      v-if="syncStore.pendingCount"
      type="warning"
      :closable="false"
      show-icon
      :title="messages.conflictPending"
      class="conflict-banner"
    >
      <template #default>仍有 {{ syncStore.pendingCount }} 处冲突待确认，<RouterLink to="/sync">去处理</RouterLink>。</template>
    </el-alert>
    <DayTimeline v-for="day in confirmedDays" :key="day.id" :day="day" :spots="spotStore.spots" />
    <el-button @click="copyText">复制行程文本</el-button>
  </main>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import { useTripStore } from '../stores/tripStore';
import { useSpotStore } from '../stores/spotStore';
import { useDayPlanStore } from '../stores/dayPlanStore';
import { useSyncStore } from '../stores/syncStore';
import TripHeader from '../components/common/TripHeader.vue';
import DayTimeline from '../components/common/DayTimeline.vue';
import { messages } from '../constants/messages';
const tripStore = useTripStore();
const spotStore = useSpotStore();
const dayPlanStore = useDayPlanStore();
const syncStore = useSyncStore();
// 分享只展示已确认的旅行与其已确认的每日行程。
const trip = computed(() => syncStore.confirmedTrips(tripStore.trips)[0]);
const confirmedDays = computed(() =>
  trip.value ? syncStore.confirmedDayPlans(dayPlanStore.dayPlans.filter((day) => day.trip_id === trip.value!.id)) : [],
);
function copyText() { navigator.clipboard?.writeText('TripWeaver 行程单：' + (trip.value?.title || '未命名')); }
</script>
<style scoped>
.conflict-banner { margin-bottom: 12px; }
</style>
