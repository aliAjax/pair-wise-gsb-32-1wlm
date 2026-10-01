import { computed } from 'vue';
import type { Trip } from '../models/trip';
import type { DayPlan } from '../models/dayPlan';
import type { Spot } from '../models/spot';
import { budgetStatus, budgetStatusPendingAware } from '../utils/budgetCalculator';
import type { PendingIndex } from '../utils/merge/pending';
import { confirmedDayPlans } from '../utils/merge/pending';

export function useTripStats(
  trip: Trip,
  dayPlans: DayPlan[],
  spots: Spot[],
  pending?: PendingIndex,
) {
  return computed(() => {
    const tripDays = dayPlans.filter((day) => day.trip_id === trip.id);
    // 合并后有待确认冲突时，预算与统计只算已确认景点
    const effectiveDays = pending ? confirmedDayPlans(tripDays, pending, trip.id) : tripDays;
    return {
      days: Math.max(1, tripDays.length),
      spotCount: effectiveDays.reduce((sum, day) => sum + day.items.length, 0),
      budget: pending
        ? budgetStatusPendingAware(trip, tripDays, spots, pending)
        : budgetStatus(trip, tripDays, spots),
    };
  });
}
