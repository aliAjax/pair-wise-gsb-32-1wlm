/** 相对基线被移动过的共同条目（LCS 之外即位置变化；纯新增不算移动）。 */
function movedSet(sideOrder: string[], baseOrder: string[]): Set<string> {
  const sideCommon = sideOrder.filter((id) => baseOrder.includes(id));
  const baseCommon = baseOrder.filter((id) => sideOrder.includes(id));
  const pairs = lcsIndices(sideCommon, baseCommon);
  const stable = new Set(pairs.map(([si]) => sideCommon[si]));
  return new Set(sideCommon.filter((id) => !stable.has(id)));
}

/**
 * 合并同一天内的景点顺序（删除已在更上游处理，这里只排存活条目）。
 *
 * 锚点插入法：
 * - 未被主张移动的条目先按基线顺序铺好；
 * - 只被一侧移动/新增的条目，按该侧序列里的相邻锚点插入，另一侧顺序原样保留；
 * - 两侧都移动同一批条目且主张冲突时，由条目 updated_at 更晚一方的序列统一裁决；
 * - 任何没有主张的相对关系都回落到基线名次，绝不整组覆盖任一方顺序。
 */
export function mergeDayOrder(opts: {
  local: DayPlanItem[];
  remote: DayPlanItem[];
  base: DayPlanItem[];
}): DayPlanItem[] {
  const { local, remote, base } = opts;
  const localOrder = local.map((item) => item.spot_id);
  const remoteOrder = remote.map((item) => item.spot_id);
  const baseOrder = base.map((item) => item.spot_id);

  const itemMap = new Map<string, DayPlanItem>();
  for (const item of base) itemMap.set(item.spot_id, item);
  for (const item of local) itemMap.set(item.spot_id, item);
  for (const item of remote) itemMap.set(item.spot_id, item);

  const survivors = new Set([...localOrder, ...remoteOrder]);
  const baseRank = new Map((baseOrder.length ? baseOrder : [...localOrder, ...remoteOrder]).map((id, index) => [id, index]));
  const movedLocal = movedSet(localOrder, baseOrder);
  const movedRemote = movedSet(remoteOrder, baseOrder);
  const localMoveTime = Math.max(...local.filter((i) => movedLocal.has(i.spot_id)).map((i) => Date.parse(metaOf(i).updated_at) || 0), 0);
  const remoteMoveTime = Math.max(...remote.filter((i) => movedRemote.has(i.spot_id)).map((i) => Date.parse(metaOf(i).updated_at) || 0), 0);
  const localWinsMove = localMoveTime >= remoteMoveTime;

  // 每个被移动/新增的条目选择主张侧：只有一侧动 => 听该侧；两侧都动 => 时间晚者胜。
  const preferred = new Map<string, { side: 1 | 2; rank: number }>();
  localOrder.forEach((id, rank) => {
    const moved = movedLocal.has(id) || !baseRank.has(id);
    if (!moved) return;
    if (movedRemote.has(id) && !localWinsMove) return;
    if (!preferred.has(id)) preferred.set(id, { side: 1, rank });
  });
  remoteOrder.forEach((id, rank) => {
    const moved = movedRemote.has(id) || !baseRank.has(id);
    if (!moved) return;
    if (movedLocal.has(id) && localWinsMove) return;
    preferred.set(id, { side: 2, rank });
  });

  // 未被主张的条目按基线顺序铺底。
  const result: string[] = [...survivors]
    .filter((id) => !preferred.has(id))
    .sort((a, b) => (baseRank.get(a) ?? Number.MAX_SAFE_INTEGER) - (baseRank.get(b) ?? Number.MAX_SAFE_INTEGER));

  const insertions = [...preferred.entries()]
    .map(([id, pref]) => ({ id, ...pref }))
    .sort((a, b) => a.rank - b.rank || (baseRank.get(a.id) ?? 0) - (baseRank.get(b.id) ?? 0));

  for (const { id, side, rank } of insertions) {
    const order = side === 1 ? localOrder : remoteOrder;
    let insertAt = -1;
    // 前锚点：该侧序列中前一个存活且已放置的条目。
    for (let k = rank - 1; k >= 0 && insertAt < 0; k -= 1) {
      const anchor = result.indexOf(order[k]);
      if (survivors.has(order[k]) && anchor >= 0) insertAt = anchor + 1;
    }
    // 后锚点兜底。
    for (let k = rank + 1; k < order.length && insertAt < 0; k += 1) {
      const anchor = result.indexOf(order[k]);
      if (survivors.has(order[k]) && anchor >= 0) insertAt = anchor;
    }
    const existed = result.indexOf(id);
    if (existed >= 0) result.splice(existed, 1);
    result.splice(insertAt < 0 ? result.length : insertAt, 0, id);
  }

  return result.map((id) => itemMap.get(id)!).filter(Boolean);
}
