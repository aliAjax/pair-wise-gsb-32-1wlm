export enum SpotCategory {
  NATURE = 'nature',
  CULTURE = 'culture',
  FOOD = 'food',
  ENTERTAINMENT = 'entertainment',
}
export const SPOT_CATEGORY_OPTIONS = [
  { label: '自然风光', value: SpotCategory.NATURE },
  { label: '人文历史', value: SpotCategory.CULTURE },
  { label: '美食购物', value: SpotCategory.FOOD },
  { label: '娱乐休闲', value: SpotCategory.ENTERTAINMENT },
];
export const SPOT_CATEGORY_MAP_STYLE: Record<SpotCategory, string> = {
  [SpotCategory.NATURE]: 'green',
  [SpotCategory.CULTURE]: 'gold',
  [SpotCategory.FOOD]: 'red',
  [SpotCategory.ENTERTAINMENT]: 'purple',
};

