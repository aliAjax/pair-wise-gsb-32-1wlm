<template>
  <section class="band">
    <h3>第 {{ day.day_index }} 天 · {{ day.date }}</h3>
    <ol>
      <li v-for="item in day.items" :key="item.spot_id + item.start_time">
        <strong>{{ spotName(item.spot_id) }}</strong>
        <span class="muted">{{ item.start_time }}-{{ item.end_time }} · {{ transportText[item.transport] }} · {{ item.note }}</span>
      </li>
    </ol>
    <p v-if="!day.items.length" class="muted">这一天还没有安排。</p>
  </section>
</template>
<script setup lang="ts">
import type { DayPlan } from '../../models/dayPlan';
import type { Spot } from '../../models/spot';
import { transportText } from '../../utils/formatters';
const props = defineProps<{ day: DayPlan; spots: Spot[] }>();
const spotName = (id: string) => props.spots.find((spot) => spot.id === id)?.name || '未知景点';
</script>

