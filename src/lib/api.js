import { supabase } from './supabaseClient';

// Every Edge Function answers { success: true, ... } or { success: false, error }.
async function call(name, body) {
  const { data, error } = await supabase.functions.invoke(name, { body });

  if (error) {
    let message = '';
    try {
      // For non-2xx replies, error.context is the raw Response.
      const response = error.context;
      if (response && typeof response.json === 'function') {
        message = (await response.json())?.error || '';
      }
    } catch {
      // ignore: fall through to the generic message
    }
    throw new Error(
      message || 'Connection problem. Please check your internet and try again.'
    );
  }

  if (!data || data.success !== true) {
    throw new Error(data?.error || 'Something went wrong. Please try again.');
  }

  return data;
}

// Search runs in two steps (suggest while typing, retrieve on selection)
// that share one session token. Retrieve returns the exact coordinates.
export const searchPlaces = (query, near, session) =>
  call('search-places', {
    action: 'suggest',
    q: query,
    lat: near[0],
    lon: near[1],
    session,
  });

export const retrievePlace = (id, session) =>
  call('search-places', { action: 'retrieve', id, session });

export const estimateRoute = (pickup, destination) =>
  call('estimate-route', { pickup, destination });

export const createBooking = (payload) => call('create-ride-booking', payload);

// ---------- Ride tracking and cancelling (customers, no account) ----------
// Each ride is proven with { reference, token } (this device) or { reference, phone }.
export const trackRides = (rides) => call('track-ride', { rides });
export const cancelRideRequest = (credentials) => call('cancel-ride-booking', credentials);

// ---------- Rider and staff portals (signed-in users) ----------
export const riderApi = (action, params = {}) => call('rider-api', { action, ...params });
export const adminApi = (action, params = {}) => call('admin-api', { action, ...params });