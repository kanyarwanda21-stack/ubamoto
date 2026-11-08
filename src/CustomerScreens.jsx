import { useState } from 'react';
import {
  Bike,
  CircleHelp,
  UserRound,
  ChevronRight,
  CarFront,
  Wallet,
  ShieldCheck,
  Settings,
  Mail,
  Headphones,
  Search,
  Pencil,
  X,
  CheckCircle2,
  Download,
  FileText,
  Trash2,
  Phone,
  MessageCircle,
  RotateCcw,
  Smartphone,
} from 'lucide-react';
import './CustomerScreens.css';
import { submitRiderApplication } from './lib/api';
import {
  BASE_FARE_RWF,
  FARE_TIERS,
  MAX_TRIP_KM,
  MIN_FARE_RWF,
  OVER_20_KM_RATE_RWF,
  formatRwf,
  getFareBreakdown,
} from './fare';
import { APP_VERSION, COMPANY, SUPPORT } from './config';
import { normalizeRwandaPhone } from './lib/geo';
import { PRIVACY, TERMS } from './legalContent';

/* ---------- Small shared pieces ---------- */

function SupportActions() {
  const { phone, whatsapp, email } = SUPPORT;

  if (!phone && !whatsapp && !email) {
    return (
      <p className="uba-support-missing">
        Support contact details are not available right now.
      </p>
    );
  }

  return (
    <div className="uba-action-row">
      {phone && (
        <a className="uba-action-link" href={`tel:${phone}`}>
          <Phone size={16} /> Call support
        </a>
      )}
      {whatsapp && (
        <a
          className="uba-action-link"
          href={`https://wa.me/${whatsapp}`}
          target="_blank"
          rel="noreferrer"
        >
          <MessageCircle size={16} /> WhatsApp
        </a>
      )}
      {email && (
        <a className="uba-action-link" href={`mailto:${email}`}>
          <Mail size={16} /> Email support
        </a>
      )}
    </div>
  );
}

function InstallCard({ install }) {
  if (install.installed) {
    return (
      <div className="uba-install-card">
        <span className="uba-round-icon">
          <Smartphone size={22} />
        </span>
        <div className="uba-install-text">
          <strong>App installed</strong>
          <small>UBAmoto is installed on this device.</small>
        </div>
      </div>
    );
  }

  let hint = 'In your browser menu, choose "Install app" or "Add to Home screen".';
  if (install.canInstall) {
    hint = 'Add UBAmoto to your home screen for faster booking.';
  } else if (install.isIOS) {
    hint = 'On iPhone: tap the Share button in Safari, then choose "Add to Home Screen".';
  }

  return (
    <div className="uba-install-card">
      <span className="uba-round-icon">
        <Download size={22} />
      </span>
      <div className="uba-install-text">
        <strong>Install the UBAmoto app</strong>
        <small>{hint}</small>
      </div>
      {install.canInstall && (
        <button
          type="button"
          className="uba-primary-button uba-install-button"
          onClick={install.install}
        >
          Install
        </button>
      )}
    </div>
  );
}

function ConfirmRow({ message, yesLabel, onYes, onNo }) {
  return (
    <div className="uba-confirm-row" role="alert">
      <p>{message}</p>
      <div className="uba-action-row">
        <button type="button" className="uba-danger-button" onClick={onYes}>
          {yesLabel}
        </button>
        <button type="button" className="uba-action-link" onClick={onNo}>
          Keep
        </button>
      </div>
    </div>
  );
}

