export const RIDE_STATUSES = Object.freeze([
  'requested',
  'assigned',
  'arrived',
  'in_progress',
  'completed',
  'cancelled',
  'expired',
]);

export const RIDE_STATUS_TRANSITIONS = Object.freeze({
  requested: Object.freeze(['assigned', 'cancelled', 'expired']),
  assigned: Object.freeze(['arrived', 'requested', 'cancelled', 'expired']),
  arrived: Object.freeze(['in_progress', 'cancelled', 'expired']),
  in_progress: Object.freeze(['completed', 'cancelled']),
  completed: Object.freeze([]),
  cancelled: Object.freeze([]),
  expired: Object.freeze([]),
});

export const ACTIVE_RIDE_STATUSES = Object.freeze([
  'requested',
  'assigned',
  'arrived',
  'in_progress',
]);

export const ASSIGNABLE_RIDE_STATUSES = Object.freeze([
  'requested',
  'assigned',
]);

export function isRideStatus(value) {
  return RIDE_STATUSES.includes(value);
}

export function canTransitionRideStatus(from, to) {
  return RIDE_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}
