<template>
  <section class="band conflict-panel">
    <header class="conflict-head">
      <h3>待确认冲突（{{ conflicts.length }}）</h3>
      <el-tag type="warning" size="small">{{ messages.mergePendingBlocked }}</el-tag>
    </header>
    <p class="muted" v-if="!conflicts.length">没有待确认冲突，内容已全部进入预算和分享预览。</p>

    <article v-for="c in conflicts" :key="keyOf(c)" class="conflict-item">
      <div class="conflict-title">
        <el-tag :type="kindTag(c).type" size="small">{{ kindTag(c).label }}</el-tag>
        <strong>{{ titleOf(c) }}</strong>
        <span class="muted">{{ fieldLabel(c) }}</span>
      </div>
      <div class="conflict-versions">
        <div class="version" :class="{ chosen: chosen(c) === 'local' }" @click="choose(c, 'local')">
          <p class="muted">{{ c.localAuthor }}（本地）</p>
          <pre>{{ display(c.local) }}</pre>
        </div>
        <div class="version" :class="{ chosen: chosen(c) === 'remote' }" @click="choose(c, 'remote')">
          <p class="muted">{{ c.remoteAuthor }}（同伴）</p>
          <pre>{{ display(c.remote) }}</pre>
        </div>
      </div>
      <div class="conflict-actions">
        <el-button size="small" @click="choose(c, 'local')">保留本地版</el-button>
        <el-button size="small" @click="choose(c, 'remote')">保留同伴版</el-button>
      </div>
    </article>
  </section>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import type { FieldConflict } from '../../types/merge';
import { conflictKey, EXISTENCE, ORDER } from '../../types/merge';
import { messages } from '../../constants/messages';

const props = defineProps<{ conflicts: FieldConflict[] }>();
const emit = defineEmits<{ resolve: [resolution: { key: string; choose: 'local' | 'remote' }] }>();

const decided = ref<Record<string, 'local' | 'remote'>>({});

function keyOf(c: FieldConflict) {
  return conflictKey({ level: c.level, ownerId: c.ownerId, field: c.field, dayIndex: c.dayIndex, spotId: c.spotId });
}
function chosen(c: FieldConflict) {
  return decided.value[keyOf(c)];
}
function choose(c: FieldConflict, side: 'local' | 'remote') {
  const key = keyOf(c);
  decided.value[key] = side;
  emit('resolve', { key, choose: side });
}
function kindTag(c: FieldConflict) {
  if (c.field === EXISTENCE) return { type: 'danger' as const, label: '移除冲突' };
  if (c.field === ORDER) return { type: 'warning' as const, label: '移动顺序冲突' };
  return { type: 'primary' as const, label: '内容冲突' };
}
function titleOf(c: FieldConflict) {
  const level = { trip: '旅行计划', day: '每日行程', item: '行程景点', spot: '景点' }[c.level];
  const day = c.dayIndex != null ? ` · 第 ${c.dayIndex} 天` : '';
  return `${level}${day}`;
}
function fieldLabel(c: FieldConflict) {
  if (c.field === EXISTENCE) return '一方移除、另一方保留并修改';
  if (c.field === ORDER) return '双方移动到了不同位置';
  return `字段：${c.field}`;
}
function display(v: unknown) {
  if (v && typeof v === 'object') return JSON.stringify(v, null, 2);
  return String(v ?? '');
}
</script>

<style scoped>
.conflict-head { display: flex; align-items: center; gap: 10px; }
.conflict-item { border: 1px solid #e3d27a; border-radius: 10px; padding: 12px; margin-top: 12px; background: #fffdf2; }
.conflict-title { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
.conflict-versions { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.version { border: 2px solid transparent; border-radius: 8px; padding: 8px; background: #fff; cursor: pointer; }
.version.chosen { border-color: var(--el-color-primary); }
.version pre { white-space: pre-wrap; word-break: break-word; margin: 4px 0 0; font-family: inherit; }
.conflict-actions { display: flex; gap: 8px; margin-top: 8px; }
</style>
