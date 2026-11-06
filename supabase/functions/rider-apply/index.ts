import {
  corsHeaders,
  fail,
  json,
  normalizePhone,
  sha256Hex,
} from '../_shared/common.ts';
import { db } from '../_shared/db.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return fail('Method not allowed.', 405);

  try {
    const body = await req.json();
    const name = String(body.name ?? '').trim().slice(0, 100);
    const phone = normalizePhone(String(body.phone ?? ''));
    const plate = String(body.plate_number ?? '').trim().toUpperCase().slice(0, 20);
    const licence = String(body.licence_number ?? '').trim().toUpperCase().slice(0, 50);

    if (!name) return fail('Please enter your name.');
    if (!phone) return fail('Please enter a valid Rwandan phone number.');
    if (!plate) return fail('Please enter the motorcycle plate number.');
    if (!licence) return fail('Please enter the licence number.');
    if (body.consent !== true) return fail('Consent is required to submit your application.');

    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      req.headers.get('x-real-ip')?.trim() ??
      'unknown';
    const ipHash = await sha256Hex(ip);
    const sinceIp = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const sincePhone = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [byIp, byPhone] = await Promise.all([
      db.from('rider_applications')
        .select('id', { count: 'exact', head: true })
        .eq('ip_hash', ipHash)
        .gte('created_at', sinceIp),
      db.from('rider_applications')
        .select('id', { count: 'exact', head: true })
        .eq('phone', phone)
        .gte('created_at', sincePhone),
    ]);

    if ((byIp.count ?? 0) >= 5 || (byPhone.count ?? 0) >= 3) {
      return fail('Too many applications have been submitted. Please try again later.', 429);
    }

    const { error } = await db.from('rider_applications').insert({
      name,
      phone,
      plate_number: plate,
      licence_number: licence,
      consent: true,
      ip_hash: ipHash,
      status: 'new',
    });

    if (error) {
      console.error('Rider application insert failed:', error);
      return fail('Could not submit the application. Please try again.', 500);
    }

    return json({ success: true });
  } catch (error) {
    console.error('rider-apply failed:', error);
    return fail('Invalid request.', 400);
  }
});
