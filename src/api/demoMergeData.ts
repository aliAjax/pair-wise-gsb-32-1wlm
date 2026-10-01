import type { OfflineSnapshot } from '../types/merge';
import type { DayPlanItem } from '../models/dayPlan';
import { stamp } from '../utils/author';

const iso = (offsetMin: number) => new Date(Date.now() + offsetMin * 60000).toISOString();

/**
 * 以本机快照为基础，构造“同伴”离线回来时的一版改动，专门覆盖三类情形：
 * 1. 仅同伴移动某景点（无冲突，应直接生效，本地其他顺序不能被盖掉）；
 * 2. 双方都移动同一景点到不同位置（移动冲突，保留两版）；
 * 3. 同伴移除、本地仍保留（移除冲突，待确认）；
 * 4. 同一景点双方改了不同/相同字段（字段冲突 vs 直接合并）。
 * 若当前还没有行程，先保证第 1 天有 4 个景点可供演示。
 */
export function buildDemoPeerSnapshot(local: OfflineSnapshot): OfflineSnapshot {
  const peer: OfflineSnapshot = {
    author: '朋友',
    exportedAt: new Date().toISOString(),
    trips: structuredClone(local.trips),
    dayPlans: structuredClone(local.dayPlans),
    spots: structuredClone(local.spots),
  };

  const trip = peer.trips[0];
  if (!trip) return peer;

  // 保证至少 4 个景点在第 1 天
  const spotIds = peer.spots.slice(0, 4).map((s) => s.id);
  let day = peer.dayPlans.find((d) => d.trip_id === trip.id && d.day_index === 1);
  if (!day) {
    day = { id: crypto.randomUUID(), trip_id: trip.id, day_index: 1, date: trip.start_date, items: [] };
    peer.dayPlans.push(day);
  }
  for (const spotId of spotIds) {
    if (!day.items.some((i) => i.spot_id === spotId)) {
      const item: DayPlanItem = stamp(
        { spot_id: spotId, start_time: '09:00', end_time: '11:00', note: '待安排', transport: 'metro' },
        '朋友',
      );
      day.items.push(item);
    }
  }

  // 旅行计划：同伴改预算，本地改标题（不同字段，非冲突应同时生效）
  trip.budget = Math.round(trip.budget * 1.15);
  trip.author = '朋友';
  trip.updated_at = iso(30);

  // 景点字段：同伴改第一个景点的 note 无关；改景点价格（本地未改则直接生效）
  const firstSpot = peer.spots.find((s) => s.id === spotIds[0]);
  if (firstSpot) {
    firstSpot.price = Math.round(firstSpot.price * 1.2) || 88;
    firstSpot.author = '朋友';
    firstSpot.updated_at = iso(40);
  }

  // 此时顺序（本地）：[1, 0, 2, 3]
  // 1) 同伴把第 2 个景点(1)移到最后（本地把它移到最前 -> 双方移动冲突）
  // 2) 同伴把第 1 个景点(0)插到第 3 个景点(2)之后（本地没动它 -> 单方移动，直接生效）
  const order = [...day.items];
  const move = (id: string, afterId: string | null) => {
    const i = order.findIndex((it) => it.spot_id === id);
    if (i < 0) return;
    const [it] = order.splice(i, 1);
    const stamped = stamp({ ...it }, '朋友');
    if (afterId === null) order.unshift(stamped);
    else {
      const at = order.findIndex((x) => x.spot_id === afterId);
      order.splice(at >= 0 ? at + 1 : order.length, 0, stamped);
    }
  };
  if (spotIds[1]) move(spotIds[1], spotIds[3]); // 1 -> 末尾（移动冲突）
  if (spotIds[0]) move(spotIds[0], spotIds[2]); // 0 -> 2 之后（单方移动）

  // 3) 同伴移除第 3 个景点（本地保留则形成移除冲突；本地也删除则直接生效）
  const removedId = spotIds[2];
  day.items = order.filter((it) => it.spot_id !== removedId);

  // 4) 同伴改第 4 个景点的时间与备注（本地改的是交通 walk -> 不同字段非冲突同时生效）
  const fourth = day.items.find((it) => it.spot_id === spotIds[3]);
  if (fourth) {
    fourth.start_time = '14:00';
    fourth.end_time = '16:30';
    fourth.note = '同伴查到周一闭馆，改到下午';
    fourth.author = '朋友';
    fourth.updated_at = iso(50);
  }

  day.author = '朋友';
  day.updated_at = iso(60);

  return peer;
}
