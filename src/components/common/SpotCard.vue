<template>
  <article class="spot-card">
    <img :src="spot.image" :alt="spot.name" />
    <div>
      <strong>{{ spot.name }}</strong>
      <p class="muted">{{ spot.address }} · {{ spot.open_time }}</p>
      <el-tag :type="tagType">{{ spotCategoryText[spot.category] }}</el-tag>
      <p>评分 {{ spot.rating }} · {{ formatCurrency(spot.price) }}</p>
      <div class="toolbar">
        <el-button @click="$emit('favorite', spot.id)">收藏</el-button>
        <el-button type="primary" @click="$emit('add', spot.id)">加入行程</el-button>
      </div>
    </div>
  </article>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import type { Spot } from '../../models/spot';
import { SPOT_CATEGORY_MAP_STYLE } from '../../constants/spot';
import { formatCurrency, spotCategoryText } from '../../utils/formatters';
const props = defineProps<{ spot: Spot }>();
defineEmits<{ add: [id: string]; favorite: [id: string] }>();
const tagType = computed(() => SPOT_CATEGORY_MAP_STYLE[props.spot.category] === 'red' ? 'danger' : 'success');
</script>
<style scoped>
.spot-card { display: grid; grid-template-columns: 120px 1fr; gap: 14px; background: #fff; border: 1px solid #dbe7cf; border-radius: 8px; padding: 12px; }
img { width: 120px; height: 112px; object-fit: cover; border-radius: 6px; }
</style>

