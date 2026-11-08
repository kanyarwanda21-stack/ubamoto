import { fail, json, rejectDisallowedOrigin, preflightHeaders } from '../_shared/common.ts';
import { authorizeBooking, db, checkRateLimit } from '../_shared/db.ts';

const CANCEL_HELP = 'This ride can no longer be cancelled here. Please contact support.';

Deno.serve(async (req) => {
  const rejectedOrigin = rejectDisallowedOrigin(req);
  if (rejectedOrigin) return rejectedOrigin;
  if (req.method === 'OPTIONS') return new Response('ok', { headers: preflightHeaders(req) });
  if (req.method !== 'POST') return fail('Method not allowed.', 405);

  try {
    const payload = await req.json();
    if (!await checkRateLimit(req, 'cancel-ride', 10, 600, String(payload.reference ?? payload.phone ?? ''))) {
      return fail('Too many cancellation attempts. Please try again later.', 429);
    }
    const booking = await authorizeBooking(payload);
    if (!booking) return fail('We could not find that ride.', 404);

    if (booking.status === 'cancelled') return fail('This ride is already cancelled.', 409);
    if (!['requested', 'assigned'].includes(booking.status)) return fail(CANCEL_HELP, 409);

    const { data, error } = await db.rpc('cancel_ride_booking', {
      p_booking_id: booking.id,
      p_cancelled_by: 'customer',
      p_reason: typeof payload.reason === 'string'
        ? String(payload.reason).slice(0, 500)
        : null,
    });

    if (error || data !== true) return fail(CANCEL_HELP, 409);
    return json({ success: true, status: 'cancelled' });
  } catch {
    return fail('Invalid request.');
  }
});