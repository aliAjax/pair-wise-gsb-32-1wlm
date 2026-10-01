import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeSnapshots } from './src/utils/merge/engine';
import { buildPendingIndex, confirmedDayPlans } from './src/utils/merge/pending';
import { conflictKey, ORDER, EXISTENCE } from './src/types/merge';
import { calcTripCost } from './src/utils/budgetCalculator';
import { withRetry } from './src/utils/merge/retry';
import type { OfflineSnapshot, ConflictResolution } from './src/types/merge';
import type { Trip } from './src/models/trip';
import type { DayPlan, DayPlanItem } from './src/models/dayPlan';
import type { Spot } from './src/models/spot';
import { SpotCategory } from './src/constants/spot';
import { TripStatus } from './src/constants/trip';

let seq = 0;
const t = (offset = 0) => new Date(Date.now() + offset * 60000).toISOString();

function makeTrip(over: Partial<Trip> = {}): Trip {
  return {
    id: 'trip-1', title: '杭州行', destination: '杭州', start_date: '2026-10-01', end_date: '2026-10-03',
    budget: 3000, currency: 'CNY', members: ['我', '朋友'], status: TripStatus.PLANNING,
    created_at: t(-200), author: 'base', updated_at: t(-100), ...over,
  };
}
function makeSpot(id: string, price: number, over: Partial<Spot> = {}): Spot {
  return {
    id, name: id, category: SpotCategory.NATURE, address: '', lat: 0, lng: 0, rating: 4.5,
    price, open_time: '', tags: [], image: '', author: 'base', updated_at: t(-100), ...over,
  };
}
function item(spot_id: string, over: Partial<DayPlanItem> = {}): DayPlanItem {
  return { spot_id, start_time: '09:00', end_time: '11:00', note: '', transport: 'metro', author: 'base', updated_at: t(-100), ...over };
}
function day(items: DayPlanItem[], over: Partial<DayPlan> = {}): DayPlan {
  return { id: 'day-1', trip_id: 'trip-1', day_index: 1, date: '2026-10-01', items, author: 'base', updated_at: t(-100), ...over };
}
function snap(author: string, trips: Trip[], dayPlans: DayPlan[], spots: Spot[]): OfflineSnapshot {
  return { author, exportedAt: t(), trips, dayPlans, spots };
}
function clone<T>(v: T): T {
  return structuredClone(v);
}

// 祖先：一天四个景点 A B C D
function baseFixture(): OfflineSnapshot {
  const spots = [makeSpot('A', 100), makeSpot('B', 200), makeSpot('C', 300), makeSpot('D', 400)];
  const items = [item('A'), item('B'), item('C'), item('D')];
  return snap('base', [makeTrip()], [day(items)], spots);
}

test('同一每日行程按景点对齐：单方移动直接生效，且不盖掉另一方未动的顺序', () => {
  const base = baseFixture();
  const local = snap('我', [makeTrip()], [day([item('A'), item('B'), item('C'), item('D')])], clone(base.spots));
  // 同伴把 B 移到 D 后面：A C D B
  const remote = snap('朋友', [makeTrip()], [
    day([item('A'), item('C'), item('D'), item('B', { author: '朋友', updated_at: t(10) })]),
  ], clone(base.spots));

  const r = mergeSnapshots({ local, remote, base });
  assert.equal(r.ok, true);
  const order = r.dayPlans[0].items.map((i) => i.spot_id);
  assert.deepEqual(order, ['A', 'C', 'D', 'B']);
  assert.equal(r.conflicts.length, 0, '单方移动不应产生冲突');
});

test('双方都移动同一景点到不兼容位置：顺序冲突保留两版', () => {
  const base = baseFixture();
  // 本地把 B 移到最前：B A C D
  const local = snap('我', [makeTrip()], [
    day([item('B', { author: '我', updated_at: t(5) }), item('A'), item('C'), item('D')]),
  ], clone(base.spots));
  // 同伴把 B 移到最后：A C D B
  const remote = snap('朋友', [makeTrip()], [
    day([item('A'), item('C'), item('D'), item('B', { author: '朋友', updated_at: t(6) })]),
  ], clone(base.spots));

  const r = mergeSnapshots({ local, remote, base });
  const orderConflicts = r.conflicts.filter((c) => c.field === ORDER);
  assert.equal(orderConflicts.length, 1, '应记录一条移动冲突');
  assert.equal(orderConflicts[0].spotId, 'B');
  assert.equal(orderConflicts[0].localAuthor, '我');
  assert.equal(orderConflicts[0].remoteAuthor, '朋友');
});

