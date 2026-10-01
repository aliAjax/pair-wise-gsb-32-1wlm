// ---------------------------------------------------------------------------
// DayPlan 合并：按 (trip_id, day_index) 对齐；同一日内 items 按 spot_id 逐项对齐，
// 删除与移动分开判断，顺序最后交给 mergeDayOrder。
// ---------------------------------------------------------------------------

const DAY_SCALAR_FIELDS: MergeField[] = ['date'];
const ITEM_SCALAR_FIELDS: MergeField[] = ['start_time', 'end_time', 'note', 'transport'];

/** 规范化一天：去掉 id/元数据，景点按 spot_id 排序，使"纯移动顺序"不被当作内容编辑。 */
function canonicalDay(day: DayPlan): AnyObject {
  return {
    trip_id: day.trip_id,
    day_index: day.day_index,
    date: day.date,
    items: [...day.items]
      .map((item) => stableClone(item, new Set<string>(ITEM_META_FIELDS as unknown as string[])))
      .sort((a, b) => String(a.spot_id).localeCompare(String(b.spot_id))),
  };
}

type ItemTombTuple = { tripId: string; dayIndex: number; spotId: string; tomb: DeletedRecord };

function parseItemTombstone(tomb: DeletedRecord): ItemTombTuple | null {
  const parts = tomb.id.split('#');
  if (parts.length !== 3) return null;
  return { tripId: parts[0], dayIndex: Number(parts[1]), spotId: parts[2], tomb };
}

function itemTombOf(list: DeletedRecord[], tripId: string, dayIndex: number, spotId: string) {
  return list.find((t) => t.id === itemTombstoneId(tripId, dayIndex, spotId));
}

function mergeDayPlans(opts: {
  local: DayPlan[];
  remote: DayPlan[];
  base: DayPlan[];
  tombstones: { local: DeletedRecord[]; remote: DeletedRecord[]; base: DeletedRecord[] };
  conflicts: MergeConflict[];
  counter: MergeCounter;
}): { alive: DayPlan[]; deleted: DeletedRecord[] } {
  const { conflicts, counter } = opts;
  const keyOf = (day: DayPlan) => dayTombstoneId(day.trip_id, day.day_index);
  const indexOf = (list: DayPlan[]) => new Map(list.map((day) => [keyOf(day), day]));
  const localMap = indexOf(opts.local);
  const remoteMap = indexOf(opts.remote);
  const baseMap = indexOf(opts.base);
  const keys = new Set([...localMap.keys(), ...remoteMap.keys(), ...baseMap.keys()]);
  const alive: DayPlan[] = [];
  const deleted: DeletedRecord[] = [];
  const emittedItemTombstones: DeletedRecord[] = [];
  const newDayTomb = (key: string, source: SyncMeta): DeletedRecord => ({
    id: key,
    deleted_at: source.updated_at || nowIso(),
    updated_by: source.updated_by,
    updated_at: source.updated_at || nowIso(),
  });
  const pushItemTomb = (tripId: string, dayIndex: number, spotId: string, source: SyncMeta) => {
    const tomb: DeletedRecord = {
      id: itemTombstoneId(tripId, dayIndex, spotId),
      deleted_at: source.updated_at || nowIso(),
      updated_by: source.updated_by,
      updated_at: source.updated_at || nowIso(),
    };
    if (!emittedItemTombstones.some((item) => item.id === tomb.id)) emittedItemTombstones.push(tomb);
  };

  const itemTombstones = {
    local: opts.tombstones.local.map(parseItemTombstone).filter(Boolean) as ItemTombTuple[],
    remote: opts.tombstones.remote.map(parseItemTombstone).filter(Boolean) as ItemTombTuple[],
    base: opts.tombstones.base.map(parseItemTombstone).filter(Boolean) as ItemTombTuple[],
  };

  for (const key of keys) {
    const [tripId, dayIndexRaw] = key.split('#');
    const dayIndex = Number(dayIndexRaw);
    const l = localMap.get(key);
    const r = remoteMap.get(key);
    const b = baseMap.get(key);
    const lDayTomb = findTombstone(opts.tombstones.local, key);
    const rDayTomb = findTombstone(opts.tombstones.remote, key);
    const dayId = l?.id || r?.id || b?.id || crypto.randomUUID();

    // 一天的新增（基线没有这一天）。
    if (!b) {
      if (l && r) {
        alive.push(mergeOneDay({ tripId, dayIndex, dayId, base: undefined, local: l, remote: r, conflicts, counter, itemTombstones, pushItemTomb }));
      } else if (l) {
        alive.push(l);
        counter.added += 1;
      } else if (r) {
        alive.push(r);
        counter.added += 1;
      } else if (lDayTomb || rDayTomb) {
        deleted.push(newDayTomb(key, metaOf(lDayTomb || rDayTomb)));
      }
      continue;
    }

    const lState: 'alive' | 'deleted' | 'untouched' = l ? 'alive' : lDayTomb ? 'deleted' : 'untouched';
    const rState: 'alive' | 'deleted' | 'untouched' = r ? 'alive' : rDayTomb ? 'deleted' : 'untouched';

    // 删除整天 vs 纯调序（没改内容）：删除生效；删除 vs 改日期/景点内容：冲突留两版。
    const dayChanged = (day: DayPlan) => !sameContent(canonicalDay(day), canonicalDay(b));
    if (lState === 'deleted' && (rState === 'deleted' || (r && !dayChanged(r)))) {
      deleted.push(newDayTomb(key, metaOf(lDayTomb || rDayTomb)));
      counter.removed += 1;
      continue;
    }
    if (rState === 'deleted' && l && !dayChanged(l)) {
      deleted.push(newDayTomb(key, metaOf(rDayTomb)));
      counter.removed += 1;
      continue;
    }
    if (lState === 'deleted' && r) {
      conflicts.push({
        id: crypto.randomUUID(),
        entity: 'dayPlan',
        entityId: dayId,
        tripId,
        dayId,
        dayIndex,
        field: '__existence__',
        kind: 'existence',
        local: versionOf(lDayTomb, metaOf(lDayTomb).updated_by),
        remote: versionOf(r, '同伴'),
      });
      alive.push(r);
      counter.removed += 1;
      continue;
    }
    if (rState === 'deleted' && l) {
      conflicts.push({
        id: crypto.randomUUID(),
        entity: 'dayPlan',
        entityId: dayId,
        tripId,
        dayId,
        dayIndex,
        field: '__existence__',
        kind: 'existence',
        local: versionOf(l, '我'),
        remote: versionOf(rDayTomb, metaOf(rDayTomb).updated_by),
      });
      alive.push(l);
      counter.removed += 1;
      continue;
    }
    if (lState === 'untouched' && rState === 'untouched') {
      alive.push(b);
      continue;
    }
    if (l && r) {
      alive.push(mergeOneDay({ tripId, dayIndex, dayId, base: b, local: l, remote: r, conflicts, counter, itemTombstones, pushItemTomb }));
    } else if (l) {
      alive.push(l);
    } else if (r) {
      alive.push(r);
    }
  }

  // 基线墓碑继续带下去（item 墓碑与 day 墓碑用 id 段数区分）。
  for (const tomb of opts.tombstones.base) {
    if (!deleted.some((item) => item.id === tomb.id) && !alive.some((day) => keyOf(day) === tomb.id)) {
      deleted.push(tomb);
    }
  }
  return { alive, deleted: [...deleted, ...emittedItemTombstones] };
}

