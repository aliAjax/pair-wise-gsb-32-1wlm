import { defineStore } from 'pinia';
import type { Spot } from '../models/spot';
import { SpotCategory } from '../constants/spot';
import { spotApi } from '../api/spotApi';

export const useSpotStore = defineStore('spot', {
  state: () => ({ spots: spotApi.list() as Spot[], keyword: '', category: 'all' as SpotCategory | 'all', favorites: [] as string[] }),
  getters: {
    filteredSpots: (state) => state.spots.filter((spot) => {
      const matchKeyword = !state.keyword || spot.name.includes(state.keyword) || spot.tags.some((tag) => tag.includes(state.keyword));
      const matchCategory = state.category === 'all' || spot.category === state.category;
      return matchKeyword && matchCategory;
    }),
  },
  actions: {
    toggleFavorite(id: string) {
      this.favorites = this.favorites.includes(id) ? this.favorites.filter((item) => item !== id) : [...this.favorites, id];
    },
  },
});

