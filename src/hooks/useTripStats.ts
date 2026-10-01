import { computed } from 'vue';
import type { Trip } from '../models/trip';
import type { DayPlan } from '../models/dayPlan';
import type { Spot } from '../models/spot';
import { budgetStatus } from '../utils/budgetCalculator';

export function useTripStats(trip: Trip, dayPlans: DayPlan[], spots: Spot[]) {
  return computed(() => ({
    days: Math.max(1, dayPlans.filter((day) => day.trip_id === trip.id).length),
    spotCount: dayPlans.filter((day) => day.trip_id === trip.id).reduce((sum, day) => sum + day.items.length, 0),
    budget: budgetStatus(trip, dayPlans.filter((day) => day.trip_id === trip.id), spots),
  }));
}

