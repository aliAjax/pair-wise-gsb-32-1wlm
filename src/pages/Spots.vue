<template>
  <main class="page">
    <h1>景点探索</h1>
    <div class="toolbar">
      <el-input v-model="spotStore.keyword" placeholder="搜索景点、标签" style="max-width: 260px" />
      <CategoryFilter v-model="spotStore.category" />
    </div>
    <EmptyState v-if="!spotStore.filteredSpots.length" title="没有景点" :description="messages.emptySpots" />
    <section class="grid">
      <SpotCard v-for="spot in spotStore.filteredSpots" :key="spot.id" :spot="spot" @favorite="spotStore.toggleFavorite" @add="addSpot" />
    </section>
  </main>
</template>
<script setup lang="ts">
import { useTripStore } from '../stores/tripStore';
import { useSpotStore } from '../stores/spotStore';
import { useDayPlanStore } from '../stores/dayPlanStore';
import CategoryFilter from '../components/common/CategoryFilter.vue';
import SpotCard from '../components/common/SpotCard.vue';
import EmptyState from '../components/common/EmptyState.vue';
import { messages } from '../constants/messages';
const tripStore = useTripStore();
const spotStore = useSpotStore();
const dayPlanStore = useDayPlanStore();
function addSpot(id: string) {
  const tripId = tripStore.trips[0]?.id || tripStore.createTrip();
  dayPlanStore.addSpot(tripId, id, 1);
}
</script>

