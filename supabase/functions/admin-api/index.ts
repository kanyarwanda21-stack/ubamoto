
import {
  corsHeaders,
  fail,
  json,
  normalizePhone,
  normalizeReference,
} from '../_shared/common.ts';

import {
  callerId,
  db,
  getStaff,
} from '../_shared/db.ts';

const BOOKING_COLUMNS =
  'id, reference, status, customer_name, customer_phone, destination_name, distance_km, ' +
  'fare_rwf, created_at, assigned_at, completed_at, cancelled_at, cancelled_by, rider_id, ' +
  'rider:riders(name, phone, plate_number)';

const STATUSES = [
  'requested',
  'assigned',
  'in_progress',
  'completed',
  'cancelled',
];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Authenticate the account.
    const userId = await callerId(req);

    if (!userId) {
      return fail('Please sign in.', 401);
    }

    // Preserve staff verification and require the admin role.
    const staff = await getStaff(userId);

    if (!staff) {
      return fail('This account is not a staff account.', 403);
    }

    if (staff.role !== 'admin') {
      return fail('You do not have administrator permissions.', 403);
    }

    const body = await req.json();
    const action = String(body.action ?? '');

    // 1. Check administrator account.
    if (action === 'me') {
      return json({
        success: true,
        role: staff.role,
      });
    }

    // 2. List bookings, with optional status filtering.
    if (action === 'list_bookings') {
      let query = db
        .from('ride_bookings')
        .select(BOOKING_COLUMNS)
        .order('created_at', { ascending: false })
        .limit(100);

      if (STATUSES.includes(body.status)) {
        query = query.eq('status', body.status);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Admin booking list failed:', error);
        return fail('Could not load rides.', 500);
      }

      return json({
        success: true,
        bookings: data ?? [],
      });
    }

    // 3. Search by booking reference or customer phone.
    if (action === 'find') {
      const text = String(body.query ?? '').trim();
      const reference = normalizeReference(text);
      const phone = normalizePhone(text);

      if (!reference && !phone) {
        return fail('Enter a booking reference or a phone number.');
      }

      const { data, error } = await db
        .from('ride_bookings')
        .select(BOOKING_COLUMNS)
        .eq(
          reference ? 'reference' : 'customer_phone',
          reference ?? phone
        )
        .order('created_at', { ascending: false })
        .limit(10);

      if (error) {
        console.error('Admin booking search failed:', error);
        return fail('Search failed.', 500);
      }

      return json({
        success: true,
        bookings: data ?? [],
      });
    }

    // 4. List registered riders.
    if (action === 'list_riders') {
      const { data, error } = await db
        .from('riders')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Admin rider list failed:', error);
        return fail('Could not load riders.', 500);
      }

      return json({
        success: true,
        riders: data ?? [],
      });
    }

    // 5. Create a rider account.
    if (action === 'create_rider') {
      const email = String(body.email ?? '').trim().toLowerCase();
      const name = String(body.name ?? '').trim();
      const phone = normalizePhone(String(body.phone ?? ''));
      const plate = String(body.plate_number ?? '')
        .trim()
        .toUpperCase()
        .slice(0, 20);

      if (!/^\S+@\S+\.\S+$/.test(email)) {
        return fail('Enter a valid email.');
      }

      if (!name || name.length > 100) {
        return fail('Enter the rider\'s name.');
      }

      if (!phone) {
        return fail('Enter a valid Rwandan phone number.');
      }

      const created = await db.auth.admin.inviteUserByEmail(email, {
        data: { name },
        ...(String(body.redirect_to ?? '').trim()
          ? { redirectTo: String(body.redirect_to).trim() }
          : {}),
      });

      if (created.error || !created.data.user) {
        console.error('Rider account creation failed:', created.error);
        return fail(
          created.error?.message ?? 'Could not create the account.',
          400
        );
      }

      // Preserve the original pending-verification process.
      const { error } = await db.from('riders').insert({
        id: created.data.user.id,
        name,
        phone,
        plate_number: plate || null,
        status: 'pending',
      });

      if (error) {
        console.error('Rider database insert failed:', error);

        const rollback = await db.auth.admin.deleteUser(
          created.data.user.id
        );

        if (rollback.error) {
          console.error('Rider account rollback failed:', rollback.error);
        }

        return fail('Could not save the rider.', 500);
      }

      return json({ success: true });
    }

    // 6. Change rider verification status.
    if (action === 'set_rider_status') {
      if (!['pending', 'verified', 'suspended'].includes(body.status)) {
        return fail('Invalid status.');
      }

      const { data, error } = await db
        .from('riders')
        .update({ status: body.status })
        .eq('id', String(body.rider_id ?? ''))
        .select('id')
        .maybeSingle();

      if (error) {
        console.error('Rider status update failed:', error);
        return fail('Could not update rider status.', 500);
      }

      return data
        ? json({ success: true })
        : fail('Rider not found.', 404);
    }

    // 7. Assign a booking to a verified rider.
    if (action === 'assign') {
      const riderId = String(body.rider_id ?? '');
      const bookingId = String(body.booking_id ?? '');

      if (!riderId || !bookingId) {
        return fail('Missing rider or booking information.');
      }

      const { data, error } = await db.rpc('assign_booking_with_capacity', {
        p_booking_id: bookingId,
        p_rider_id: riderId,
      });

      if (error) {
        console.error('Booking assignment failed:', error);
        return fail(error.message.includes('two active jobs')
          ? 'This rider already has two active jobs.'
          : error.message.includes('verified')
            ? 'Only verified riders can be assigned.'
            : 'Could not assign this ride.', 409);
      }

      return data
        ? json({ success: true })
        : fail('This ride can no longer be assigned.', 409);
    }

    // 8. List rider applications.
    if (action === 'list_applications') {
      const status = String(body.status ?? '');
      let query = db
        .from('rider_applications')
        .select('id,name,phone,plate_number,licence_number,status,created_at,reviewed_at')
        .order('created_at', { ascending: false })
        .limit(100);
      if (['new', 'approved', 'rejected'].includes(status)) {
        query = query.eq('status', status);
      }
      const { data, error } = await query;
      if (error) return fail('Could not load rider applications.', 500);
      return json({ success: true, applications: data ?? [] });
    }

    // 9. Review an application without exposing applicant consent or IP data.
    if (action === 'review_application') {
      if (!['approved', 'rejected'].includes(body.status)) {
        return fail('Invalid application status.');
      }
      const { data, error } = await db
        .from('rider_applications')
        .update({
          status: body.status,
          reviewed_at: new Date().toISOString(),
          reviewed_by: userId,
        })
        .eq('id', String(body.application_id ?? ''))
        .select('id')
        .maybeSingle();
      if (error) return fail('Could not update the application.', 500);
      return data ? json({ success: true }) : fail('Application not found.', 404);
    }

    // 10. Cancel a booking through administrator control.
    if (action === 'cancel') {
      const bookingId = String(body.booking_id ?? '');

      if (!bookingId) {
        return fail('Missing booking information.');
      }

      const { data, error } = await db
        .from('ride_bookings')
        .update({
          status: 'cancelled',
          cancelled_at: new Date().toISOString(),
          cancelled_by: 'staff',
        })
        .eq('id', bookingId)
        .in('status', ['requested', 'assigned', 'in_progress'])
        .select('id')
        .maybeSingle();

      if (error) {
        console.error('Booking cancellation failed:', error);
        return fail('Could not cancel this ride.', 500);
      }

      return data
        ? json({ success: true })
        : fail('This ride cannot be cancelled.', 409);
    }

    return fail('Unknown action.');

  } catch (error) {
    console.error(
      'admin-api failed:',
      error instanceof Error ? error.stack : error
    );

    return fail('Invalid request.');
  }
});
