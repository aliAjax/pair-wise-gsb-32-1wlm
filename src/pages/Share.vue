<template>
  <main class="page">
    <TripHeader v-if="trip" :trip="trip" />
    <DayTimeline v-for="day in dayPlanStore.dayPlans" :key="day.id" :day="day" :spots="spotStore.spots" />
    <el-button @click="copyText">复制行程文本</el-button>
  </main>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import { useTripStore } from '../stores/tripStore';
import { useSpotStore } from '../stores/spotStore';
import { useDayPlanStore } from '../stores/dayPlanStore';
import TripHeader from '../components/common/TripHeader.vue';
import DayTimeline from '../components/common/DayTimeline.vue';
const tripStore = useTripStore();
const spotStore = useSpotStore();
const dayPlanStore = useDayPlanStore();
const trip = computed(() => tripStore.trips[0]);
function copyText() { navigator.clipboard?.writeText('TripWeaver 行程单：' + (trip.value?.title || '未命名')); }
</script>

