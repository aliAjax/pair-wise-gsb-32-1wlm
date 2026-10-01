import type { DayPlan, DayPlanItem } from '../models/dayPlan';
import type { Spot } from '../models/spot';
import type { Trip } from '../models/trip';
import type { SyncBase, SyncSnapshot } from '../models/sync';
import { itemTombstoneId } from './mergeEngine';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function stamp<T extends object>(record: T, author: string, at: string, fields: string[]): T {
  const result = { ...record };
  for (const field of fields) {
    if (field in result) (result as Record<string, unknown>)[field] = `【${author}改】${String((result as Record<string, unknown>)[field])}`;
  }
  return Object.assign(result, { updated_by: author, updated_at: at });
}

/**
 * 构造一份"同伴离线改动"演示快照。同伴从双方共同基线（base）出发：
 * 1. Trip 字段冲突（标题双方都改成不同内容）；
 * 2. 同一日内移动一个景点（与本机各自移动不同条目，检验删除与移动分开）；
 * 3. 新增一个景点（对齐后插入，不覆盖本机顺序）；
 * 4. 删除一个景点（本机若同时编辑了它的内容 => 删除 vs 编辑冲突；否则直接移除）；
 * 5. Spot 字段非冲突修改（本机未动则直接生效）。
 */
export function buildDemoRemote(input: {
  trips: Trip[];
  dayPlans: DayPlan[];
  spots: Spot[];
  base: SyncBase | null;
  author: string;
  localAuthor: string;
}): SyncSnapshot {
  const at = new Date(Date.now() + 60_000).toISOString();
  const author = input.author || '同伴';
  // 同伴手里是共同基线；没有基线时以本机现状兜底（首次演示）。
  const trips = clone(input.base?.trips ?? input.trips);
  const dayPlans = clone(input.base?.dayPlans ?? input.dayPlans);
  const spots = clone(input.base?.spots ?? input.spots);
  const tombstones = {
    trips: clone(input.base?.tombstones.trips ?? []),
    dayPlans: clone(input.base?.tombstones.dayPlans ?? []),
    dayItems: clone(input.base?.tombstones.dayItems ?? []),
    spots: clone(input.base?.tombstones.spots ?? []),
  };

  if (trips[0]) {
    trips[0] = stamp(trips[0], author, at, ['title']);
  }
  if (spots[0]) {
    spots[0] = stamp(spots[0], author, at, ['address']);
  }

  const firstDay = dayPlans[0];
  let removedSpotId: string | undefined;
  if (firstDay) {
    const meta = { updated_by: author, updated_at: at };
    if (firstDay.items[1]) {
      // 同伴把第 2 个景点移到队首。
      const [moved] = firstDay.items.splice(1, 1);
      firstDay.items.unshift({ ...moved, ...meta });
    }
    // 删除队尾的基线景点（在新增之前做，避免删到自己刚加的）。
    if (firstDay.items.length > 1) {
      removedSpotId = firstDay.items.pop()?.spot_id;
    }
    if (input.spots[3] && !firstDay.items.some((item) => item.spot_id === input.spots[3].id)) {
      // 同伴新增一个景点到队尾。
      const added: DayPlanItem = {
        spot_id: input.spots[3].id,
        start_time: '20:00',
        end_time: '21:30',
        note: '同伴加的夜景',
        transport: 'taxi',
        ...meta,
      };
      firstDay.items.push(added);
    }
    firstDay.updated_by = author;
    firstDay.updated_at = at;
  }
  if (firstDay && removedSpotId) {
    const id = itemTombstoneId(firstDay.trip_id, firstDay.day_index, removedSpotId);
    if (!tombstones.dayItems.some((t) => t.id === id)) {
      tombstones.dayItems.push({ id, deleted_at: at, updated_by: author, updated_at: at });
    }
  }

  return { deviceId: 'demo-friend-device', author, exportedAt: at, trips, dayPlans, spots, tombstones };
}
