import dayjs from 'dayjs';
import { SpotCategory } from '../constants/spot';
import { TripStatus } from '../constants/trip';

export const spotCategoryText: Record<SpotCategory, string> = {
  [SpotCategory.NATURE]: '自然风光',
  [SpotCategory.CULTURE]: '人文历史',
  [SpotCategory.FOOD]: '美食购物',
  [SpotCategory.ENTERTAINMENT]: '娱乐休闲',
};
export const tripStatusText: Record<TripStatus, string> = {
  [TripStatus.PLANNING]: '规划中',
  [TripStatus.ONGOING]: '进行中',
  [TripStatus.FINISHED]: '已结束',
};
export const transportText: Record<string, string> = { walk: '步行', metro: '地铁', taxi: '出租', train: '火车' };
export const formatDate = (value: string) => dayjs(value).format('YYYY-MM-DD');
export const formatDateTime = (value: string) => dayjs(value).format('YYYY-MM-DD HH:mm');
export const formatCurrency = (value: number, currency = 'CNY') => new Intl.NumberFormat('zh-CN', { style: 'currency', currency }).format(value);

/** 冲突确认面板中展示的字段中文名（Trip / DayPlan / DayPlanItem / Spot 共用）。 */
export const mergeFieldText: Record<string, string> = {
  __existence__: '是否保留',
  title: '旅行标题',
  destination: '目的地',
  start_date: '开始日期',
  end_date: '结束日期',
  budget: '预算',
  currency: '币种',
  members: '同行人',
  status: '状态',
  date: '日期',
  start_time: '开始时间',
  end_time: '结束时间',
  note: '备注',
  transport: '交通方式',
  name: '名称',
  category: '分类',
  address: '地址',
  rating: '评分',
  price: '价格',
  open_time: '开放时间',
  tags: '标签',
};

