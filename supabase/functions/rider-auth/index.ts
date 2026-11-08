import {
  corsHeaders,
  fail,
  hashRiderPin,
  json,
  normalizePhone,
  riderSyntheticEmail,
} from '../_shared/common.ts';
import { db } from '../_shared/db.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return fail('Method not allowed.', 405);

  try {
    const body = await req.json();
    const phone = normalizePhone(String(body.phone ?? ''));
    const pin = String(body.pin ?? '').trim();
    if (!phone || !/^\d{4,6}$/.test(pin)) {
      return fail('Enter your phone number and a valid PIN.');
    }

    const { data: rider, error } = await db
      .from('riders')
      .select('id,pin_salt,pin_hash,status')
      .eq('phone', phone)
      .maybeSingle();
    if (error || !rider?.pin_salt || !rider.pin_hash) {
      return fail('Wrong phone number or PIN.', 401);
    }

    const expected = await hashRiderPin(phone, pin, rider.pin_salt);
    if (expected !== rider.pin_hash) {
      return fail('Wrong phone number or PIN.', 401);
    }

    const link = await db.auth.admin.generateLink({
      type: 'magiclink',
      email: riderSyntheticEmail(phone),
    });
    if (link.error || !link.data.properties?.hashed_token) {
      return fail('Could not sign in. Please try again.', 500);
    }

    return json({ success: true, token_hash: link.data.properties.hashed_token });
  } catch (error) {
    console.error('rider-auth failed:', error);
    return fail('Invalid request.', 400);
  }
});
