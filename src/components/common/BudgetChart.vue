<template><div ref="chartEl" class="budget-chart" /></template>
<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import * as echarts from 'echarts';
const props = defineProps<{ spent: number; remaining: number }>();
const chartEl = ref<HTMLDivElement>();
let chart: echarts.ECharts | null = null;
function render() {
  if (!chartEl.value) return;
  chart ||= echarts.init(chartEl.value);
  chart.setOption({ tooltip: {}, series: [{ type: 'pie', radius: ['45%', '70%'], data: [{ name: '已计划', value: props.spent }, { name: '剩余', value: Math.max(0, props.remaining) }] }] });
}
onMounted(render);
watch(() => [props.spent, props.remaining], render);
</script>
<style scoped>.budget-chart { width: 100%; height: 260px; }</style>

