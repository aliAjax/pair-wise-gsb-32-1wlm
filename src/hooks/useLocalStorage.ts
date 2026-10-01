import { ref, watch } from 'vue';
import { loadLocal, saveLocal } from '../utils/storage';

export function useLocalStorage<T>(key: string, fallback: T) {
  const state = ref(loadLocal<T>(key, fallback));
  watch(state, (value) => saveLocal(key, value), { deep: true });
  return state;
}

