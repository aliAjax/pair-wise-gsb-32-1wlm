export const STORAGE_VERSION = 'tripweaver-v1';
export const STORAGE_KEYS = {
  trips: STORAGE_VERSION + ':trips',
  spots: STORAGE_VERSION + ':spots',
  dayPlans: STORAGE_VERSION + ':dayPlans',
  theme: STORAGE_VERSION + ':theme',
  /** 离线结伴合并：当前作者 */
  mergeAuthor: STORAGE_VERSION + ':mergeAuthor',
  /** 离线快照：本地 / 同伴 / 共同祖先 */
  mergeSnapshot: (slot: 'local' | 'remote' | 'base') => `${STORAGE_VERSION}:mergeSnapshot:${slot}`,
  /** 上一份成功的可读合并结果（失败重试时沿用） */
  lastGoodMerge: STORAGE_VERSION + ':lastGoodMerge',
  /** 待确认冲突对应的合并结果 */
  pendingMerge: STORAGE_VERSION + ':pendingMerge',
  /** 已确认的冲突决议（刷新后重算仍生效） */
  mergeResolutions: STORAGE_VERSION + ':mergeResolutions',
};
