import { corsHeaders, fail, json } from '../_shared/common.ts';
import { authorizeBooking, publicView } from '../_shared/db.ts';

// Customers ask for the status of up to 10 rides at once. Each one is shown only
// when the caller proves it is theirs (reference + token, or reference + phone).
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { rides } = await req.json();
    if (!Array.isArray(rides) || rides.length === 0 || rides.length > 10) {
      return fail('Invalid request.');
    }

    const results = [];
    for (const cred of rides) {
      const booking = await authorizeBooking(cred);
      // Same answer for "wrong code" and "no such ride" so nobody can probe references.
      results.push(
        booking
          ? { found: true, ...publicView(booking) }
          : { found: false, reference: String(cred?.reference ?? '').slice(0, 20) }
      );
    }

    return json({ success: true, results });
  } catch {
    return fail(',');
  }
});