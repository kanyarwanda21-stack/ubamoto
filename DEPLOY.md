# UBAmoto launch setup

## Frontend `.env`
```
VITE_SUPABASE_URL=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
VITE_MAPBOX_TOKEN=pk....   # public token, restrict it to your domain in the Mapbox dashboard
```

## Edge Function secrets
```
supabase secrets set MAPBOX_TOKEN=pk....        # used by search-places
supabase secrets set QUOTE_SECRET=$(openssl rand -hex 32)
supabase secrets set ALLOWED_ORIGIN=https://your-domain.rw
```

## Database

Schema changes live in `supabase/migrations/`. The migrations create and harden
`ride_bookings`, `riders`, `rider_applications`, `staff`, and related operational
tables, with status checks, indexes, constraints, and RLS. Only authorized Edge
Functions using the service role should read or write protected tables.

### Before you apply this to a live project

1. In Supabase Studio → Table Editor (or `npx supabase db dump --schema public`),
   check whether `ride_bookings` already exists and what type `id` is.
2. The current migration set uses **uuid** ids (Auth user ids are uuid). It will **not**
   change an existing `bigint` id. If types differ, stop and reconcile first.
3. Take a backup (Studio → Database → Backups, or a dump).

### Apply

**Linked remote project (preferred):**
```
npx supabase db push
```

**Or** Studio → SQL Editor → apply each required migration in filename order → Run.

Local reset (destroys local DB only, not production):
```
npx supabase db reset
```
`supabase/seed.sql` is intentionally empty. Do not put real user ids in it.

### Make yourself an admin

1. Supabase → Authentication → Users → Add user (your email + a strong password).
2. SQL Editor (use the new user's UUID, not a placeholder):
```
insert into public.staff (id, role) values ('YOUR-USER-ID', 'admin');
```

## Deploy Edge Functions

JWT checks are set in `supabase/config.toml`. Customer functions are public
(no user account). Rider and admin functions require a signed-in user JWT.

```
npx supabase functions deploy search-places
npx supabase functions deploy create-ride-booking
npx supabase functions deploy track-ride
npx supabase functions deploy cancel-ride-booking
npx supabase functions deploy rider-api
npx supabase functions deploy admin-api
```

Do not pass `--no-verify-jwt` for `rider-api` or `admin-api`. Those two must
keep `verify_jwt = true`.

### If customer function calls return 401 "Invalid JWT"

The browser sends the publishable key, which is not a user JWT. Customer
functions must stay `verify_jwt = false` in `config.toml` (already set).
Redeploy those functions after changing the config. They still check signed
quotes, phones, and ride tokens themselves.

## Before you go live

- Fill in `SUPPORT.phone` / `SUPPORT.email` in `src/config.js`.
- Fare numbers live in `src/fare.js` and `supabase/functions/_shared/common.ts`.
  Change both together. The server's number is the one that counts.
- Check Mapbox's terms for storing geocoding results (you store the destination name).
- Confirm in Studio that RLS is on for `ride_bookings`, `riders` and `staff`,
  and that a REST request with the publishable key cannot read those tables.

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
- `create-ride-booking` refuses requests without `accepted_terms: true`. Redeploy it if you change that check.

## Using the portals

- Admin: open the deployed admin portal, sign in, then Riders > "Add a rider", then press **Verify**.
- Rider: opens the deployed rider portal on their phone and signs in with the account created
  and verified by an administrator. They see new requests (pickup area only), accept one, and then see the
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
