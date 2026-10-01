export const MAP_THEMES = {
  fresh: { label: '清爽地图', amapStyle: 'amap://styles/fresh', marker: '#2d7a46' },
  dusk: { label: '傍晚地图', amapStyle: 'amap://styles/whitesmoke', marker: '#c05621' },
};
export type MapThemeName = keyof typeof MAP_THEMES;

