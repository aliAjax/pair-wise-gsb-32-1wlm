import { defineStore } from 'pinia';
import { MAP_THEMES, type MapThemeName } from '../constants/themes';
import { STORAGE_KEYS } from '../constants/storageVersion';
import { loadLocal, saveLocal } from '../utils/storage';

export const useThemeStore = defineStore('theme', {
  state: () => ({ theme: loadLocal<MapThemeName>(STORAGE_KEYS.theme, 'fresh') }),
  getters: { current: (state) => MAP_THEMES[state.theme] },
  actions: {
    setTheme(theme: MapThemeName) {
      this.theme = theme;
      saveLocal(STORAGE_KEYS.theme, theme);
    },
  },
});

