import {
  fail,
  hashRiderPin,
  json,
  normalizePhone,
  riderSyntheticEmail,
  rejectDisallowedOrigin,
  preflightHeaders,
  verifyRiderPin,
} from '../_shared/common.ts';
import { db, checkRateLimit } from '../_shared/db.ts';

Deno.serve(async (req) => {
  const rejectedOrigin = rejectDisallowedOrigin(req);
  if (rejectedOrigin) return rejectedOrigin;
  if (req.method === 'OPTIONS') return new Response('ok', { headers: preflightHeaders(req) });
  if (req.method !== 'POST') return fail('Method not allowed.', 405);

  try {
    const body = await req.json();
    if (!await checkRateLimit(req, 'rider-login', 10, 900)) {
      return fail('Too many login attempts. Please try again later.', 429);
    }
    await db.rpc('expire_rider_documents');
    const phone = normalizePhone(String(body.phone ?? ''));
    const pin = String(body.pin ?? '').trim();
    if (!phone || !/^\d{4,6}$/.test(pin)) {
      return fail('Enter your phone number and a valid PIN.');
    }

    const { data: rider, error } = await db
      .from('riders')
      .select('id,pin_salt,pin_hash,status,pin_attempts,pin_locked_until')
      .eq('phone', phone)
      .maybeSingle();
    if (error || !rider?.pin_salt || !rider.pin_hash) {
      return fail('Wrong phone number or PIN.', 401);
    }

    if (rider.pin_locked_until && new Date(rider.pin_locked_until).getTime() > Date.now()) {
      return fail('Too many incorrect attempts. Try again later.', 423);
    }

    const valid = await verifyRiderPin(phone, pin, rider.pin_salt, rider.pin_hash);
    if (!valid) {
      const attempts = Number(rider.pin_attempts ?? 0) + 1;
      const update: Record<string, unknown> = { pin_attempts: attempts };
      if (attempts >= 5) {
        update.pin_locked_until = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      }
      await db.from('riders').update(update).eq('id', rider.id);
      return fail('Wrong phone number or PIN.', 401);
    }

    const upgradedSalt = rider.pin_hash.startsWith('$pbkdf2$') ? null : crypto.randomUUID();
    await db.from('riders').update({
      pin_attempts: 0,
      pin_locked_until: null,
      ...(upgradedSalt ? {
        pin_salt: upgradedSalt,
        pin_hash: await hashRiderPin(phone, pin, upgradedSalt),
      } : {}),
    }).eq('id', rider.id);

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
