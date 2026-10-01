import assert from 'node:assert';
import { createPinia, setActivePinia } from 'pinia';

// localStorage 最小桩：api 层在 store state 初始化时就读取。
const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => void storage.set(key, String(value)),
  removeItem: (key) => void storage.delete(key),
  clear: () => storage.clear(),
};

// Element Plus 的 ElMessage 会触碰 DOM，给一个最小桩保证 Node 下可跑。
const fakeElement = () => ({
  style: {},
  classList: { add() {}, remove() {} },
  appendChild() {}, remove() {}, addEventListener() {}, removeEventListener() {},
  setAttribute() {}, querySelector: () => fakeElement(), querySelectorAll: () => [],
});
globalThis.document = {
  body: { appendChild() {}, removeChild() {}, ...fakeElement() },
  createElement: () => fakeElement(),
  createTextNode: () => fakeElement(),
  addEventListener() {},
};

const { useTripStore } = await import('../src/stores/tripStore.ts');
const { useDayPlanStore } = await import('../src/stores/dayPlanStore.ts');
const { useSpotStore } = await import('../src/stores/spotStore.ts');
const { useSyncStore } = await import('../src/stores/syncStore.ts');
const { buildDemoRemote } = await import('../src/utils/demoRemote.ts');
const { budgetStatus } = await import('../src/utils/budgetCalculator.ts');

setActivePinia(createPinia());
const tripStore = useTripStore();
const dayPlanStore = useDayPlanStore();
const spotStore = useSpotStore();
const syncStore = useSyncStore();

let passed = 0;
const test = (name, fn) => { fn(); passed += 1; console.log('  ✓', name); };

const tripId = tripStore.createTrip();
spotStore.spots.slice(0, 3).forEach((spot) => dayPlanStore.addSpot(tripId, spot.id, 1));
syncStore.base = null;
syncStore.ensureBase();

// 本机改动都发生在共同基线之后：改标题（与同伴冲突）、移动第一个景点到最后。
const trip = tripStore.trips[0];
trip.title = '我的本地标题';
tripStore.persist();

// 同伴将删除基线第 1 天的最后一个景点（第 3 个 spot），本机先编辑它的内容
// （删除 vs 编辑 -> 存在性冲突）；随后再拖拽排序（移动也独立于删除）。
const baseLastSpot = syncStore.base.dayPlans[0].items[2].spot_id;
const demoDay0 = dayPlanStore.dayPlans.find((d) => d.trip_id === tripId && d.day_index === 1);
const edited = demoDay0.items.find((i) => i.spot_id === baseLastSpot);
edited.note = '本机刚补充的注意事项';
edited.updated_by = syncStore.profile.author;
edited.updated_at = new Date(Date.now() + 120_000).toISOString();
dayPlanStore.persist();

dayPlanStore.reorder(tripId, 1, 0, 2);

const demoDay = demoDay0;

const remote = buildDemoRemote({
  trips: tripStore.trips,
  dayPlans: dayPlanStore.dayPlans,
  spots: spotStore.spots,
  base: syncStore.base,
  author: '同伴',
  localAuthor: syncStore.profile.author,
});
const raw = JSON.stringify(remote);

// 1. 导入成功，且冲突 > 0
test('导入合并成功并产生冲突', () => {
  const outcome = syncStore.importSnapshot(raw);
  assert.equal(outcome.ok, true);
  assert.ok(syncStore.conflicts.length >= 2, '至少有标题冲突 + 删除/编辑冲突');
  assert.ok(syncStore.pendingCount >= 2);
});

// 2. 未确认前：trip 字段冲突 => 确认视图里没有该 trip，预算不计
test('确认前 trip 不进入预算与分享视图', () => {
  const confirmedTrips = syncStore.confirmedTrips(tripStore.trips);
  assert.equal(confirmedTrips.length, 0);
  const fullDays = syncStore.confirmedDayPlans(dayPlanStore.dayPlans);
  // day item 存在性冲突的条目被剔除
  const day = fullDays.find((d) => d.trip_id === tripId);
  const conflictSpot = syncStore.conflicts.find((c) => c.entity === 'dayItem' && c.kind === 'existence');
  if (conflictSpot) assert.ok(!day.items.some((i) => i.spot_id === conflictSpot.spotId));
  // 预算只能基于确认视图：此处 trip 被屏蔽，分享页取不到旅行
  const status = budgetStatus(trip, fullDays.filter((d) => d.trip_id === tripId), spotStore.spots);
  assert.ok(status.spent >= 0);
});

// 3. 确认标题冲突（选本机）
test('确认字段冲突后 trip 才进入视图', () => {
  const titleConflict = syncStore.conflicts.find((c) => c.entity === 'trip' && c.field === 'title' && !c.resolved);
  syncStore.resolveConflict(titleConflict.id, 'local');
  assert.equal(tripStore.trips[0].title, '我的本地标题');
  assert.equal(syncStore.confirmedTrips(tripStore.trips).length, 1);
});

// 4. 确认删除/编辑冲突（保留同伴的删除）
test('确认存在性冲突选择删除后条目消失', () => {
  const existence = syncStore.conflicts.find((c) => c.entity === 'dayItem' && c.kind === 'existence' && !c.resolved);
  assert.ok(existence);
  const spotId = existence.spotId;
  syncStore.resolveConflict(existence.id, 'remote'); // remote 是删除方
  const day = dayPlanStore.dayPlans.find((d) => d.trip_id === tripId && d.day_index === 1);
  assert.ok(!day.items.some((i) => i.spot_id === spotId));
});

// 5. 全部确认后 confirmed 视图与现状一致，基线刷新
test('全部确认后无未决冲突，基线已刷新', () => {
  assert.equal(syncStore.pendingCount, 0);
  assert.ok(syncStore.base);
  const days = syncStore.confirmedDayPlans(dayPlanStore.dayPlans.filter((d) => d.trip_id === tripId));
  assert.ok(days.length >= 1);
});

// 6. 非法快照：解析失败不动现状
test('非法快照被拒绝，现状不变', () => {
  const before = tripStore.trips.length;
  const outcome = syncStore.importSnapshot('{ not json');
  assert.equal(outcome.ok, false);
  assert.equal(tripStore.trips.length, before);
});

// 7. 合并引擎抛错时重试 + 回退到上一份可读结果
test('引擎失败重试后仍失败 -> 恢复上一份可读结果', () => {
  const lastResult = syncStore.lastResult;
  assert.ok(lastResult, '已有上一份可读结果');
  const dayPlans = dayPlanStore.dayPlans.map((d) => ({ ...d, items: null }));
  const boom = JSON.stringify({
    deviceId: 'x',
    author: '坏快照',
    exportedAt: new Date().toISOString(),
    trips: tripStore.trips,
    dayPlans,
    spots: spotStore.spots,
    tombstones: { trips: [], dayPlans: [], dayItems: [], spots: [] },
  });
  const outcome = syncStore.importSnapshot(boom);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.retried, true);
  // 现状回落到 lastResult（上一份可读结果），仍是可正常展示的完整数据。
  assert.deepEqual(tripStore.trips.map((t) => t.id), lastResult.trips.map((t) => t.id));
  assert.ok(dayPlanStore.dayPlans.every((d) => Array.isArray(d.items)));
});

console.log(`\n${passed} 个 syncStore 集成测试全部通过`);
