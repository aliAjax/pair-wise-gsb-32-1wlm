<template>
  <main class="page">
    <h1>结伴合并中心</h1>
    <p class="muted">
      几个人离线各自排景点后，在这里按作者和修改时间逐项合并：
      旅行计划、每日行程、景点分开对齐；移动与移除分开裁决；不冲突直接生效，冲突保留两版等你确认，确认前不进入预算和分享预览。
    </p>

    <section class="band">
      <div class="toolbar">
        <el-input v-model="author" style="width: 180px" placeholder="当前作者" @change="saveAuthor" />
        <el-button type="primary" @click="saveLocal">保存本机快照（合并前）</el-button>
        <el-button @click="loadDemoPeer">载入同伴离线改动（演示）</el-button>
        <el-button @click="triggerRemoteFile">导入同伴快照文件</el-button>
        <input ref="fileEl" type="file" accept="application/json" hidden @change="onFile" />
      </div>
      <p class="muted">
        本地快照：{{ local ? local.author + ' · ' + local.exportedAt : '未保存' }}；
        同伴快照：{{ remote ? remote.author + ' · ' + remote.exportedAt : '未导入' }}
      </p>
      <div class="toolbar">
        <el-button type="success" :disabled="!(local && remote)" :loading="mergeStore.merging" @click="doMerge">
          执行合并（失败自动重试 {{ maxAttempts }} 次）
        </el-button>
        <el-button @click="simulateFailure" plain>模拟合并器异常（验证重试与保底）</el-button>
        <el-button v-if="result" @click="applyResult" :disabled="!result.ok">把合并结果写回行程</el-button>
        <el-button @click="exportRemote">导出同伴快照</el-button>
      </div>
      <el-alert v-if="result && !result.ok" type="error" :closable="false" show-icon
        :title="messages.mergeFailedRetry" :description="result.error" />
      <el-alert v-if="result && result.ok && attemptsLabel" type="info" :closable="false" show-icon :title="attemptsLabel" />
    </section>

    <MergeConflictPanel
      v-if="result"
      :conflicts="mergeStore.conflicts"
      @resolve="onResolve"
    />

    <section v-if="result" class="band">
      <h3>合并后预览（未确认的景点不出现，即不进预算/分享）</h3>
      <p class="muted">未决冲突：{{ mergeStore.conflicts.length }} 条；本次已确认：{{ result.resolvedConflictKeys.length }} 条</p>
      <div v-for="tm in result.tripMerges" :key="tm.trip?.id" class="merge-trip">
        <h4 v-if="tm.trip">{{ tm.trip.title }} <span class="muted">（{{ tm.trip.author }}）</span></h4>
        <div v-for="dm in tm.days" :key="dm.dayIndex" class="merge-day">
          <p><strong>第 {{ dm.dayIndex }} 天</strong> · {{ dm.day?.date }}</p>
          <ol>
            <li v-for="im in dm.items" :key="im.spotId" :class="{ pending: pendingItem(tm, dm, im.spotId) }">
              {{ spotName(im.spotId) }}
              <span class="muted">{{ im.item?.start_time }}-{{ im.item?.end_time }} · {{ im.item?.note }}</span>
              <el-tag v-if="pendingItem(tm, dm, im.spotId)" type="warning" size="small">待确认，暂不进预算/分享</el-tag>
            </li>
          </ol>
        </div>
      </div>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, ref, toRaw } from 'vue';
import { useTripStore } from '../stores/tripStore';
import { useSpotStore } from '../stores/spotStore';
import { useDayPlanStore } from '../stores/dayPlanStore';
import { useMergeStore } from '../stores/mergeStore';
import { mergeApi } from '../api/mergeApi';
import type { ConflictResolution, MergeInput, MergeResult, OfflineSnapshot } from '../types/merge';
import { buildPendingIndex } from '../utils/merge/pending';
import { buildDemoPeerSnapshot } from '../api/demoMergeData';
import { currentAuthor, setCurrentAuthor } from '../utils/author';
import { messages } from '../constants/messages';
import { toast } from '../utils/message';
import MergeConflictPanel from '../components/common/MergeConflictPanel.vue';

const tripStore = useTripStore();
const spotStore = useSpotStore();
const dayPlanStore = useDayPlanStore();
const mergeStore = useMergeStore();

const author = ref(currentAuthor());
const local = ref<OfflineSnapshot | undefined>(mergeApi.loadSnapshot('local'));
const remote = ref<OfflineSnapshot | undefined>(mergeApi.loadSnapshot('remote'));
const base = ref<OfflineSnapshot | undefined>(mergeApi.loadSnapshot('base'));
const resolutions = ref<ConflictResolution[]>(mergeApi.loadResolutions());
const fileEl = ref<HTMLInputElement>();
const forceFail = ref(false);
const maxAttempts = 3;

const result = computed(() => mergeStore.lastResult);
const attemptsLabel = computed(() =>
  mergeStore.attemptsUsed > 1 ? `本次合并在第 ${mergeStore.attemptsUsed} 次尝试后成功（中间发生过重试）` : '',
);

function saveAuthor() {
  setCurrentAuthor(author.value || '我');
}

function snapshotOf(who: string): OfflineSnapshot {
  return {
    author: who,
    exportedAt: new Date().toISOString(),
    trips: structuredClone(toRaw(tripStore.trips)),
    dayPlans: structuredClone(toRaw(dayPlanStore.dayPlans)),
    spots: structuredClone(toRaw(spotStore.spots)),
  };
}