function mergeOneDay(opts: {
  tripId: string;
  dayIndex: number;
  dayId: string;
  base?: DayPlan;
  local: DayPlan;
  remote: DayPlan;
  conflicts: MergeConflict[];
  counter: MergeCounter;
  itemTombstones: { local: ItemTombTuple[]; remote: ItemTombTuple[]; base: ItemTombTuple[] };
  pushItemTomb: (tripId: string, dayIndex: number, spotId: string, source: SyncMeta) => void;
}): DayPlan {
  const { tripId, dayIndex, dayId, base, local: l, remote: r, conflicts, counter, itemTombstones, pushItemTomb } = opts;
  const newer = (l.updated_at || '') > (r.updated_at || '') ? l : r;
  const merged: DayPlan = {
    id: dayId,
    trip_id: tripId,
    day_index: dayIndex,
    date: l.date,
    items: [],
    updated_by: metaOf(newer).updated_by,
    updated_at: metaOf(newer).updated_at,
  };

  pushFieldConflicts(conflicts, {
    entity: 'dayPlan',
    entityId: dayId,
    tripId,
    dayId,
    dayIndex,
    base,
    local: l,
    remote: r,
    scalarFields: DAY_SCALAR_FIELDS,
    unionFields: [],
    applyTo: merged as unknown as AnyObject,
  });

  const baseItems = base?.items || [];
  const itemIndex = (list: DayPlanItem[]) => new Map(list.map((item) => [item.spot_id, item]));
  const li = itemIndex(l.items);
  const ri = itemIndex(r.items);
  const bi = itemIndex(baseItems);
  const spotIds = new Set([...li.keys(), ...ri.keys(), ...bi.keys()]);
  const keptLocal: DayPlanItem[] = [];
  const keptRemote: DayPlanItem[] = [];
  const keptBase: DayPlanItem[] = [];

  for (const spotId of spotIds) {
    const itemL = li.get(spotId);
    const itemR = ri.get(spotId);
    const itemB = bi.get(spotId);
    const tombL = itemTombOf(itemTombstones.local.map((t) => t.tomb), tripId, dayIndex, spotId);
    const tombR = itemTombOf(itemTombstones.remote.map((t) => t.tomb), tripId, dayIndex, spotId);
    const wasAlive = !!itemB;

    if (!wasAlive) {
      if (itemL && itemR) {
        if (sameContent(itemL, itemR)) {
          keptLocal.push(itemL);
          keptRemote.push(itemR);
          keptBase.push(itemL);
          counter.added += 1;
        } else {
          const newItem: DayPlanItem = { ...itemL };
          pushFieldConflicts(conflicts, {
            entity: 'dayItem',
            entityId: dayId,
            tripId,
            dayId,
            dayIndex,
            spotId,
            base: undefined,
            local: itemL,
            remote: itemR,
            scalarFields: ITEM_SCALAR_FIELDS,
            unionFields: [],
            applyTo: newItem as unknown as AnyObject,
          });
          keptLocal.push(newItem);
          keptRemote.push(itemR);
          counter.added += 1;
        }
      } else if (itemL) {
        keptLocal.push(itemL);
        counter.added += 1;
      } else if (itemR) {
        keptRemote.push(itemR);
        counter.added += 1;
      }
      continue;
    }

    const lState = itemL ? 'alive' : tombL ? 'deleted' : 'untouched';
    const rState = itemR ? 'alive' : tombR ? 'deleted' : 'untouched';

    // 删除 vs 纯移动（内容没变）：删除生效；删除 vs 编辑内容：两版并存待确认。
    if (lState === 'deleted' || rState === 'deleted') {
      const other = lState === 'deleted' ? itemR : itemL;
      const otherTomb = lState === 'deleted' ? tombL : tombR;
      const otherEdited = other ? !sameContent(other, itemB) : false;
      const bothDeleted = lState === 'deleted' && rState === 'deleted';
      if (bothDeleted || !other || !otherEdited) {
        const source = otherTomb || (lState === 'deleted' ? tombL : tombR);
        pushItemTomb(tripId, dayIndex, spotId, metaOf(source));
        counter.removed += 1;
        continue;
      }
      conflicts.push({
        id: crypto.randomUUID(),
        entity: 'dayItem',
        entityId: dayId,
        tripId,
        dayId,
        dayIndex,
        spotId,
        field: '__existence__',
        kind: 'existence',
        local: lState === 'deleted' ? versionOf(tombL, metaOf(tombL).updated_by) : versionOf(itemL, '我'),
        remote: rState === 'deleted' ? versionOf(tombR, metaOf(tombR).updated_by) : versionOf(itemR, '同伴'),
      });
      if (itemL) keptLocal.push(itemL);
      if (itemR) keptRemote.push(itemR);
      counter.removed += 1;
      continue;
    }

    if (lState === 'untouched' && rState === 'untouched') {
      if (itemB) {
        keptLocal.push(itemB);
        keptRemote.push(itemB);
        keptBase.push(itemB);
      }
      continue;
    }
    if (itemL && itemR) {
      if (sameContent(itemL, itemR)) {
        keptLocal.push(itemL);
        keptRemote.push(itemR);
        keptBase.push(itemB || itemL);
      } else if (sameContent(itemL, itemB)) {
        keptLocal.push(itemR);
        keptRemote.push(itemR);
        keptBase.push(itemB || itemR);
        counter.updated += 1;
      } else if (sameContent(itemR, itemB)) {
        keptLocal.push(itemL);
        keptRemote.push(itemL);
        keptBase.push(itemB || itemL);
        counter.updated += 1;
      } else {
        const newItem: DayPlanItem = { ...itemL };
        pushFieldConflicts(conflicts, {
          entity: 'dayItem',
          entityId: dayId,
          tripId,
          dayId,
          dayIndex,
          spotId,
          base: itemB,
          local: itemL,
          remote: itemR,
          scalarFields: ITEM_SCALAR_FIELDS,
          unionFields: [],
          applyTo: newItem as unknown as AnyObject,
        });
        keptLocal.push(newItem);
        keptRemote.push(itemR);
        keptBase.push(itemB);
        counter.updated += 1;
      }
    } else if (itemL) {
      // 只在一侧存活（同伴没动它）：两侧序列都带上，顺序合并不会丢条目。
      keptLocal.push(itemL);
      keptRemote.push(itemL);
      if (itemB) keptBase.push(itemB);
    } else if (itemR) {
      keptLocal.push(itemR);
      keptRemote.push(itemR);
      if (itemB) keptBase.push(itemB);
    }
  }

  merged.items = mergeDayOrder({ local: keptLocal, remote: keptRemote, base: keptBase });
  return merged;
}

