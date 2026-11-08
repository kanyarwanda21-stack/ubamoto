import {
  fail,
  json,
  normalizePhone,
  sha256Hex,
  rejectDisallowedOrigin,
  preflightHeaders,
} from '../_shared/common.ts';
import { db, checkRateLimit } from '../_shared/db.ts';

Deno.serve(async (req) => {
  const rejectedOrigin = rejectDisallowedOrigin(req);
  if (rejectedOrigin) return rejectedOrigin;
  if (req.method === 'OPTIONS') return new Response('ok', { headers: preflightHeaders(req) });
  if (req.method !== 'POST') return fail('Method not allowed.', 405);

  try {
    if (!await checkRateLimit(req, 'rider-apply', 5, 3600)) {
      return fail('Too many applications have been submitted. Please try again later.', 429);
    }
    const contentType = req.headers.get('content-type') ?? '';
    if (!contentType.includes('multipart/form-data')) return fail('Invalid form submission.', 400);
    const form = await req.formData();
    const name = String(form.get('name') ?? '').trim().slice(0, 100);
    const phone = normalizePhone(String(form.get('phone') ?? ''));
    const plate = String(form.get('plate_number') ?? '').trim().toUpperCase().slice(0, 20);
    const licence = String(form.get('licence_number') ?? '').trim().toUpperCase().slice(0, 50);
    const photo = form.get('passport_photo');

    if (!name) return fail('Please enter your name.');
    if (!phone) return fail('Please enter a valid Rwandan phone number.');
    if (!plate) return fail('Please enter the motorcycle plate number.');
    if (!licence) return fail('Please enter the licence number.');
    if (form.get('consent') !== 'true') return fail('Consent is required to submit your application.');
    if (!(photo instanceof File)) return fail('A passport photo is required.');
    if (photo.size < 1 || photo.size > 5 * 1024 * 1024) {
      return fail('The passport photo must be between 1 byte and 5 MB.');
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(photo.type)) {
      return fail('The passport photo must be JPG, PNG or WebP.');
    }

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

    const photoExt = photo.type === 'image/png' ? 'png' : photo.type === 'image/webp' ? 'webp' : 'jpg';
    const photoPath = `applications/${crypto.randomUUID()}.${photoExt}`;
    const uploaded = await db.storage.from('rider-passports').upload(
      photoPath,
      await photo.arrayBuffer(),
      { contentType: photo.type, upsert: false }
    );
    if (uploaded.error) {
      console.error('Passport photo upload failed:', uploaded.error);
      return fail('Could not upload the passport photo.', 500);
    }

    const { error } = await db.from('rider_applications').insert({
      name,
      phone,
      plate_number: plate,
      licence_number: licence,
      passport_photo_path: photoPath,
      consent: true,
      ip_hash: ipHash,
      status: 'new',
    });

    if (error) {
      console.error('Rider application insert failed:', error);
      await db.storage.from('rider-passports').remove([photoPath]);
      return fail('Could not submit the application. Please try again.', 500);
    }

    return json({ success: true });
  } catch (error) {
    console.error('rider-apply failed:', error);
    return fail('Invalid request.', 400);
  }
});