function saveLocal() {
  const snap = snapshotOf(author.value || '我');
  local.value = snap;
  // 第一次保存本地时同时记录共同祖先
  if (!base.value) {
    base.value = structuredClone(snap);
    mergeApi.saveSnapshot('base', base.value);
  }
  mergeApi.saveSnapshot('local', snap);
  toast.ok(messages.mergeSnapshotSaved);
}

function loadDemoPeer() {
  // 以当前本机数据为“本地”，构造一位同伴离线排景点后的改动（含移动/移除/字段冲突）
  if (!tripStore.trips.length || !dayPlanStore.dayPlans.some((d) => d.items.length >= 4)) {
    seedDemoTrip();
  }
  if (!local.value) saveLocal();
  const snap = buildDemoPeerSnapshot(local.value || snapshotOf(author.value || '我'));
  remote.value = snap;
  mergeApi.saveSnapshot('remote', snap);
  resolutions.value = [];
  mergeApi.clearResolutions();
  toast.ok(messages.mergeSnapshotImported);
}

/** 造一个含 4 个景点的第 1 天，并把第 1 个景点移到最前（用于与同伴的移动形成冲突） */
function seedDemoTrip() {
  const id = tripStore.trips[0]?.id ?? tripStore.createTrip();
  const spotIds = spotStore.spots.slice(0, 4).map((s) => s.id);
  const day = dayPlanStore.ensureDay(id, 1);
  for (const spotId of spotIds) {
    if (!day.items.some((i) => i.spot_id === spotId)) dayPlanStore.addSpot(id, spotId, 1);
  }
  // 本地把第 2 个景点挪到最前（同伴会把它挪到最后 -> 移动冲突）
  if (day.items.length >= 4 && day.items[0].spot_id !== spotIds[1]) {
    dayPlanStore.reorder(id, 1, day.items.findIndex((it) => it.spot_id === spotIds[1]), 0);
  }
  // 本地顺手改一下标题（同伴改预算 -> 不同字段非冲突）
  const trip = tripStore.trips.find((x) => x.id === id);
  if (trip) {
    trip.title = '本地起的标题';
    trip.author = currentAuthor();
    trip.updated_at = new Date().toISOString();
  }
  // 本地给第 3 个景点加备注（同伴会删除它 -> 一方修改一方删除的移除冲突）
  const third = day.items.find((i) => i.spot_id === spotIds[2]);
  if (third) {
    third.note = '本地查过，这个值得留';
    third.author = currentAuthor();
    third.updated_at = new Date().toISOString();
  }
  // 本地改第 4 个景点的交通（同伴改时间/备注 -> 不同字段非冲突同时生效）
  const fourth = day.items.find((i) => i.spot_id === spotIds[3]);
  if (fourth) {
    fourth.transport = 'walk';
    fourth.author = currentAuthor();
    fourth.updated_at = new Date().toISOString();
  }
}

function triggerRemoteFile() {
  fileEl.value?.click();
}
function onFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  file.text().then((text) => {
    const snap = JSON.parse(text) as OfflineSnapshot;
    remote.value = snap;
    mergeApi.saveSnapshot('remote', snap);
    toast.ok(messages.mergeSnapshotImported);
  });
}

function exportRemote() {
  // 便于双人在同一浏览器演示：把当前数据当作“同伴”视角导出
  const snap = snapshotOf(author.value === '朋友' ? '我' : '朋友');
  const blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `tripweaver-snapshot-${snap.author}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function buildInput(): MergeInput | null {
  if (!local.value || !remote.value) {
    toast.warn(messages.mergeNoSnapshot);
    return null;
  }
  return { local: local.value, remote: remote.value, base: base.value, resolutions: resolutions.value };
}

async function doMerge() {
  const input = buildInput();
  if (!input) return;
  if (forceFail.value) {
    // 走真实引擎但注入坏数据触发异常，以验证“重试 + 保留上一份可读结果”
    forceFail.value = false;
    const broken = { ...input, remote: { ...input.remote, trips: null as unknown as OfflineSnapshot['trips'] } };
    await mergeStore.runMerge(broken);
    return;
  }
  await mergeStore.runMerge(input);
}

function simulateFailure() {
  forceFail.value = true;
  doMerge();
}

async function onResolve(resolution: { key: string; choose: 'local' | 'remote' }) {
  const input = buildInput();
  if (!input) return;
  resolutions.value = [...resolutions.value.filter((r) => r.key !== resolution.key), resolution];
  mergeApi.saveResolutions(resolutions.value);
  await mergeStore.resolveConflict(resolution, { ...input, resolutions: resolutions.value });
  toast.ok(messages.mergeResolved);
}

function applyResult() {
  if (!result.value?.ok) return;
  tripStore.replaceAll(result.value.trips);
  dayPlanStore.replaceAll(result.value.dayPlans);
  spotStore.replaceAll(result.value.spots);
  // 写回后本地快照更新为当前状态
  saveLocal();
  // 冲突已全部落盘，清掉待确认状态与决议
  mergeApi.clearResolutions();
  mergeApi.clearPending();
  mergeStore.clear();
  resolutions.value = [];
  toast.ok(messages.mergeClean);
}

function pendingItem(tm: NonNullable<MergeResult['tripMerges'][number]>, dm: { dayIndex: number }, spotId: string) {
  const idx = buildPendingIndex(mergeStore.conflicts);
  return idx.items.has(`${tm.trip?.id}#${dm.dayIndex}:${spotId}`);
}
function spotName(id: string) {
  return spotStore.spots.find((s) => s.id === id)?.name || '未知景点';
}
</script>
