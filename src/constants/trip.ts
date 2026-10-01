export enum TripStatus {
  PLANNING = 'planning',
  ONGOING = 'ongoing',
  FINISHED = 'finished',
}
export const TRIP_STATUS_OPTIONS = [
  { label: '规划中', value: TripStatus.PLANNING },
  { label: '进行中', value: TripStatus.ONGOING },
  { label: '已结束', value: TripStatus.FINISHED },
];

