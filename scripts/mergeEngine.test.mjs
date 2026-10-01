import assert from 'node:assert';
import { mergeSnapshots, mergeDayOrder, itemTombstoneId, inferLocalTombstones } from '../src/utils/mergeEngine.ts';

let passed = 0;
const test = (name, fn) => {
  fn();
  passed += 1;
  console.log('  ✓', name);
};

const item = (spot_id, patch = {}) => ({ spot_id, start_time: '10:00', end_time: '12:00', note: 'n', transport: 'metro', updated_by: '我', updated_at: '2026-09-01T00:00:00.000Z', ...patch });
const day = (tripId, dayIndex, items, patch = {}) => ({ id: `d-${tripId}-${dayIndex}`, trip_id: tripId, day_index: dayIndex, date: '2026-10-01', items, updated_by: '我', updated_at: '2026-09-01T00:00:00.000Z', ...patch });
const trip = (id, patch = {}) => ({ id, title: 'T', destination: '杭州', start_date: '2026-10-01', end_date: '2026-10-03', budget: 1000, currency: 'CNY', members: ['我'], status: 'planning', created_at: '2026-09-01T00:00:00.000Z', updated_by: '我', updated_at: '2026-09-01T00:00:00.000Z', ...patch });
const tombs = () => ({ trips: [], dayPlans: [], dayItems: [], spots: [] });
const snap = (trips, dayPlans, extra = {}) => ({ deviceId: 'd', author: '我', exportedAt: 'x', trips, dayPlans, spots: [], tombstones: tombs(), ...extra });

// 1. 非冲突字段：只有一方修改，直接生效（无冲突）
test('trip: 仅同伴改标题直接生效', () => {
  const base = snap([trip('t1')], []);
  const local = snap([trip('t1')], []);
  const remote = snap([trip('t1', { title: '同伴标题', updated_by: '同伴', updated_at: '2026-09-02T00:00:00.000Z' })], []);
  const result = mergeSnapshots(local, remote, base);
  assert.equal(result.trips[0].title, '同伴标题');
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.stats.updated, 1);
});

// 2. 冲突字段：双方都改成不同内容，保留两版，暂存本机值
test('trip: 双方改不同标题 -> 两版冲突', () => {
  const t = trip('t1');
  const result = mergeSnapshots(
    snap([trip('t1', { title: '我的标题', updated_at: '2026-09-03T00:00:00.000Z' })], []),
    snap([trip('t1', { title: '同伴标题', updated_by: '同伴', updated_at: '2026-09-02T00:00:00.000Z' })], []),
    snap([t], []),
  );
  assert.equal(result.trips[0].title, '我的标题');
  const c = result.conflicts.find((c) => c.field === 'title');
  assert.ok(c);
  assert.equal(c.local.value, '我的标题');
  assert.equal(c.remote.value, '同伴标题');
  assert.equal(c.local.author, '我');
  assert.equal(c.remote.author, '同伴');
});

// 3. members 数组取并集
test('trip: members 双方各加人取并集', () => {
  const t = trip('t1', { members: ['我'] });
  const result = mergeSnapshots(
    snap([trip('t1', { members: ['我', 'A'], updated_at: '2026-09-03T00:00:00.000Z' })], []),
    snap([trip('t1', { members: ['我', 'B'], updated_by: '同伴', updated_at: '2026-09-02T00:00:00.000Z' })], []),
    snap([t], []),
  );
  assert.deepEqual(result.trips[0].members, ['我', 'A', 'B']);
  assert.equal(result.conflicts.length, 0);
});

// 4. 同一天按 spot 对齐：同伴新增 C，本机保留 A/B，顺序不被盖掉
test('dayItem: 同伴新增景点不覆盖本机顺序', () => {
  const result = mergeSnapshots(
    snap([trip('t1')], [day('t1', 1, [item('A'), item('B')])]),
    snap([trip('t1')], [day('t1', 1, [item('A'), item('B'), item('C', { updated_by: '同伴', updated_at: '2026-09-02T00:00:00.000Z' })], { updated_by: '同伴' })]),
    snap([trip('t1')], [day('t1', 1, [item('A'), item('B')])]),
  );
  const d = result.dayPlans[0];
  assert.deepEqual(d.items.map((i) => i.spot_id), ['A', 'B', 'C']);
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.stats.added, 1);
});

