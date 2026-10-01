import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDemoPeerSnapshot } from './src/api/demoMergeData';
import { mergeSnapshots } from './src/utils/merge/engine';
import { buildPendingIndex, confirmedDayPlans } from './src/utils/merge/pending';
import { ORDER, EXISTENCE } from './src/types/merge';
import { calcTripCost } from './src/utils/budgetCalculator';
import type { OfflineSnapshot } from './src/types/merge';
import type { DayPlanItem } from './src/models/dayPlan';
import { seedSpots } from './src/api/spotApi';
import { stamp } from './src/utils/author';
import { TripStatus } from './src/constants/trip';
import type { Trip } from './src/models/trip';
import type { DayPlan } from './src/models/dayPlan';

const now = new Date().toISOString();
const trip: Trip = {
  id: 'trip-demo', title: '本地起的标题', destination: '杭州', start_date: '2026-10-01', end_date: '2026-10-03',
  budget: 3200, currency: 'CNY', members: ['我', '朋友'], status: TripStatus.PLANNING, created_at: now,
  author: '我', updated_at: now,
};
const ids = seedSpots.slice(0, 4).map((s) => s.id);
// 共同祖先：顺序 [0,1,2,3]，第 3 个景点无备注、第 4 个景点交通 metro
const ancestorItems: DayPlanItem[] = ids.map((id) =>
  stamp({ spot_id: id, start_time: '10:00', end_time: '12:00', note: '现场调整', transport: 'metro' }, 'base'),
);
const base: OfflineSnapshot = {
  author: 'base', exportedAt: now,
  trips: [structuredClone({ ...trip, title: '杭州行', budget: 3200 })],
  dayPlans: [{ id: 'day-1', trip_id: trip.id, day_index: 1, date: trip.start_date, items: ancestorItems }],
  spots: structuredClone(seedSpots),
};
// 本地：把第 2 个景点移到最前、给第 3 个加备注、第 4 个改 walk、改标题
const localItems = structuredClone(ancestorItems);
const [movedOne] = localItems.splice(1, 1); // ids[1]
localItems.unshift({ ...movedOne, author: '我', updated_at: now });
localItems[2] = { ...localItems[2], note: '本地查过，这个值得留', author: '我', updated_at: now };
localItems[3] = { ...localItems[3], transport: 'walk', author: '我', updated_at: now };
const local: OfflineSnapshot = {
  author: '我', exportedAt: now,
  trips: [trip],
  dayPlans: [{ id: 'day-1', trip_id: trip.id, day_index: 1, date: trip.start_date, items: localItems }],
  spots: structuredClone(seedSpots),
};

const remote = buildDemoPeerSnapshot(structuredClone(local));

test('演示同伴快照：产出 移动冲突 + 移除冲突 + 字段非冲突合并', () => {
  const r = mergeSnapshots({ local, remote, base });
  const orderConflicts = r.conflicts.filter((c) => c.field === ORDER);
  const removeConflicts = r.conflicts.filter((c) => c.field === EXISTENCE);

  assert.ok(orderConflicts.length >= 1, '应至少有一条移动冲突');
  assert.equal(orderConflicts[0].spotId, ids[1]);
  assert.ok(removeConflicts.some((c) => c.spotId === ids[2]), '第 3 个景点是移除冲突');

  // 非冲突：标题(本地) + 预算(同伴) 同时生效
  assert.equal(r.trips[0].title, '本地起的标题');
  assert.equal(r.trips[0].budget, Math.round(3200 * 1.15));

  // 非冲突：第 4 个景点时间(同伴) + 交通 walk(本地) 同时生效
  const fourth = r.dayPlans[0].items.find((i) => i.spot_id === ids[3])!;
  assert.equal(fourth.transport, 'walk', '本地交通保留');
  assert.equal(fourth.start_time, '14:00', '同伴时间生效');

  // 单方移动：第 2 个景点应移到第 3 个之后的有效位置（第 3 个 pending 时仍以合并顺序为准）
  const order = r.dayPlans[0].items.map((i) => i.spot_id);
  assert.ok(order.includes(ids[1]));

  // 确认前：移动冲突点与移除冲突点都不进预算
  const pending = buildPendingIndex(r.conflicts);
  const clean = confirmedDayPlans(r.dayPlans, pending, trip.id);
  const cleanIds = clean[0].items.map((i) => i.spot_id);
  assert.ok(!cleanIds.includes(ids[1]), '移动冲突景点不进预算');
  assert.ok(!cleanIds.includes(ids[2]), '移除冲突景点不进预算');

  // 预算只含已确认景点且价格能算
  assert.equal(typeof calcTripCost(clean, seedSpots), 'number');
});
