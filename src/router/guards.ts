import type { Router } from 'vue-router';
import { TripStatus } from '../constants/trip';
import { SpotCategory } from '../constants/spot';

export function installGuards(router: Router) {
  router.beforeEach((to) => {
    to.meta.tripStatusEnum = TripStatus.PLANNING;
    to.meta.spotCategoryEnum = SpotCategory.NATURE;
    return true;
  });
}

