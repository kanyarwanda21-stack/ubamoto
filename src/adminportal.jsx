import { useCallback, useEffect, useState } from 'react';
import PortalShell from './portalshell.jsx';
import { adminApi } from './lib/api';
import { formatRwf } from './fare';

const STATUS_TEXT = {
  requested: 'Waiting for a rider',
  assigned: 'Rider assigned',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const formatRef = (ref) => (ref ? `UB-${ref.slice(0, 4)}-${ref.slice(4)}` : '');
const when = (iso) =>
  new Date(iso).toLocaleString('en-RW', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

function BookingCard({ booking, riders, busy, onAssign, onCancel }) {
  const [riderId, setRiderId] = useState('');
  const open = ['requested', 'assigned', 'in_progress'].includes(booking.status);
  const canAssign = ['requested', 'assigned'].includes(booking.status);

  return (
    <article className="portal-card">
      <div className="portal-row">
        <strong>{formatRef(booking.reference) || 'Old request'}</strong>
        <span className={`portal-pill portal-${booking.status}`}>{STATUS_TEXT[booking.status] ?? booking.status}</span>
      </div>
      <p className="portal-note">
        {booking.customer_name} ·{' '}
        <a className="portal-link" href={`tel:${booking.customer_phone}`}>{booking.customer_phone}</a>
      </p>
      <p className="portal-note">
        To {booking.destination_name} · {formatRwf(booking.fare_rwf)} · {when(booking.created_at)}
      </p>
      {booking.rider && (
        <p className="portal-note">
          Rider: {booking.rider.name} ({booking.rider.phone}
          {booking.rider.plate_number ? `, ${booking.rider.plate_number}` : ''})
        </p>
      )}
      {booking.cancelled_by && <p className="portal-note">Cancelled by {booking.cancelled_by}</p>}

      {canAssign && (
        <div className="portal-actions">
          <select value={riderId} onChange={(event) => setRiderId(event.target.value)} aria-label="Choose a rider">
            <option value="">Choose a rider</option>
            {riders.filter((r) => r.status === 'verified').map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
          <button
            type="button"
            className="portal-btn"
            disabled={!riderId || busy}
            onClick={() => onAssign(booking.id, riderId)}
          >
            Assign rider
          </button>
        </div>
      )}
      {open && (
        <button type="button" className="portal-btn portal-btn-danger" disabled={busy} onClick={() => onCancel(booking.id)}>
          Cancel this ride
        </button>
      )}
    </article>
  );
}

function AdminApp() {
  const [allowed, setAllowed] = useState(null);
  const [tab, setTab] = useState('rides');
  const [filter, setFilter] = useState('requested');
  const [bookings, setBookings] = useState([]);
  const [riders, setRiders] = useState([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState(null);
  const [form, setForm] = useState({ email: '', password: '', name: '', phone: '', plate_number: '' });

  const load = useCallback(async () => {
    try {
      const [b, r] = await Promise.all([
        adminApi('list_bookings', { status: filter === 'all' ? undefined : filter }),
        adminApi('list_riders'),
      ]);
      setBookings(b.bookings);
      setRiders(r.riders);
    } catch (error) {
      setMessage(error.message);
    }
  }, [filter]);

  useEffect(() => {
    adminApi('me').then(() => setAllowed(true)).catch((error) => {
      setAllowed(false);
      setMessage(error.message);
    });
  }, []);

  useEffect(() => {
    if (!allowed) return undefined;
    load();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, 15000);
    return () => clearInterval(timer);
  }, [allowed, load]);

  async function run(action, params, okMessage) {
    setBusy(true);
    setMessage('');
    try {
      await adminApi(action, params);
      if (okMessage) setMessage(okMessage);
      await load();
      return true;
    } catch (error) {
      setMessage(error.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function search(event) {
    event.preventDefault();
    setMessage('');
    try {
      setFound((await adminApi('find', { query })).bookings);
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function addRider(event) {
    event.preventDefault();
    if (await run('create_rider', form, 'Rider created. Verify them in the list below.')) {
      setForm({ email: '', password: '', name: '', phone: '', plate_number: '' });
    }
  }

  if (allowed === null) return <p className="portal-note">Loading...</p>;
  if (!allowed) return <p className="portal-error">{message || 'This account is not a staff account.'}</p>;

  const set = (key) => (event) => setForm({ ...form, [key]: event.target.value });

  return (
    <>
      <div className="portal-tabs" role="tablist">
        {[['rides', 'Rides'], ['riders', 'Riders'], ['find', 'Find a ride']].map(([id, label]) => (
          <button key={id} type="button" className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {message && <p className="portal-error" role="status">{message}</p>}

      {tab === 'rides' && (
        <>
          <select className="portal-filter" value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Filter rides">
            <option value="requested">Waiting for a rider</option>
            <option value="assigned">Rider assigned</option>
            <option value="in_progress">In progress</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
            <option value="all">All</option>
          </select>
          <div className="portal-list">
            {bookings.length === 0 && <p className="portal-note">No rides in this list.</p>}
            {bookings.map((b) => (
              <BookingCard
                key={b.id}
                booking={b}
                riders={riders}
                busy={busy}
                onAssign={(id, riderId) => run('assign', { booking_id: id, rider_id: riderId }, 'Rider assigned.')}
                onCancel={(id) => window.confirm('Cancel this ride?') && run('cancel', { booking_id: id }, 'Ride cancelled.')}
              />
            ))}
          </div>
        </>
      )}

      {tab === 'riders' && (
        <>
          <form className="portal-card portal-login" onSubmit={addRider}>
            <h2>Add a rider</h2>
            <label>Name<input value={form.name} onChange={set('name')} required /></label>
            <label>Phone<input type="tel" value={form.phone} onChange={set('phone')} placeholder="078 123 4567" required /></label>
            <label>Plate number<input value={form.plate_number} onChange={set('plate_number')} /></label>
            <label>Email (their login)<input type="email" value={form.email} onChange={set('email')} required /></label>
            <label>Temporary password<input type="text" value={form.password} onChange={set('password')} minLength={8} required /></label>
            <button className="portal-btn" type="submit" disabled={busy}>Create rider</button>
            <p className="portal-note">New riders cannot see any ride until you verify them.</p>
          </form>

          <div className="portal-list">
            {riders.map((r) => (
              <article className="portal-card" key={r.id}>
                <div className="portal-row">
                  <strong>{r.name}</strong>
                  <span className={`portal-pill portal-${r.status}`}>{r.status}</span>
                </div>
                <p className="portal-note">{r.phone}{r.plate_number ? ` · ${r.plate_number}` : ''}</p>
                <div className="portal-actions">
                  {r.status !== 'verified' && (
                    <button type="button" className="portal-btn" disabled={busy} onClick={() => run('set_rider_status', { rider_id: r.id, status: 'verified' })}>
                      Verify
                    </button>
                  )}
                  {r.status !== 'suspended' && (
                    <button type="button" className="portal-btn portal-btn-danger" disabled={busy} onClick={() => run('set_rider_status', { rider_id: r.id, status: 'suspended' })}>
                      Suspend
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        </>
      )}

      {tab === 'find' && (
        <>
          <form className="portal-card portal-login" onSubmit={search}>
            <label>
              Booking reference or customer phone
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="UB-ABCD-EFGH or 078 123 4567" required />
            </label>
            <button className="portal-btn" type="submit">Search</button>
          </form>
          <div className="portal-list">
            {found && found.length === 0 && <p className="portal-note">Nothing found.</p>}
            {(found ?? []).map((b) => (
              <BookingCard
                key={b.id}
                booking={b}
                riders={riders}
                busy={busy}
                onAssign={(id, riderId) => run('assign', { booking_id: id, rider_id: riderId }, 'Rider assigned.')}
                onCancel={(id) => window.confirm('Cancel this ride?') && run('cancel', { booking_id: id }, 'Ride cancelled.')}
              />
            ))}
          </div>
        </>
      )}
    </>
  );
}

export default function AdminPortal() {
  return (
    <PortalShell title="UBAmoto Admin">
      <AdminApp />
    </PortalShell>
  );
}