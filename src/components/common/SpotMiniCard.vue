<template>
  <div class="mini">{{ spot.name }} <span>{{ formatCurrency(spot.price) }}</span></div>
</template>
<script setup lang="ts">
import type { Spot } from '../../models/spot';
import { formatCurrency } from '../../utils/formatters';
defineProps<{ spot: Spot }>();
</script>
<style scoped>
.mini { display: flex; justify-content: space-between; padding: 10px 12px; border: 1px dashed #a8b8a1; border-radius: 8px; margin-bottom: 8px; background: #fff; }
</style>