// 5. 双方各加一个不同景点：都保留
test('dayItem: 双方各加不同景点都保留', () => {
  const result = mergeSnapshots(
    snap([trip('t1')], [day('t1', 1, [item('A'), item('X', { updated_at: '2026-09-03T00:00:00.000Z' })])]),
    snap([trip('t1')], [day('t1', 1, [item('A'), item('Y', { updated_by: '同伴', updated_at: '2026-09-02T00:00:00.000Z' })], { updated_by: '同伴' })]),
    snap([trip('t1')], [day('t1', 1, [item('A')])]),
  );
  assert.deepEqual(result.dayPlans[0].items.map((i) => i.spot_id).sort(), ['A', 'X', 'Y']);
});

// 6. 删除 vs 纯移动：一方删除 C，另一方只是移动 C（内容没变）-> 删除与移动分开处理，保留两版
test('dayItem: 删除 vs 纯移动 -> 两版冲突待确认', () => {
  const base = snap([trip('t1')], [day('t1', 1, [item('A'), item('B'), item('C')])]);
  const localMoved = day('t1', 1, [item('C', { updated_at: '2026-09-03T00:00:00.000Z' }), item('A'), item('B')]);
  const remoteDay = day('t1', 1, [item('A'), item('B')], { updated_by: '同伴', updated_at: '2026-09-02T00:00:00.000Z' });
  const tombstones = tombs();
  tombstones.dayItems.push({ id: itemTombstoneId('t1', 1, 'C'), deleted_at: '2026-09-02T00:00:00.000Z', updated_by: '同伴', updated_at: '2026-09-02T00:00:00.000Z' });
  const result = mergeSnapshots(snap([trip('t1')], [localMoved]), snap([trip('t1')], [remoteDay], { tombstones, author: '同伴' }), base);
  const c = result.conflicts.find((c) => c.entity === 'dayItem' && c.spotId === 'C' && c.kind === 'existence');
  assert.ok(c, '删除 vs 移动应保留两版');
  assert.equal(c.remote.value, null);
});

// 6b. 删除 vs 完全未动：一方删 C，另一方顺序内容都没动 -> 删除直接生效
test('dayItem: 删除 vs 完全未动 -> 删除直接生效', () => {
  const base = snap([trip('t1')], [day('t1', 1, [item('A'), item('B'), item('C')])]);
  const localUntouched = day('t1', 1, [item('A'), item('B'), item('C')]);
  const remoteDay = day('t1', 1, [item('A'), item('B')], { updated_by: '同伴', updated_at: '2026-09-02T00:00:00.000Z' });
  const tombstones = tombs();
  tombstones.dayItems.push({ id: itemTombstoneId('t1', 1, 'C'), deleted_at: '2026-09-02T00:00:00.000Z', updated_by: '同伴', updated_at: '2026-09-02T00:00:00.000Z' });
  const result = mergeSnapshots(snap([trip('t1')], [localUntouched]), snap([trip('t1')], [remoteDay], { tombstones, author: '同伴' }), base);
  assert.deepEqual(result.dayPlans[0].items.map((i) => i.spot_id), ['A', 'B']);
  assert.equal(result.conflicts.length, 0);
});

