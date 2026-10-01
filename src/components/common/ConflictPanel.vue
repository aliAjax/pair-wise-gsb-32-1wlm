<template>
  <section class="conflict-panel">
    <div class="conflict-head">
      <h3>待确认的合并冲突（{{ conflicts.length }}）</h3>
      <el-tag v-if="!conflicts.length" type="success">{{ messages.noConflicts }}</el-tag>
      <el-tag v-else type="warning">确认前不会进入预算和分享预览</el-tag>
    </div>
    <el-alert
      v-for="conflict in conflicts"
      :key="conflict.id"
      class="conflict-item"
      type="warning"
      :closable="false"
      show-icon
    >
      <template #title>
        <div class="conflict-title">
          <el-tag size="small">{{ entityText(conflict.entity) }}</el-tag>
          <strong>{{ fieldLabel(conflict) }}</strong>
          <span class="muted">{{ describeTarget(conflict) }}</span>
        </div>
      </template>
      <div class="conflict-versions">
        <div class="version">
          <div class="version-meta">本机 · {{ conflict.local.author }} · {{ formatDateTime(conflict.local.at) }}</div>
          <pre>{{ displayValue(conflict.local.value) }}</pre>
        </div>
        <div class="version">
          <div class="version-meta">同伴 · {{ conflict.remote.author }} · {{ formatDateTime(conflict.remote.at) }}</div>
          <pre>{{ displayValue(conflict.remote.value) }}</pre>
        </div>
      </div>
      <div class="conflict-actions">
        <el-button size="small" type="primary" @click="choose(conflict.id, 'local')">保留本机版本</el-button>
        <el-button size="small" @click="choose(conflict.id, 'remote')">采用同伴版本</el-button>
      </div>
    </el-alert>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { MergeConflict } from '../../models/sync';
import { useSyncStore } from '../../stores/syncStore';
import { useTripStore } from '../../stores/tripStore';
import { useSpotStore } from '../../stores/spotStore';
import { messages } from '../../constants/messages';
import { formatDateTime, mergeFieldText, spotCategoryText, transportText, tripStatusText } from '../../utils/formatters';

const props = defineProps<{ tripId?: string }>();
const syncStore = useSyncStore();
const tripStore = useTripStore();
const spotStore = useSpotStore();

const conflicts = computed(() =>
  syncStore.conflicts
    .filter((conflict) => !conflict.resolved)
    .filter((conflict) => !props.tripId || conflict.tripId === props.tripId),
);

const ENTITY_TEXT: Record<MergeConflict['entity'], string> = {
  trip: '旅行计划',
  dayPlan: '每日行程',
  dayItem: '景点安排',
  spot: '景点',
};

function entityText(entity: MergeConflict['entity']) {
  return ENTITY_TEXT[entity];
}

function fieldLabel(conflict: MergeConflict) {
  if (conflict.kind === 'existence') return '删除与修改冲突';
  return mergeFieldText[conflict.field] || conflict.field;
}

function describeTarget(conflict: MergeConflict) {
  if (conflict.entity === 'trip') {
    return tripStore.trips.find((trip) => trip.id === conflict.entityId)?.title || '旅行计划';
  }
  if (conflict.entity === 'dayPlan') {
    return conflict.dayIndex ? `第 ${conflict.dayIndex} 天` : '每日行程';
  }
  if (conflict.entity === 'dayItem') {
    const name = spotStore.spots.find((spot) => spot.id === conflict.spotId)?.name || conflict.spotId;
    return conflict.dayIndex ? `第 ${conflict.dayIndex} 天 · ${name}` : name;
  }
  if (conflict.entity === 'spot') {
    return spotStore.spots.find((spot) => spot.id === conflict.entityId)?.name || '景点';
  }
  return '';
}

function displayValue(value: unknown) {
  if (value === null || value === undefined) return '（删除）';
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (record.transport || record.start_time || record.note) {
      return `${record.start_time || ''}-${record.end_time || ''} · ${transportText[String(record.transport)] || record.transport || ''} · ${record.note || ''}`;
    }
    return JSON.stringify(value, null, 2);
  }
  if (value === 'planning' || value === 'ongoing' || value === 'finished') {
    return tripStatusText[value as keyof typeof tripStatusText];
  }
  if (typeof value === 'string' && value in transportText) return transportText[value];
  if (typeof value === 'string' && value in spotCategoryText) {
    return spotCategoryText[value as keyof typeof spotCategoryText];
  }
  return String(value);
}

function choose(conflictId: string, choice: 'local' | 'remote') {
  syncStore.resolveConflict(conflictId, choice);
}
</script>

<style scoped>
.conflict-panel { margin: 16px 0; }
.conflict-head { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
.conflict-item { margin-bottom: 12px; }
.conflict-title { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.muted { color: #7b8a78; font-size: 12px; }
.conflict-versions { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 8px 0; }
.version { background: #fff; border: 1px solid #e1e8dc; border-radius: 8px; padding: 8px 10px; }
.version-meta { font-size: 12px; color: #5c6b58; margin-bottom: 4px; }
.version pre { margin: 0; white-space: pre-wrap; word-break: break-all; font-family: inherit; font-size: 13px; }
.conflict-actions { display: flex; gap: 8px; }
</style>
