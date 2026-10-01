import type { OrderConflict } from '../../types/merge';
import type { DayPlanItem } from '../../models/dayPlan';

/** 一侧行程在顺序合并阶段的视图 */
export interface OrderSideView {
  /** 景点 -> 所在天 */
  dayIndexOf: Map<string, number>;
  /** 景点 -> 当天的条目（取作者/时间） */
  items: Map<string, DayPlanItem>;
  /** 每天的景点顺序 */
  days: Map<number, string[]>;
}

export interface OrderMergeResult {
  /** 每个景点最终归到哪一天（未决的跨天冲突先按本地天落位） */
  targetDay: Map<string, number>;
  /** 每天最终顺序；未决顺序冲突景点暂挂在末尾，由 pending 标记挡在预算/分享之外 */
  orders: Map<number, string[]>;
  conflicts: OrderConflict[];
}

export interface OrderResolution {
  choose: 'local' | 'remote';
}

interface Pos {
  order: number;
  prev: string | null;
  next: string | null;
}

const posOf = (list: string[] | undefined, id: string): Pos => {
  const l = list ?? [];
  const i = l.indexOf(id);
  return { order: i, prev: i > 0 ? l[i - 1] : null, next: i >= 0 && i < l.length - 1 ? l[i + 1] : null };
};
const samePos = (a: Pos, b: Pos) => a.prev === b.prev && a.next === b.next;
const authorOf = (view: OrderSideView, id: string) => view.items.get(id)?.author || '同伴';

