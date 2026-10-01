<template>
  <header class="trip-header">
    <p class="muted">TripWeaver Share</p>
    <h1>{{ trip.title }}</h1>
    <p>{{ trip.destination }} · {{ trip.start_date }} 至 {{ trip.end_date }}</p>
  </header>
</template>
<script setup lang="ts">
import type { Trip } from '../../models/trip';
defineProps<{ trip: Trip }>();
</script>
<style scoped>.trip-header { padding: 28px 0; border-bottom: 2px solid #2d7a46; }</style>

