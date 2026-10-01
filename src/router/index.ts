import { createRouter, createWebHistory } from 'vue-router';
import Trips from '../pages/Trips.vue';
import TripDetail from '../pages/TripDetail.vue';
import Spots from '../pages/Spots.vue';
import Planner from '../pages/Planner.vue';
import Share from '../pages/Share.vue';
import { installGuards } from './guards';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/trips' },
    { path: '/trips', component: Trips },
    { path: '/trip/:id', component: TripDetail },
    { path: '/spots', component: Spots },
    { path: '/planner/:tripId/:dayIndex', component: Planner },
    { path: '/share', component: Share },
  ],
});
installGuards(router);
export default router;