/** 两个序列的最长公共子序列（保持相对顺序） */
function lcs(a: string[], b: string[]): string[] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push(a[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return out;
}

/** 元素在某侧相对祖先是否移动：用“前方元素集合”比较，避免把被连带挪动的旁观者误判成移动 */
function beforeSet(list: string[] | undefined, id: string): Set<string> {
  const l = list ?? [];
  return new Set(l.slice(0, Math.max(0, l.indexOf(id))));
}
function eqSet(a: Set<string>, b: Set<string>) {
  return a.size === b.size && [...a].every((x) => b.has(x));
}
function movedInDay(sideList: string[] | undefined, baseList: string[] | undefined, id: string): boolean {
  if (!baseList || !baseList.includes(id)) return true; // 新增的景点
  return !eqSet(beforeSet(baseList, id), beforeSet(sideList, id));
}
/** 落点锚点（前一个景点；null=天开头），用于把单方移动插入主序 */
function anchorOf(list: string[] | undefined, id: string): string | null {
  return posOf(list, id).prev;
}

/**
 * 移动合并（与“移除”严格分开：这里只处理仍存在的景点）。
 *
 * 以共同祖先为基准判定每个景点“谁动过”：
 * - 只有一方移动 => 非冲突，直接采用移动后的位置，另一方未动的相对顺序用 LCS 骨架保留；
 * - 双方都移动同一景点、但落点锚点（前/后相邻景点）不同（或移到不同天）=> 顺序冲突，保留两版待确认；
 * - 双方都移动但落点一致 => 自然一致，直接生效；
 * - 没有共同祖先时无法判定谁动过：两侧顺序不同一律保守挂冲突，绝不静默盖掉任何一版。
 */
export function mergeItemOrders(
  spotIds: string[],
  base: OrderSideView | undefined,
  local: OrderSideView,
  remote: OrderSideView,
  resolutionMap: Map<string, OrderResolution>,
  conflictKeyOf: (spotId: string) => string,
): OrderMergeResult {
  const conflicts: OrderConflict[] = [];
  const pending = new Set<string>();
  const targetDay = new Map<string, number>();

  const movedLocal = (id: string, day: number) => {
    if (!base) return true;
    const bd = base.dayIndexOf.get(id);
    if (bd !== day) return true; // 跨天
    return movedInDay(local.days.get(day), base.days.get(bd), id);
  };
  const movedRemote = (id: string, day: number) => {
    if (!base) return true;
    const bd = base.dayIndexOf.get(id);
    if (bd !== day) return true;
    return movedInDay(remote.days.get(day), base.days.get(bd), id);
  };

  // ---- 1. 跨天移动裁决：决定每个景点最终归哪天 ----
  for (const id of spotIds) {
    const ld = local.dayIndexOf.get(id);
    const rd = remote.dayIndexOf.get(id);
    if (ld != null && rd == null) targetDay.set(id, ld);
    else if (rd != null && ld == null) targetDay.set(id, rd);
    else if (ld === rd) targetDay.set(id, ld!);
    else {
      const key = conflictKeyOf(id);
      const resolution = resolutionMap.get(key);
      if (resolution) {
        targetDay.set(id, resolution.choose === 'remote' ? rd! : ld!);
        continue;
      }
      if (movedLocal(id, ld!) && movedRemote(id, rd!)) {
        conflicts.push(buildConflict(id, local, remote, ld!, rd!));
        pending.add(id);
        targetDay.set(id, ld!);
      } else if (movedLocal(id, ld!)) {
        targetDay.set(id, ld!);
      } else {
        targetDay.set(id, rd!);
      }
    }
  }

  // ---- 2. 每天的前后移动冲突 + 合并顺序 ----
  const days = new Set<number>([...local.days.keys(), ...remote.days.keys(), ...targetDay.values()]);
  const orders = new Map<number, string[]>();

  for (const day of days) {
    const lList = (local.days.get(day) ?? []).filter((id) => targetDay.get(id) === day);
    const rList = (remote.days.get(day) ?? []).filter((id) => targetDay.get(id) === day);
    const bList = (base?.days.get(day) ?? []).filter((id) => spotIds.includes(id) && targetDay.get(id) === day);

    // 同天内、双方都动但锚点不同 => 冲突
    for (const id of new Set([...lList, ...rList])) {
      if (pending.has(id)) continue;
      const inL = lList.includes(id);
      const inR = rList.includes(id);
      if (!inL || !inR) continue;
      const lp = posOf(lList, id);
      const rp = posOf(rList, id);
      if (samePos(lp, rp)) continue;
      const key = conflictKeyOf(id);
      if (resolutionMap.has(key)) continue;
      if (movedLocal(id, day) && movedRemote(id, day)) {
        // 进一步要求“落点不同”：两侧锚点不同才算不兼容
        conflicts.push(buildConflict(id, local, remote, day, day));
        pending.add(id);
      }
    }

    // 已确认顺序冲突的景点：按确认侧整段顺序主导；未确认的暂时摘出
    const lActive = lList.filter((id) => !pending.has(id));
    const rActive = rList.filter((id) => !pending.has(id));

    let merged: string[];
    if (!base) {
      // 无祖先：顺序不同则保守挂冲突；相同才直接采用
      if (JSON.stringify(lActive) === JSON.stringify(rActive)) merged = [...lActive];
      else {
        for (const id of new Set([...lActive, ...rActive])) {
          const lp = posOf(lActive, id);
          const rp = posOf(rActive, id);
          if (lp.order < 0 || rp.order < 0) continue;
          if (!samePos(lp, rp) && !conflicts.some((c) => c.spotId === id)) {
            conflicts.push(buildConflict(id, local, remote, day, day));
            pending.add(id);
          }
        }
        merged = [...lActive];
      }
    } else {
      merged = reconcileDay(bList, lActive, rActive, conflictKeyOf, resolutionMap);
    }

    // 未决顺序冲突景点暂挂当天末尾（pending 会挡在预算/分享之外）
    for (const id of [...pending].filter((id) => targetDay.get(id) === day)) {
      if (!merged.includes(id)) merged.push(id);
    }
    orders.set(day, merged);
  }

  return { targetDay, orders, conflicts: conflicts.filter((c) => !resolutionMap.has(conflictKeyOf(c.spotId))) };
}

/**
 * 单天顺序调和（基于共同祖先锚点）：
 * 1. 以双方保留下来的公共相对顺序（LCS）作为稳定主序；
 * 2. 只在一侧出现移动的景点，按该侧的“前一个锚点”插入主序（单方移动直接生效）；
 * 3. 两侧都移动同一景点但锚点不兼容（顺序冲突），未确认者摘出末尾挂起；已确认者按所选侧插入。
 */
function reconcileDay(
  baseList: string[],
  lList: string[],
  rList: string[],
  conflictKeyOf: (spotId: string) => string,
  resolutionMap: Map<string, OrderResolution>,
): string[] {
  const skeleton = lcs(lList, rList);
  const inSkeleton = new Set(skeleton);

  // 每个非骨架元素的插入锚点（来自它“发生移动”的那一侧）
  const insertAfter = new Map<string, { anchor: string | null; side: 'l' | 'r' }>();
  const contested = new Set<string>();

  for (const id of new Set([...lList, ...rList])) {
    if (inSkeleton.has(id)) continue;
    const onL = lList.includes(id);
    const onR = rList.includes(id);
    const lAnchor = onL ? anchorOf(lList, id) : undefined;
    const rAnchor = onR ? anchorOf(rList, id) : undefined;
    const lMoved = onL ? movedInDay(lList, baseList, id) : false;
    const rMoved = onR ? movedInDay(rList, baseList, id) : false;

    if (onL && onR && lMoved && rMoved && lAnchor !== rAnchor) {
      // 双方都移动到不同锚点 => 顺序冲突
      if (!resolutionMap.has(conflictKeyOf(id))) {
        contested.add(id);
        continue;
      }
      const chooseRemote = resolutionMap.get(conflictKeyOf(id))!.choose === 'remote';
      insertAfter.set(id, { anchor: chooseRemote ? rAnchor! : lAnchor!, side: chooseRemote ? 'r' : 'l' });
    } else if (onL && onR) {
      // 两侧都在，但锚点一致（含一方未动）=> 用非祖先那侧，或本地侧
      const anchor = lMoved ? lAnchor : rAnchor;
      insertAfter.set(id, { anchor: anchor!, side: lMoved ? 'l' : 'r' });
    } else if (onL) {
      insertAfter.set(id, { anchor: lAnchor!, side: 'l' });
    } else if (onR) {
      insertAfter.set(id, { anchor: rAnchor!, side: 'r' });
    }
  }

  // 组装：从骨架的每个锚点位置插入对应元素；锚点指向另一个待插入元素时按拓扑推进
  const result: string[] = [];
  const placed = new Set<string>();
  const byAnchor = (anchor: string | null) =>
    [...insertAfter.entries()].filter(([, v]) => v.anchor === anchor).map(([id]) => id);

  const placeAt = (anchor: string | null) => {
    for (const id of byAnchor(anchor)) {
      if (placed.has(id) || contested.has(id)) continue;
      result.push(id);
      placed.add(id);
      // 以该元素为锚点的后续元素
      placeAt(id);
    }
  };

  placeAt(null);
  for (const sk of skeleton) {
    result.push(sk);
    placed.add(sk);
    placeAt(sk);
  }
  // 保险：任何未放置的非冲突元素补到末尾
  for (const id of insertAfter.keys()) {
    if (!placed.has(id) && !contested.has(id)) {
      result.push(id);
      placed.add(id);
    }
  }
  // 未决顺序冲突景点末尾挂起（由 pending 挡在预算/分享外）
  for (const id of contested) result.push(id);
  return result;
}

function buildConflict(id: string, local: OrderSideView, remote: OrderSideView, ld: number, rd: number): OrderConflict {
  const l = posOf(local.days.get(ld), id);
  const r = posOf(remote.days.get(rd), id);
  return {
    spotId: id,
    localDayIndex: ld,
    remoteDayIndex: rd,
    localPrevSpotId: l.prev,
    remotePrevSpotId: r.prev,
    localNextSpotId: l.next,
    remoteNextSpotId: r.next,
    localOrder: l.order,
    remoteOrder: r.order,
    localAuthor: authorOf(local, id),
    remoteAuthor: authorOf(remote, id),
  };
}