// 7. 删除 vs 编辑内容：一方删 C，另一方改了 C 的备注 -> 存在性冲突，两版保留
test('dayItem: 删除 vs 编辑 -> 两版冲突待确认', () => {
  const base = snap([trip('t1')], [day('t1', 1, [item('A'), item('C')])]);
  const localEdited = day('t1', 1, [item('A'), item('C', { note: '我改的备注', updated_at: '2026-09-03T00:00:00.000Z' })]);
  const remoteDay = day('t1', 1, [item('A')], { updated_by: '同伴', updated_at: '2026-09-02T00:00:00.000Z' });
  const tombstones = tombs();
  tombstones.dayItems.push({ id: itemTombstoneId('t1', 1, 'C'), deleted_at: '2026-09-02T00:00:00.000Z', updated_by: '同伴', updated_at: '2026-09-02T00:00:00.000Z' });
  const result = mergeSnapshots(snap([trip('t1')], [localEdited]), snap([trip('t1')], [remoteDay], { tombstones, author: '同伴' }), base);
  const c = result.conflicts.find((c) => c.entity === 'dayItem' && c.spotId === 'C' && c.kind === 'existence');
  assert.ok(c, '应有 dayItem 存在性冲突');
  assert.equal(c.remote.value, null);
  assert.equal(c.local.value.note, '我改的备注');
  assert.equal(result.stats.conflicts, 1);
});

// 8. 同一条目字段双方改不同 -> 字段冲突
test('dayItem: 双方改不同备注 -> 字段冲突', () => {
  const base = snap([trip('t1')], [day('t1', 1, [item('A')])]);
  const local = snap([trip('t1')], [day('t1', 1, [item('A', { note: '我的', updated_at: '2026-09-03T00:00:00.000Z' })])]);
  const remote = snap([trip('t1')], [day('t1', 1, [item('A', { note: '同伴的', updated_by: '同伴', updated_at: '2026-09-02T00:00:00.000Z' })], { updated_by: '同伴' })]);
  const result = mergeSnapshots(local, remote, base);
  const c = result.conflicts.find((c) => c.entity === 'dayItem' && c.field === 'note');
  assert.ok(c);
  assert.equal(c.local.value, '我的');
  assert.equal(c.remote.value, '同伴的');
});

// 9. 移动合并：本机 A B C -> C A B；同伴不动 -> 尊重本机移动
test('order: 仅本机移动，同伴不动 -> 尊重本机', () => {
  const baseItems = [item('A'), item('B'), item('C')];
  const merged = mergeDayOrder({
    local: [item('C', { updated_at: '2026-09-03T00:00:00.000Z' }), item('A'), item('B')],
    remote: baseItems,
    base: baseItems,
  });
  assert.deepEqual(merged.map((i) => i.spot_id), ['C', 'A', 'B']);
});

// 10. 双方把不同条目移动到队首：两个移动都保留（X 与 C 相邻关系都满足）
test('order: 双方移动不同条目互不覆盖', () => {
  const baseItems = [item('A'), item('B'), item('C'), item('X')];
  // 本机把 X 移到队首；同伴把 C 移到队首
  const merged = mergeDayOrder({
    local: [item('X', { updated_at: '2026-09-03T00:00:00.000Z' }), item('A'), item('B'), item('C')],
    remote: [item('C', { updated_by: '同伴', updated_at: '2026-09-02T00:00:00.000Z' }), item('A'), item('B'), item('X')],
    base: baseItems,
  });
  const ids = merged.map((i) => i.spot_id);
  assert.deepEqual([...ids].sort(), ['A', 'B', 'C', 'X']);
  assert.ok(ids.indexOf('X') < ids.indexOf('B'), '本机的 X 应在 B 之前');
  assert.ok(ids.indexOf('C') < ids.indexOf('B'), '同伴的 C 应在 B 之前');
});

// 11. 同一条目双方都移动：更新时间晚的一方获胜
test('order: 同条目双方移动 -> updated_at 晚者胜', () => {
  const baseItems = [item('A'), item('B'), item('C')];
  // 本机把 C 放最后（即不动位置但盖戳）；同伴把 C 放队首且时间更晚
  const merged = mergeDayOrder({
    local: [item('A'), item('B'), item('C', { updated_at: '2026-09-02T00:00:00.000Z' })],
    remote: [item('C', { updated_by: '同伴', updated_at: '2026-09-03T00:00:00.000Z' }), item('A'), item('B')],
    base: baseItems,
  });
  assert.deepEqual(merged.map((i) => i.spot_id), ['C', 'A', 'B']);
  assert.equal(merged[0].updated_by, '同伴');
});

