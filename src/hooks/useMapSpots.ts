import { computed } from 'vue';
import { AMAP_KEY, DEFAULT_MAP_THEME, MARKER_SIZE } from '../config/map';
import type { Spot } from '../models/spot';

export function useMapSpots(spots: Spot[]) {
  return computed(() => spots.map((spot) => ({
    id: spot.id,
    label: spot.name,
    position: [spot.lng, spot.lat],
    markerSize: MARKER_SIZE,
    mapKey: AMAP_KEY,
    theme: DEFAULT_MAP_THEME.amapStyle,
  })));
}

