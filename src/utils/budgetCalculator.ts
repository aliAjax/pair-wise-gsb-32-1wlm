import type { DayPlan } from '../models/dayPlan';
import type { Spot } from '../models/spot';
import type { Trip } from '../models/trip';
import { messages } from '../constants/messages';
import { confirmedDayPlans, type PendingIndex } from './merge/pending';

export function calcTripCost(dayPlans: DayPlan[], spots: Spot[]) {
  const spotMap = new Map(spots.map((spot) => [spot.id, spot]));
  return dayPlans.reduce((sum, day) => {
    return sum + day.items.reduce((inner, item) => inner + (spotMap.get(item.spot_id)?.price || 0), 0);
  }, 0);
}

export function budgetStatus(trip: Trip, dayPlans: DayPlan[], spots: Spot[]) {
  const spent = calcTripCost(dayPlans, spots);
  return { spent, remaining: trip.budget - spent, warning: spent > trip.budget ? messages.budgetExceeded : '' };
}

/**
 * 合并待确认感知版本：未确认的冲突景点（字段/移除/移动）不进入预算。
 * 预算规则与 budgetStatus 保持一致，调用方负责传入 confirmed 过滤后的行程。
 */
export function budgetStatusPendingAware(
  trip: Trip,
  dayPlans: DayPlan[],
  spots: Spot[],
  pending: PendingIndex,
) {
  const clean = confirmedDayPlans(dayPlans, pending, trip.id);
  return budgetStatus(trip, clean, spots);
}