// 12. 整天删除 vs 完全未动：删除生效
test('dayPlan: 删除整天 vs 未动 -> 删除生效', () => {
  const base = snap([trip('t1')], [day('t1', 1, [item('A'), item('B')])]);
  const local = snap([trip('t1')], [day('t1', 1, [item('A'), item('B')])]);
  const tombstones = tombs();
  tombstones.dayPlans.push({ id: 't1#1', deleted_at: '2026-09-02T00:00:00.000Z', updated_by: '同伴', updated_at: '2026-09-02T00:00:00.000Z' });
  const remote = snap([trip('t1')], [], { tombstones, author: '同伴' });
  const result = mergeSnapshots(local, remote, base);
  assert.equal(result.dayPlans.length, 0);
  assert.equal(result.conflicts.length, 0);
});

// 12b. 整天删除 vs 仅调序：移动是独立意图，保留两版
test('dayPlan: 删除整天 vs 纯调序 -> 冲突', () => {
  const base = snap([trip('t1')], [day('t1', 1, [item('A'), item('B')])]);
  const local = snap([trip('t1')], [day('t1', 1, [item('B'), item('A')], { updated_at: '2026-09-03T00:00:00.000Z' })]);
  const tombstones = tombs();
  tombstones.dayPlans.push({ id: 't1#1', deleted_at: '2026-09-02T00:00:00.000Z', updated_by: '同伴', updated_at: '2026-09-02T00:00:00.000Z' });
  const remote = snap([trip('t1')], [], { tombstones, author: '同伴' });
  const result = mergeSnapshots(local, remote, base);
  assert.ok(result.conflicts.some((c) => c.entity === 'dayPlan' && c.kind === 'existence'));
});

// 13. 整天删除 vs 改日期：存在性冲突
test('dayPlan: 删除整天 vs 改日期 -> 冲突', () => {
  const base = snap([trip('t1')], [day('t1', 1, [item('A')])]);
  const local = snap([trip('t1')], [day('t1', 1, [item('A')], { date: '2026-10-05', updated_at: '2026-09-03T00:00:00.000Z' })]);
  const tombstones = tombs();
  tombstones.dayPlans.push({ id: 't1#1', deleted_at: '2026-09-02T00:00:00.000Z', updated_by: '同伴', updated_at: '2026-09-02T00:00:00.000Z' });
  const remote = snap([trip('t1')], [], { tombstones, author: '同伴' });
  const result = mergeSnapshots(local, remote, base);
  assert.ok(result.conflicts.some((c) => c.entity === 'dayPlan' && c.kind === 'existence'));
});

// 14. inferLocalTombstones：本地删了基线里的 item，导出时补墓碑
test('inferLocalTombstones: 本地删除被推断成墓碑', () => {
  const base = { trips: [trip('t1')], dayPlans: [day('t1', 1, [item('A'), item('B')])], spots: [], tombstones: tombs() };
  const inferred = inferLocalTombstones({ trips: [trip('t1')], dayPlans: [day('t1', 1, [item('A')])], spots: [], base, author: '我' });
  assert.ok(inferred.dayItems.some((t) => t.id === itemTombstoneId('t1', 1, 'B')));
});

// 15. 一方新增、另一方删除同一记录（加完又删）：以删除为准
test('trip: 同伴新增后又删除 -> 本地不出现', () => {
  const base = snap([], []);
  const local = snap([], []);
  const tombstones = tombs();
  tombstones.trips.push({ id: 't2', deleted_at: '2026-09-02T00:00:00.000Z', updated_by: '同伴', updated_at: '2026-09-02T00:00:00.000Z' });
  const remote = snap([], [], { tombstones, author: '同伴' });
  const result = mergeSnapshots(local, remote, base);
  assert.equal(result.trips.length, 0);
});

console.log(`\n${passed} 个合并引擎测试全部通过`);