test('移除与移动分开：同伴删除 C，本地保留并修改 C => 移除冲突待确认', () => {
  const base = baseFixture();
  const local = snap('我', [makeTrip()], [
    day([item('A'), item('B'), item('C', { note: '本地补了备注', author: '我', updated_at: t(8) }), item('D')]),
  ], clone(base.spots));
  const remote = snap('朋友', [makeTrip()], [
    day([item('A'), item('B'), item('D')]),
  ], clone(base.spots));

  const r = mergeSnapshots({ local, remote, base });
  const ex = r.conflicts.filter((c) => c.field === EXISTENCE && c.spotId === 'C');
  assert.equal(ex.length, 1, '删除 vs 修改 => 移除冲突');
  // 确认前 merged 中 C 仍在（present），但 pending 索引挡住它
  const pending = buildPendingIndex(r.conflicts);
  const clean = confirmedDayPlans(r.dayPlans, pending, 'trip-1');
  assert.ok(!clean[0].items.some((i) => i.spot_id === 'C'), '未确认时 C 不进入已确认视图');
});

test('同伴删除 C，本地未改 C => 非冲突，删除直接生效', () => {
  const base = baseFixture();
  const local = snap('我', [makeTrip()], [day([item('A'), item('B'), item('C'), item('D')])], clone(base.spots));
  const remote = snap('朋友', [makeTrip()], [day([item('A'), item('B'), item('D')])], clone(base.spots));
  const r = mergeSnapshots({ local, remote, base });
  assert.ok(!r.dayPlans[0].items.some((i) => i.spot_id === 'C'));
  assert.equal(r.conflicts.length, 0);
});

test('同一景点改不同字段直接合并；改同一字段不同值保留两版', () => {
  const base = baseFixture();
  const local = snap('我', [makeTrip()], [
    day([item('A', { note: '本地备注', author: '我', updated_at: t(5) }), item('B'), item('C'), item('D')]),
  ], clone(base.spots));
  const remote = snap('朋友', [makeTrip()], [
    day([item('A', { transport: 'taxi', author: '朋友', updated_at: t(6) }), item('B'), item('C'), item('D')]),
  ], clone(base.spots));
  const r = mergeSnapshots({ local, remote, base });
  const a = r.dayPlans[0].items.find((i) => i.spot_id === 'A')!;
  assert.equal(a.note, '本地备注', '本地字段生效');
  assert.equal(a.transport, 'taxi', '同伴字段生效');
  assert.equal(r.conflicts.length, 0);

  // 同一字段改成不同值
  const local2 = snap('我', [makeTrip()], [
    day([item('A', { start_time: '08:00', author: '我', updated_at: t(5) }), item('B'), item('C'), item('D')]),
  ], clone(base.spots));
  const remote2 = snap('朋友', [makeTrip()], [
    day([item('A', { start_time: '07:00', author: '朋友', updated_at: t(6) }), item('B'), item('C'), item('D')]),
  ], clone(base.spots));
  const r2 = mergeSnapshots({ local: local2, remote: remote2, base });
  assert.equal(r2.conflicts.filter((c) => c.spotId === 'A' && c.field === 'start_time').length, 1);
  const a2 = r2.dayPlans[0].items.find((i) => i.spot_id === 'A')!;
  assert.equal(a2.start_time, '09:00', '确认前回退祖先值');
});

test('确认前不进入预算；确认同伴版后进入预算', () => {
  const base = baseFixture();
  const local = snap('我', [makeTrip()], [
    day([item('A'), item('B'), item('C', { note: '本地备注', author: '我', updated_at: t(8) }), item('D')]),
  ], clone(base.spots));
  const remote = snap('朋友', [makeTrip()], [day([item('A'), item('B'), item('D')])], clone(base.spots));

  const r = mergeSnapshots({ local, remote, base });
  const pending = buildPendingIndex(r.conflicts);
  const clean = confirmedDayPlans(r.dayPlans, pending, 'trip-1');
  // 已确认视图只有 A B D = 100+200+400 = 700（C=300 被挡）
  assert.equal(calcTripCost(clean, base.spots), 700);

  const key = conflictKey({ level: 'item', ownerId: 'trip-1', dayIndex: 1, spotId: 'C', field: EXISTENCE });
  const resolutions: ConflictResolution[] = [{ key, choose: 'remote' }]; // 同伴删除版
  const r2 = mergeSnapshots({ local, remote, base, resolutions });
  assert.ok(!r2.dayPlans[0].items.some((i) => i.spot_id === 'C'), '确认删除后 C 消失');
  assert.equal(r2.conflicts.length, 0);
  assert.equal(calcTripCost(r2.dayPlans, base.spots), 700);
});