function formatWhen(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-RW', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/* ---------- My Rides ---------- */

const STATUS_LABEL = {
  requested: 'Waiting for a rider',
  assigned: 'Rider assigned',
  in_progress: 'Ride in progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const formatRef = (ref) => (ref ? `UB-${ref.slice(0, 4)}-${ref.slice(4)}` : '');

function FindRide({ onFindRide }) {
  const [reference, setReference] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  async function handleSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setResult(await onFindRide(reference, phone));
    setBusy(false);
  }

  return (
    <form className="uba-glass-panel uba-find-ride" onSubmit={handleSubmit}>
      <h2>Find a ride from another phone</h2>
      <p className="uba-description">
        Enter the reference you received and the phone number used for the booking.
      </p>
      <label className="uba-calc-field">
        Booking reference
        <input
          value={reference}
          onChange={(event) => setReference(event.target.value)}
          placeholder="UB-ABCD-EFGH"
          autoCapitalize="characters"
          autoComplete="off"
        />
      </label>
      <label className="uba-calc-field">
        Phone number
        <input
          type="tel"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          placeholder="e.g. 078 123 4567"
          autoComplete="tel"
        />
      </label>
      {result && (
        <p className={result.ok ? 'uba-profile-notice' : 'uba-form-error'} role="status">
          {result.message}
        </p>
      )}
      <button className="uba-primary-button" type="submit" disabled={busy}>
        {busy ? 'Searching...' : 'Find my ride'}
      </button>
    </form>
  );
}

function RidesScreen({ rides, onNavigate, onRebook, onClearRides, onCancelRide, onFindRide, onRefresh }) {
  const [openId, setOpenId] = useState(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [cancelId, setCancelId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [notice, setNotice] = useState(null);

  const totalFare = rides
    .filter((ride) => ride.status !== 'cancelled')
    .reduce((sum, ride) => sum + (Number(ride.fareRwf) || 0), 0);
  const hasActive = rides.some((ride) => ['requested', 'assigned', 'in_progress'].includes(ride.status));

  async function cancel(ride) {
    setBusyId(ride.id);
    setNotice(await onCancelRide(ride));
    setBusyId(null);
    setCancelId(null);
  }

  return (
    <section className="uba-screen-content">
      <header>
        <span className="uba-rides-eyebrow">Your journeys</span>
        <h1>My Rides</h1>
        <p className="uba-description">Ride requests you have sent. Status updates by itself.</p>
      </header>

      {notice && (
        <p className={notice.ok ? 'uba-profile-notice' : 'uba-form-error'} role="status">
          {notice.message}
        </p>
      )}

      {rides.length > 0 && (
        <div className="uba-rides-summary">
          <div>
            <span>Requests</span>
            <strong>{rides.length}</strong>
          </div>
          <div>
            <span>Estimated total</span>
            <strong>{formatRwf(totalFare)}</strong>
          </div>
        </div>
      )}

      {hasActive && (
        <div className="uba-action-row uba-refresh-row">
          <button type="button" className="uba-action-link" onClick={onRefresh}>
            Refresh status
          </button>
        </div>
      )}

      <div className="uba-rides-list">
        {rides.length > 0 ? (
          rides.map((ride) => {
            const open = openId === ride.id;
            const status = ride.status;
            const label = STATUS_LABEL[status] ?? 'Request sent';
            const canCancel =
              ride.reference && (ride.token || ride.phone) && ['requested', 'assigned'].includes(status);

            return (
              <article className="uba-ride-card" key={ride.id}>
                <div className="uba-ride-card-top">
                  <div className="uba-ride-icon">
                    <Bike size={22} />
                  </div>

                  <div className="uba-ride-date">
                    <span>{formatWhen(ride.createdAt)}</span>
                    <small>
                      {Number(ride.distanceKm).toFixed(1)} km
                      {ride.reference ? ` · Ref ${formatRef(ride.reference)}` : ''}
                    </small>
                  </div>

                  <span className={`uba-ride-status uba-status-${String(status).toLowerCase()}`}>{label}</span>
                </div>

                <div className="uba-ride-route">
                  <div className="uba-ride-route-marker">
                    <span className="uba-pickup-dot" />
                    <span className="uba-route-line" />
                    <span className="uba-destination-dot" />
                  </div>

                  <div className="uba-ride-route-details">
                    <div className="uba-ride-location">
                      <small>Pickup</small>
                      <strong>{ride.from}</strong>
                    </div>

                    <div className="uba-ride-location">
                      <small>Destination</small>
                      <strong>{ride.to}</strong>
                    </div>
                  </div>
                </div>

                {ride.rider && ['assigned', 'in_progress'].includes(status) && (
                  <div className="uba-rider-box">
                    {ride.rider.passport_photo_url && (
                      <img
                        className="uba-rider-passport"
                        src={ride.rider.passport_photo_url}
                        alt={`${ride.rider.name}'s passport photo`}
                      />
                    )}
                    <div>
                      <span>Your rider</span>
                      <strong>{ride.rider.name}</strong>
                      {ride.rider.plate_number && <small>Plate {ride.rider.plate_number}</small>}
                    </div>
                    <a className="uba-action-link uba-action-primary" href={`tel:${ride.rider.phone}`}>
                      <Phone size={16} /> Call rider
                    </a>
                  </div>
                )}

                <div className="uba-ride-card-footer">
                  <div>
                    <span className="uba-ride-fare-label">Estimated fare</span>
                    <strong className="uba-ride-fare">{formatRwf(ride.fareRwf)}</strong>
                  </div>

                  <div className="uba-ride-trip-label">
                    <CheckCircle2 size={16} />
                    <span>{label}</span>
                  </div>
                </div>

                {open && (
                  <dl className="uba-ride-details">
                    <div>
                      <dt>Reference</dt>
                      <dd>{ride.reference ? formatRef(ride.reference) : String(ride.id).slice(0, 8).toUpperCase()}</dd>
                    </div>
                    {ride.durationMinutes && (
                      <div>
                        <dt>Estimated time</dt>
                        <dd>{ride.durationMinutes} min</dd>
                      </div>
                    )}
                    {ride.pickup && (
                      <div>
                        <dt>Pickup point</dt>
                        <dd>
                          {ride.pickup[0].toFixed(5)}, {ride.pickup[1].toFixed(5)}
                        </dd>
                      </div>
                    )}
                    <div>
                      <dt>Need help with this ride?</dt>
                      <dd>
                        Give support your reference. <a href="#/help">Open Help</a>
                      </dd>
                    </div>
                  </dl>
                )}

                {cancelId === ride.id && (
                  <ConfirmRow
                    message={
                      status === 'assigned'
                        ? 'A rider has already accepted this ride. Cancel it anyway?'
                        : 'Cancel this ride request?'
                    }
                    yesLabel={busyId === ride.id ? 'Cancelling...' : 'Yes, cancel request'}
                    onYes={() => cancel(ride)}
                    onNo={() => setCancelId(null)}
                  />
                )}

                <div className="uba-action-row">
                  <button
                    type="button"
                    className="uba-action-link"
                    aria-expanded={open}
                    onClick={() => setOpenId(open ? null : ride.id)}
                  >
                    {open ? 'Hide details' : 'Show details'}
                  </button>
                  {canCancel && cancelId !== ride.id && (
                    <button
                      type="button"
                      className="uba-danger-button"
                      onClick={() => {
                        setNotice(null);
                        setCancelId(ride.id);
                      }}
                    >
                      <X size={16} /> Cancel request
                    </button>
                  )}
                  {ride.destination && ['completed', 'cancelled', 'Requested'].includes(status) && (
                    <button type="button" className="uba-action-link uba-action-primary" onClick={() => onRebook(ride)}>
                      <RotateCcw size={16} /> Book again
                    </button>
                  )}
                </div>
              </article>
            );
          })
        ) : (
          <div className="uba-rides-empty">
            <Bike size={34} />
            <h3>No rides yet</h3>
            <p>Requests you send will appear here.</p>
            <button type="button" onClick={() => onNavigate('book')}>
              Book a ride
            </button>
          </div>
        )}
      </div>

      {rides.length > 0 &&
        (confirmClear ? (
          <ConfirmRow
            message="Remove all requests from this device? You will not be able to cancel or follow them here afterwards."
            yesLabel="Yes, clear history"
            onYes={() => {
              onClearRides();
              setConfirmClear(false);
            }}
            onNo={() => setConfirmClear(false)}
          />
        ) : (
          <div className="uba-action-row uba-clear-row">
            <button type="button" className="uba-action-link" onClick={() => setConfirmClear(true)}>
              <Trash2 size={16} /> Clear history
            </button>
          </div>
        ))}

      <FindRide onFindRide={onFindRide} />
    </section>
  );
}

/* ---------- Help ---------- */

function HelpScreen({ install, onNavigate }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);

  const helpTopics = [
    {
      title: 'Book a Ride',
      description: 'How to request a ride',
      icon: CarFront,
      keywords: 'booking destination pickup request',
      answer:
        'Choose your pickup and destination on the booking screen, review the estimated fare, then enter your name and phone number, accept the terms and send your request.',
    },
    {
      title: 'Change or Cancel a Ride',
      description: 'Need to change your request?',
      icon: RotateCcw,
      keywords: 'cancel change edit wrong destination',
      answer: (
        <>
          <p>
            Open My Rides and tap "Cancel request" while your ride is waiting for a
            rider or a rider has been assigned. Once the ride has started, contact
            support with your reference.
          </p>
          <SupportActions />
        </>
      ),
    },
    {
      title: 'Fares & Payments',
      description: 'How your fare is calculated',
      icon: Wallet,
      keywords: 'fare price money payment pay',
      answer:
        'Your estimated fare is shown before you confirm. Open the Fare tab to see the rates and try the fare calculator. Ask support if you are unsure how to pay for your trip.',
    },
    {
      title: 'Safety & Security',
      description: 'Rider safety and emergencies',
      icon: ShieldCheck,
      keywords: 'safety security emergency helmet',
      answer:
        'Check your trip details before riding and wear a helmet. In an emergency call 112.',
    },
    {
      title: 'Account & Profile',
      description: 'Your saved name and phone',
      icon: UserRound,
      keywords: 'account profile name phone',
      answer:
        'Your name and phone number are saved on this device and fill in your booking form automatically. Change them in Profile.',
    },
    {
      title: 'Install the App',
      description: 'Use UBAmoto like a phone app',
      icon: Smartphone,
      keywords: 'install app download home screen phone',
      answer: <InstallCard install={install} />,
    },
    {
      title: 'Technical Issues',
      description: 'App errors and connection problems',
      icon: Settings,
      keywords: 'technical error connection bug offline gps location',
      answer:
        'Refresh the page and check your internet connection. If the location button does not work, allow location for this site in your browser settings, or tap your pickup on the map. If the problem continues, contact support.',
    },
    {
      title: 'Privacy & Terms',
      description: 'How we use your information',
      icon: FileText,
      keywords: 'privacy terms policy data conditions legal',
      answer: (
        <div className="uba-action-row">
          <button type="button" className="uba-action-link" onClick={() => onNavigate('terms')}>
            Terms of Service
          </button>
          <button type="button" className="uba-action-link" onClick={() => onNavigate('privacy')}>
            Privacy Policy
          </button>
        </div>
      ),
    },
    {
      title: 'Contact Us',
      description: 'Reach our support team',
      icon: Mail,
      keywords: 'contact email support message phone whatsapp call',
      answer: <SupportActions />,
    },
  ];

  const topics = helpTopics.filter((topic) =>
    `${topic.title} ${topic.description} ${topic.keywords}`
      .toLowerCase()
      .includes(query.trim().toLowerCase())
  );

  return (
    <section className="uba-screen-content">
      <h1>Help &amp; Support</h1>
      <p className="uba-description">Find answers or contact our team.</p>

      <div className="uba-glass-panel uba-help-panel">
        <label className="uba-search-box">
          <Search size={21} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search for help (e.g. booking, fare...)"
            aria-label="Search help topics"
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} aria-label="Clear search">
              <X size={17} />
            </button>
          )}
        </label>

        <div className="uba-help-list">
          {topics.map((topic) => {
            const Icon = topic.icon;
            const open = selected === topic.title;

            return (
              <div className="uba-help-entry" key={topic.title}>
                <button
                  type="button"
                  className="uba-help-item"
                  aria-expanded={open}
                  onClick={() => setSelected(open ? null : topic.title)}
                >
                  <span className="uba-round-icon">
                    <Icon size={25} strokeWidth={2.5} />
                  </span>
                  <span className="uba-help-item-text">
                    <strong>{topic.title}</strong>
                    <small>{topic.description}</small>
                  </span>
                  <ChevronRight className={open ? 'uba-chevron-open' : ''} size={20} />
                </button>
                {open && <div className="uba-help-detail">{topic.answer}</div>}
              </div>
            );
          })}

          {!topics.length && (
            <p className="uba-no-results">No matching help topics. Try another search.</p>
          )}
        </div>

        <div className="uba-urgent-help">
          <span className="uba-round-icon">
            <Headphones size={29} />
          </span>
          <div className="uba-urgent-text">
            <strong>Need more help?</strong>
            <SupportActions />
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- Rider application ---------- */

function RiderApplicationScreen() {
  const [form, setForm] = useState({
    name: '',
    phone: '',
    plate_number: '',
    licence_number: '',
    passport_photo: null,
    consent: false,
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [submitted, setSubmitted] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      await submitRiderApplication(form);
      setSubmitted(true);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  if (submitted) {
    return (
      <section className="uba-screen-content">
        <div className="uba-glass-panel rider-application-success">
          <CheckCircle2 size={42} />
          <h1>Application received</h1>
          <p>UBAmoto will review your details and contact you by phone.</p>
        </div>
      </section>
    );
  }

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  return (
    <section className="uba-screen-content">
      <h1>Ride with UBAmoto</h1>
      <p className="uba-description">Tell us about yourself to apply as a rider.</p>
      <form className="uba-glass-panel rider-application-form" onSubmit={submit}>
        <label>Name<input required maxLength={100} value={form.name} onChange={(e) => update('name', e.target.value)} /></label>
        <label>Phone<input required type="tel" maxLength={20} value={form.phone} onChange={(e) => update('phone', e.target.value)} /></label>
        <label>Motorcycle plate<input required maxLength={20} value={form.plate_number} onChange={(e) => update('plate_number', e.target.value)} /></label>
        <label>Licence number<input required maxLength={50} value={form.licence_number} onChange={(e) => update('licence_number', e.target.value)} /></label>
        <label>Passport photo
          <input
            required
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(event) => update('passport_photo', event.target.files?.[0] ?? null)}
          />
        </label>
        <label className="rider-consent">
          <input required type="checkbox" checked={form.consent} onChange={(e) => update('consent', e.target.checked)} />
          <span>I consent to UBAmoto processing these details for rider onboarding.</span>
        </label>
        {message && <p className="rider-application-error" role="alert">{message}</p>}
        <button className="primary-button rider-submit" type="submit" disabled={busy}>
          {busy ? 'Sending...' : 'Submit application'}
        </button>
      </form>
    </section>
  );
}

/* ---------- Profile ---------- */

function ProfileScreen({ profile, install, onSave, onNavigate, onClearAll }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(profile);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);

  function toggleEdit() {
    setDraft(profile);
    setEditing((value) => !value);
    setNotice('');
    setError('');
  }

  function handleSubmit(event) {
    event.preventDefault();

    const name = draft.name.trim();
    const rawPhone = draft.phone.trim();
    const phone = rawPhone ? normalizeRwandaPhone(rawPhone) : '';

    if (rawPhone && !phone) {
      setError('Enter a valid Rwandan phone number, e.g. 078 123 4567.');
      return;
    }

    onSave({ name, phone });
    setEditing(false);
    setError('');
    setNotice('Saved on this device.');
  }

  const menu = [
    { title: 'Help & Support', description: 'Get help or contact us', icon: CircleHelp, target: 'help' },
    { title: 'Terms of Service', description: 'The rules for using UBAmoto', icon: FileText, target: 'terms' },
    { title: 'Privacy Policy', description: 'How we use your information', icon: ShieldCheck, target: 'privacy' },
  ];

  return (
    <section className="uba-screen-content">
      <h1>Profile</h1>
      <p className="uba-description">
        Your details are saved on this device and fill in your bookings.
      </p>

      <div className="uba-glass-panel uba-profile-panel">
        <div className="uba-profile-summary">
          <div className="uba-avatar">
            <UserRound size={52} fill="currentColor" strokeWidth={1.2} />
          </div>
          <div className="uba-profile-identity">
            <strong>{profile.name || 'Your name'}</strong>
            <span>{profile.phone || 'Add your phone number'}</span>
          </div>
          <button type="button" className="uba-edit-button" onClick={toggleEdit}>
            {editing ? <X size={17} /> : <Pencil size={17} />}
            {editing ? 'Cancel' : 'Edit'}
          </button>
        </div>

        {editing && (
          <form className="uba-profile-edit" onSubmit={handleSubmit}>
            <label>
              Full name
              <input
                value={draft.name}
                maxLength={100}
                autoComplete="name"
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </label>
            <label>
              Phone number
              <input
                type="tel"
                value={draft.phone}
                maxLength={20}
                autoComplete="tel"
                placeholder="e.g. 078 123 4567"
                onChange={(event) => setDraft({ ...draft, phone: event.target.value })}
              />
            </label>
            {error && <p className="uba-form-error">{error}</p>}
            <button className="uba-primary-button" type="submit">
              Save changes
            </button>
          </form>
        )}

        {notice && <p className="uba-profile-notice">{notice}</p>}

        <InstallCard install={install} />

        <div className="uba-profile-menu">
          {menu.map((item) => {
            const Icon = item.icon;

            return (
              <button
                type="button"
                className="uba-profile-item"
                key={item.title}
                onClick={() => onNavigate(item.target)}
              >
                <span className="uba-round-icon">
                  <Icon size={24} strokeWidth={2.5} />
                </span>
                <span className="uba-profile-item-text">
                  <strong>{item.title}</strong>
                  <small>{item.description}</small>
                </span>
                <ChevronRight size={20} />
              </button>
            );
          })}
        </div>

        {confirmClear ? (
          <ConfirmRow
            message="Erase your saved name, phone, ride history and terms acceptance from this device?"
            yesLabel="Yes, clear my data"
            onYes={() => {
              onClearAll();
              setConfirmClear(false);
              setNotice('Your data was cleared from this device.');
            }}
            onNo={() => setConfirmClear(false)}
          />
        ) : (
          <button
            type="button"
            className="uba-danger-button uba-clear-data"
            onClick={() => setConfirmClear(true)}
          >
            <Trash2 size={18} /> Clear data on this device
          </button>
        )}

        <p className="uba-version">
          {COMPANY.name} version {APP_VERSION}
        </p>
      </div>
    </section>
  );
}

/* ---------- Fare ---------- */

function FareCalculator() {
  const [km, setKm] = useState('5');
  const value = Number(km);
  const valid = km !== '' && Number.isFinite(value) && value > 0;
  const tooLong = valid && value > MAX_TRIP_KM;
  const result = valid && !tooLong ? getFareBreakdown(value) : null;

  return (
    <div className="uba-glass-panel uba-fare-tool">
      <h2>Fare calculator</h2>
      <p className="uba-description">
        Type a distance to see an estimate. Your real fare uses the road
        distance of your route.
      </p>

      <label className="uba-calc-field">
        Trip distance (km)
        <input
          type="number"
          inputMode="decimal"
          min="0"
          max={MAX_TRIP_KM}
          step="0.1"
          value={km}
          onChange={(event) => setKm(event.target.value)}
        />
      </label>

      {tooLong && (
        <p className="uba-form-error">Trips are limited to {MAX_TRIP_KM} km.</p>
      )}
      {!valid && km !== '' && (
        <p className="uba-form-error">Enter a distance above 0.</p>
      )}

      {result && (
        <dl className="uba-calc-result">
          <div>
            <dt>Base fare</dt>
            <dd>{formatRwf(result.base)}</dd>
          </div>
          <div>
            <dt>Distance charge</dt>
            <dd>{formatRwf(result.distanceCharge)}</dd>
          </div>
          {result.minimumApplied && (
            <div>
              <dt>Minimum fare applied</dt>
              <dd>{formatRwf(MIN_FARE_RWF)}</dd>
            </div>
          )}
          <div className="uba-calc-total">
            <dt>Estimated fare</dt>
            <dd>{formatRwf(result.total)}</dd>
          </div>
        </dl>
      )}
    </div>
  );
}

function FareScreen({ onNavigate }) {
  const examples = [1, 2, 5, 8, 12, 20, 30, 40];

  return (
    <section className="uba-screen-content">
      <h1>Fare Guide</h1>
      <p className="uba-description">Know your estimated moto fare before you ride.</p>

      <div className="uba-glass-panel uba-fare-guide">
        <div>
          <span>
            Minimum fare<small>Any trip under this rounds up</small>
          </span>
          <strong>{formatRwf(MIN_FARE_RWF)}</strong>
        </div>
        <div>
          <span>
            Base fare<small>Added once per trip</small>
          </span>
          <strong>{formatRwf(BASE_FARE_RWF)}</strong>
        </div>
        {FARE_TIERS.map((tier) => (
          <div key={tier.label}>
            <span>
              {tier.label}
              <small>{tier.note}</small>
            </span>
            <strong>RWF {tier.ratePerKm}/km</strong>
          </div>
        ))}
        <div>
          <span>
            Over 20 km<small>Trips are limited to {MAX_TRIP_KM} km</small>
          </span>
          <strong>RWF {OVER_20_KM_RATE_RWF}/km</strong>
        </div>
        <p>Your final estimated fare depends on the road distance of the trip.</p>
      </div>

      <FareCalculator />

      <div className="uba-glass-panel uba-fare-tool">
        <h2>Example trips</h2>
        <dl className="uba-calc-result">
          {examples.map((distance) => (
            <div key={distance}>
              <dt>{distance} km</dt>
              <dd>{formatRwf(getFareBreakdown(distance).total)}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="uba-action-row uba-fare-cta">
        <button
          type="button"
          className="uba-action-link uba-action-primary"
          onClick={() => onNavigate('book')}
        >
          Book a ride
        </button>
      </div>
    </section>
  );
}

/* ---------- Terms and Privacy ---------- */

function LegalScreen({ doc, otherTarget, otherLabel, onNavigate }) {
  return (
    <section className="uba-screen-content uba-legal">
      <h1>{doc.title}</h1>
      <p className="uba-description">Last updated: {COMPANY.lastUpdated}</p>

      <div className="uba-glass-panel uba-legal-panel">
        <p>{doc.intro}</p>
        {doc.sections.map((section, index) => (
          <section key={section.heading}>
            <h2>
              {index + 1}. {section.heading}
            </h2>
            {section.body.map((text) => (
              <p key={text}>{text}</p>
            ))}
          </section>
        ))}
      </div>

      <div className="uba-action-row">
        <button type="button" className="uba-action-link" onClick={() => onNavigate(otherTarget)}>
          {otherLabel}
        </button>
        <button type="button" className="uba-action-link" onClick={() => onNavigate('help')}>
          Back to Help
        </button>
      </div>
    </section>
  );
}

// The site header lives in App.jsx so every screen shares it.
export default function CustomerScreens({
  screen,
  profile,
  rides,
  install,
  onSaveProfile,
  onNavigate,
  onRebook,
  onClearRides,
  onClearAll,
  onCancelRide,
  onFindRide,
  onRefresh,
}) {
  return (
    <div className={`uba-customer-screen uba-view-${screen}`}>
      {screen === 'rides' && (
        <RidesScreen
          rides={rides}
          onNavigate={onNavigate}
          onRebook={onRebook}
          onClearRides={onClearRides}
          onCancelRide={onCancelRide}
          onFindRide={onFindRide}
          onRefresh={onRefresh}
        />
      )}
      {screen === 'help' && <HelpScreen install={install} onNavigate={onNavigate} />}
      {screen === 'fare' && <FareScreen onNavigate={onNavigate} />}
      {screen === 'ride-with-us' && <RiderApplicationScreen />}
      {screen === 'profile' && (
        <ProfileScreen
          profile={profile}
          install={install}
          onSave={onSaveProfile}
          onNavigate={onNavigate}
          onClearAll={onClearAll}
        />
      )}
      {screen === 'terms' && (
        <LegalScreen
          doc={TERMS}
          otherTarget="privacy"
          otherLabel="Read Privacy Policy"
          onNavigate={onNavigate}
        />
      )}
      {screen === 'privacy' && (
        <LegalScreen
          doc={PRIVACY}
          otherTarget="terms"
          otherLabel="Read Terms of Service"
          onNavigate={onNavigate}
        />
      )}
    </div>
  );
}