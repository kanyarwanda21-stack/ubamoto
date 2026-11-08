export const RIDE_STATUSES = [
  'requested',
  'assigned',
  'arrived',
  'in_progress',
  'completed',
  'cancelled',
  'expired',
] as const;

export type RideStatus = typeof RIDE_STATUSES[number];

export const RIDE_STATUS_TRANSITIONS: Record<RideStatus, readonly RideStatus[]> = {
  requested: ['assigned', 'cancelled', 'expired'],
  assigned: ['arrived', 'requested', 'cancelled', 'expired'],
  arrived: ['in_progress', 'cancelled', 'expired'],
  in_progress: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
  expired: [],
};

export const ACTIVE_RIDE_STATUSES: readonly RideStatus[] = [
  'requested',
  'assigned',
  'arrived',
  'in_progress',
];

export function isRideStatus(value: unknown): value is RideStatus {
  return typeof value === 'string' && (RIDE_STATUSES as readonly string[]).includes(value);
}

export function canTransitionRideStatus(from: RideStatus, to: RideStatus) {
  return RIDE_STATUS_TRANSITIONS[from].includes(to);
}