test('旅行计划字段：不同字段同时生效，同字段冲突保留两版', () => {
  const base = baseFixture();
  const local = snap('我', [makeTrip({ title: '新标题', author: '我', updated_at: t(5) })], clone(base.dayPlans), clone(base.spots));
  const remote = snap('朋友', [makeTrip({ budget: 9999, author: '朋友', updated_at: t(6) })], clone(base.dayPlans), clone(base.spots));
  const r = mergeSnapshots({ local, remote, base });
  assert.equal(r.trips[0].title, '新标题');
  assert.equal(r.trips[0].budget, 9999);
  assert.equal(r.conflicts.length, 0);

  const local2 = snap('我', [makeTrip({ title: '本地名', author: '我', updated_at: t(5) })], clone(base.dayPlans), clone(base.spots));
  const remote2 = snap('朋友', [makeTrip({ title: '同伴名', author: '朋友', updated_at: t(6) })], clone(base.dayPlans), clone(base.spots));
  const r2 = mergeSnapshots({ local: local2, remote: remote2, base });
  assert.equal(r2.conflicts.filter((c) => c.level === 'trip' && c.field === 'title').length, 1);
});

test('景点逐项合并：单方改景点价格直接生效；双方改不同字段同时生效', () => {
  const base = baseFixture();
  const localSpots = clone(base.spots);
  localSpots[0].price = 150;
  localSpots[0].author = '我';
  localSpots[0].updated_at = t(5);
  const remoteSpots = clone(base.spots);
  remoteSpots[1].name = '改名的B';
  remoteSpots[1].author = '朋友';
  remoteSpots[1].updated_at = t(6);
  const r = mergeSnapshots({
    local: snap('我', clone(base.trips), clone(base.dayPlans), localSpots),
    remote: snap('朋友', clone(base.trips), clone(base.dayPlans), remoteSpots),
    base,
  });
  const spots = new Map(r.spots.map((s) => [s.id, s]));
  assert.equal(spots.get('A')!.price, 150);
  assert.equal(spots.get('B')!.name, '改名的B');
  assert.equal(r.spotConflicts.length, 0);
});

test('合并失败自动重试：前两次失败第三次成功，tries=3', async () => {
  let calls = 0;
  const { result, tries } = await withRetry(() => {
    calls++;
    if (calls < 3) throw new Error('瞬时错误');
    return 'ok';
  }, 3);
  assert.equal(result, 'ok');
  assert.equal(tries, 3);
  assert.equal(calls, 3);
});

test('重试仍失败抛出错误（调用方据此保留上一份可读结果，不覆盖）', async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(() => {
      calls++;
      throw new Error('持续失败');
    }, 3),
    /持续失败/,
  );
  assert.equal(calls, 3, '应恰好尝试 3 次');
});

test('坏快照直接触发引擎异常（被重试层捕获），而不是产出半成品结果', async () => {
  const base = baseFixture();
  const bad = { ...base, trips: null as unknown as Trip[] };
  let calls = 0;
  await assert.rejects(
    withRetry(() => {
      calls++;
      return mergeSnapshots({ local: base, remote: bad, base });
    }, 3),
  );
  assert.equal(calls, 3);
});

test('存在性冲突确认键可直接复跑：确认本地保留版后 C 回到预算', () => {
  const base = baseFixture();
  const local = snap('我', [makeTrip()], [
    day([item('A'), item('B'), item('C', { note: '本地备注', author: '我', updated_at: t(8) }), item('D')]),
  ], clone(base.spots));
  const remote = snap('朋友', [makeTrip()], [day([item('A'), item('B'), item('D')])], clone(base.spots));
  const key = conflictKey({ level: 'item', ownerId: 'trip-1', dayIndex: 1, spotId: 'C', field: EXISTENCE });
  const kept = mergeSnapshots({ local, remote, base, resolutions: [{ key, choose: 'local' }] });
  assert.ok(kept.dayPlans[0].items.some((i) => i.spot_id === 'C'), '选择保留本地版后 C 仍在');
  assert.equal(kept.conflicts.length, 0);
  assert.equal(calcTripCost(kept.dayPlans, base.spots), 1000);
});
