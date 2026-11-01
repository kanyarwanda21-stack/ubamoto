import { corsHeaders, fail, json } from '../_shared/common.ts';
import { authorizeBooking, db } from '../_shared/db.ts';

const CANCEL_HELP = 'This ride can no longer be cancelled here. Please contact support.';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const booking = await authorizeBooking(await req.json());
    if (!booking) return fail('We could not find that ride.', 404);

    if (booking.status === 'cancelled') return fail('This ride is already cancelled.', 409);
    if (!['requested', 'assigned'].includes(booking.status)) return fail(CANCEL_HELP, 409);

    // The status check is part of the update, so a ride that just started cannot be cancelled.
    const { data, error } = await db
      .from('ride_bookings')
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        cancelled_by: 'customer',
      })
      .eq('reference', booking.reference)
      .in('status', ['requested', 'assigned'])
      .select('status')
      .maybeSingle();

    if (error || !data) return fail(CANCEL_HELP, 409);
    return json({ success: true, status: 'cancelled' });
  } catch {
    return fail('Invalid request.');
  }
});