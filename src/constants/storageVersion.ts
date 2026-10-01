export const STORAGE_VERSION = 'tripweaver-v1';
export const STORAGE_KEYS = {
  trips: STORAGE_VERSION + ':trips',
  spots: STORAGE_VERSION + ':spots',
  dayPlans: STORAGE_VERSION + ':dayPlans',
  theme: STORAGE_VERSION + ':theme',
  syncBase: STORAGE_VERSION + ':syncBase',
  syncConflicts: STORAGE_VERSION + ':syncConflicts',
  syncProfile: STORAGE_VERSION + ':syncProfile',
  /** 上一次合并成功后可读的结果，合并失败时回退使用。 */
  syncLastResult: STORAGE_VERSION + ':syncLastResult',
};
