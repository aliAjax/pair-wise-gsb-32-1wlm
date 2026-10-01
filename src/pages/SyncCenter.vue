<template>
  <main class="page">
    <h1>离线改动合并</h1>
    <p class="muted">结伴出行时各自离线排景点，回来后按作者与修改时间逐项合并：旅行计划、每日行程、景点分层对齐，删除与移动分开处理。</p>

    <section class="band">
      <h3>我的署名</h3>
      <div class="toolbar">
        <el-input v-model="authorName" style="max-width: 220px" placeholder="你的名字（写入每次改动）" @change="saveAuthor" />
        <el-button @click="saveAuthor">保存署名</el-button>
        <el-tag size="small">设备 {{ syncStore.profile.deviceId.slice(0, 8) }}</el-tag>
      </div>
    </section>

    <section class="band">
      <h3>导出我的改动</h3>
      <p class="muted">把快照发给同行的人；对方在同样页面导入即可合并。</p>
      <div class="toolbar">
        <el-button type="primary" @click="exportSnapshot">生成快照文本</el-button>
      </div>
      <el-input v-if="exportedText" v-model="exportedText" type="textarea" :rows="4" readonly />
    </section>

    <section class="band">
      <h3>导入同伴的离线改动</h3>
      <div class="toolbar">
        <el-input v-model="importText" type="textarea" :rows="4" placeholder="粘贴同伴的快照文本" style="max-width: 560px" />
      </div>
      <div class="toolbar">
        <el-button type="primary" :disabled="!importText.trim()" @click="doImport">合并进来</el-button>
        <el-upload :show-file-list="false" :auto-upload="false" :on-change="onFile" accept="application/json,.txt">
          <el-button>选择快照文件</el-button>
        </el-upload>
        <el-button @click="prepareDemo">模拟同伴离线改动</el-button>
      </div>
      <div v-if="syncStore.lastStats" class="result">
        <el-tag>新增 {{ syncStore.lastStats.added }}</el-tag>
        <el-tag type="success">更新 {{ syncStore.lastStats.updated }}</el-tag>
        <el-tag type="info">移除 {{ syncStore.lastStats.removed }}</el-tag>
        <el-tag :type="syncStore.lastStats.conflicts ? 'warning' : 'success'">待确认冲突 {{ syncStore.lastStats.conflicts }}</el-tag>
      </div>
    </section>

    <ConflictPanel />
  </main>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { ElMessage } from 'element-plus';
import type { UploadFile } from 'element-plus';
import { useSyncStore } from '../stores/syncStore';
import { useTripStore } from '../stores/tripStore';
import { useDayPlanStore } from '../stores/dayPlanStore';
import { useSpotStore } from '../stores/spotStore';
import ConflictPanel from '../components/common/ConflictPanel.vue';
import { buildDemoRemote } from '../utils/demoRemote';
import { messages } from '../constants/messages';
import { toast } from '../utils/message';

const syncStore = useSyncStore();
const tripStore = useTripStore();
const dayPlanStore = useDayPlanStore();
const spotStore = useSpotStore();
const authorName = ref(syncStore.profile.author);
const exportedText = ref('');
const importText = ref('');

function saveAuthor() {
  syncStore.setAuthor(authorName.value);
  authorName.value = syncStore.profile.author;
}

function exportSnapshot() {
  syncStore.ensureBase();
  exportedText.value = JSON.stringify(syncStore.snapshotLocal());
  navigator.clipboard?.writeText(exportedText.value).then(
    () => ElMessage.success(messages.snapshotCopied),
    () => ElMessage.success(messages.snapshotExported),
  );
}

function doImport() {
  syncStore.importSnapshot(importText.value);
  importText.value = '';
}

function onFile(file: UploadFile) {
  const raw = file.raw;
  if (!raw) return;
  const reader = new FileReader();
  reader.onload = () => {
    importText.value = String(reader.result || '');
    syncStore.importSnapshot(importText.value);
    importText.value = '';
  };
  reader.readAsText(raw);
}

function prepareDemo() {
  if (!tripStore.trips.length) tripStore.createTrip();
  if (!dayPlanStore.dayPlans.length) {
    spotStore.spots.slice(0, 3).forEach((spot) => dayPlanStore.addSpot(tripStore.trips[0].id, spot.id, 1));
  }
  // 把当前状态重置为"双方共同基线"，同伴的离线改动从这里分叉。
  syncStore.rebuildBase();
  const demo = buildDemoRemote({
    trips: tripStore.trips,
    dayPlans: dayPlanStore.dayPlans,
    spots: spotStore.spots,
    base: syncStore.base,
    author: '同伴',
    localAuthor: syncStore.profile.author,
  });
  importText.value = JSON.stringify(demo);
  toast.ok(messages.demoPrepared);
}
</script>

<style scoped>
.result { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
</style>
