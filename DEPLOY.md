# UBAmoto launch setup

## Frontend `.env`
```
VITE_SUPABASE_URL=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
VITE_MAPBOX_TOKEN=pk....   # public token, restrict it to your domain in the Mapbox dashboard
```

## Edge Function secrets
```
supabase secrets set MAPBOX_TOKEN=pk....        # used by search-places and estimate-route
supabase secrets set QUOTE_SECRET=$(openssl rand -hex 32)
supabase secrets set ALLOWED_ORIGIN=https://your-domain.rw
```

## Deploy
```
supabase functions deploy search-places
supabase functions deploy estimate-route
supabase functions deploy create-ride-booking
```

## Before you go live
- Fill in `SUPPORT.phone` / `SUPPORT.email` in `src/config.js`.
- `ride_bookings` needs a `created_at timestamptz default now()` column and an `id`.
  Existing rows keep their old phone format; new ones are saved as `+2507XXXXXXXX`.
- Keep RLS on `ride_bookings` with no public insert policy: only the Edge Function
  (service role) writes to it.
- Fare numbers live in `src/fare.js` and `supabase/functions/_shared/common.ts`.
  Change both together. The server's number is the one that counts.
- Check Mapbox's terms for storing geocoding results (you store the destination name).

## If every function call returns 401 "Invalid JWT"
Your app uses a publishable key (`sb_publishable_...`), which is not a JWT. Edge Functions
check JWTs by default, so either deploy with `--no-verify-jwt`:
```
supabase functions deploy search-places --no-verify-jwt
supabase functions deploy estimate-route --no-verify-jwt
supabase functions deploy create-ride-booking --no-verify-jwt
```
or put this in `supabase/config.toml`:
```
[functions.search-places]
verify_jwt = false
[functions.estimate-route]
verify_jwt = false
[functions.create-ride-booking]
verify_jwt = false
```
These functions are public by design and validate everything themselves (signed quotes,
phone limits), so this is safe.

## Installing the app on phones (PWA)
- Files: `index.html`, `public/manifest.webmanifest`, `public/sw.js`, `public/icons/*`.
  Keep `public/ubamoto-pin.svg` (your logo) where it is.
- The install button and service worker only work on **https** (or localhost).
  `npm run build`, then deploy the `dist` folder to Netlify, Vercel, Cloudflare Pages or similar.
- Test with `npm run build && npm run preview`, then open the preview address.
- Android / Chrome / Edge: an "Install app" banner and a button in Profile and Help appear.
- iPhone: Safari > Share > "Add to Home Screen" (the Profile and Help screens show these steps).
- The icons in `public/icons` are simple placeholders. Replace them with your logo as PNG:
  `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` (keep the logo in the centre 60%)
  and `apple-touch-icon.png` (180x180), same file names.
- When you change the app and want phones to refresh the saved files, change `CACHE = 'ubamoto-v1'`
  in `public/sw.js` to `ubamoto-v2`, and so on.

## Terms and Privacy
- Edit the wording in `src/legalContent.js`; company name, address, date and support details are in `src/config.js`.
- Fill every `[bracketed]` placeholder (legal name, launch date, retention period, support email).
- Have a Rwandan lawyer review both pages before launch.
- Changing `TERMS_VERSION` in `src/config.js` makes everyone accept again.
- `create-ride-booking` now refuses requests without `accepted_terms: true`. Redeploy it.


## Rider portal, cancelling and calling the rider (new)

### 1. Database (once)
Supabase > SQL Editor > paste `supabase/migrations/20261101000000_ride_platform.sql` > Run.
It adds ride statuses, the `riders` and `staff` tables, and locks all three tables so the
browser can never read them directly. Only the Edge Functions can.

### 2. Make yourself an admin
1. Supabase > Authentication > Users > Add user (your email + a strong password).
2. SQL Editor: `insert into public.staff (id, role) values ('YOUR-USER-ID', 'admin');`

### 3. Deploy all five functions
```
npx supabase functions deploy create-ride-booking --no-verify-jwt
npx supabase functions deploy track-ride --no-verify-jwt
npx supabase functions deploy cancel-ride-booking --no-verify-jwt
npx supabase functions deploy rider-api --no-verify-jwt
npx supabase functions deploy admin-api --no-verify-jwt
```
(`rider-api` and `admin-api` check the signed-in user themselves, so `--no-verify-jwt` is fine.)
The other two (`search-places`, `estimate-route`) are unchanged.

### 4. Using it
- Admin: open `https://your-site/#/admin`, sign in, then Riders > "Add a rider", then press **Verify**.
- Rider: opens `https://your-site/#/rider` on their phone, signs in with the email and temporary
  password you gave. They see new requests (pickup area only), accept one, and then see the
  customer's name and phone to call. Add the page to the home screen like any other app.
- Customer: My Rides shows the status. Once a rider accepts, **Call rider** and the rider's
  name and plate appear. **Cancel request** works until the ride has started.
- Support: Admin > Find a ride, then type the customer's reference or phone number.

### How customers stay safe without accounts
- Each booking returns a long secret code that is saved only on the customer's phone (only its
  hash is stored in the database) plus a short reference such as UB-ABCD-EFGH.
- To see or cancel a ride you need the secret code, or the reference together with the phone
  number used for the booking. A phone number alone shows nothing.
- Riders cannot see any request until an admin verifies them. A rider sees the customer's name and
  phone only after accepting. The customer sees the rider's details only after a real assignment.
- Per phone number: at most 3 requests in 10 minutes and 2 open rides at once.
- Not included yet: SMS one-time codes (needs an SMS provider such as Africa's Talking or Twilio).
  Add them before opening to a large public audience.