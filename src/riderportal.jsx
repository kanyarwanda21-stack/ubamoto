import { useCallback, useEffect, useState } from 'react';
import PortalShell from './portalshell.jsx';
import { riderApi } from './lib/api';
import { formatRwf } from './fare';

function ago(iso) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.round(minutes / 60)} h ago`;
}

const mapLink = ([lat, lng]) =>
  `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;

const STATUS_TEXT = {
  assigned: 'Go to pickup',
  in_progress: 'Ride in progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

function RiderApp() {
  const [me, setMe] = useState(null);
  const [tab, setTab] = useState('open');
  const [open, setOpen] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    try {
      const [openResult, jobsResult] = await Promise.all([
        riderApi('list_open'),
        riderApi('my_jobs'),
      ]);
      setOpen(openResult.jobs);
      setJobs(jobsResult.jobs);
    } catch (error) {
      setMessage(error.message);
    }
  }, []);

  useEffect(() => {
    riderApi('me')
      .then((result) => setMe(result.rider))
      .catch((error) => setMessage(error.message));
  }, []);

  // Checks for new requests every 10 seconds while the page is open.
  useEffect(() => {
    if (me?.status !== 'verified') return undefined;
    load();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, 10000);
    return () => clearInterval(timer);
  }, [me, load]);

  async function act(action, id) {
    setBusyId(id);
    setMessage('');
    try {
      await riderApi(action, { id });
      if (action === 'accept') setTab('mine');
    } catch (error) {
      setMessage(error.message);
    }
    await load();
    setBusyId(null);
  }

  if (!me) {
    return <p className={message ? 'portal-error' : 'portal-note'}>{message || 'Loading...'}</p>;
  }

  if (me.status !== 'verified') {
    return (
      <div className="portal-card">
        <h2>{me.status === 'suspended' ? 'Account suspended' : 'Waiting for verification'}</h2>
        <p className="portal-note">
          {me.status === 'suspended'
            ? 'Please contact UBAmoto support.'
            : 'UBAmoto must check your details before you can see ride requests. We will tell you when this is done.'}
        </p>
      </div>
    );
  }

  const live = jobs.filter((job) => ['assigned', 'in_progress'].includes(job.status));
  const past = jobs.filter((job) => !['assigned', 'in_progress'].includes(job.status));

  return (
    <>
      <div className="portal-tabs" role="tablist">
        <button type="button" className={tab === 'open' ? 'active' : ''} onClick={() => setTab('open')}>
          New requests ({open.length})
        </button>
        <button type="button" className={tab === 'mine' ? 'active' : ''} onClick={() => setTab('mine')}>
          My rides ({live.length})
        </button>
        <button type="button" className={tab === 'past' ? 'active' : ''} onClick={() => setTab('past')}>
          History
        </button>
      </div>

      {message && <p className="portal-error" role="alert">{message}</p>}

      {tab === 'open' && (
        <div className="portal-list">
          {open.length === 0 && <p className="portal-note">No new requests right now. This page refreshes by itself.</p>}
          {open.map((job) => (
            <article className="portal-card" key={job.id}>
              <div className="portal-row">
                <strong>{job.destination_name}</strong>
                <span className="portal-price">{formatRwf(job.fare_rwf)}</span>
              </div>
              <p className="portal-note">
                {Number(job.distance_km).toFixed(1)} km · {job.duration_minutes} min · {ago(job.created_at)}
              </p>
              <a className="portal-link" href={mapLink(job.pickup_area)} target="_blank" rel="noreferrer">
                See the pickup area on the map
              </a>
              <button
                type="button"
                className="portal-btn"
                disabled={busyId === job.id}
                onClick={() => act('accept', job.id)}
              >
                {busyId === job.id ? 'Accepting...' : 'Accept this ride'}
              </button>
            </article>
          ))}
        </div>
      )}

      {tab === 'mine' && (
        <div className="portal-list">
          {live.length === 0 && <p className="portal-note">You have no active rides.</p>}
          {live.map((job) => (
            <article className="portal-card" key={job.id}>
              <div className="portal-row">
                <strong>{job.customer_name}</strong>
                <span className={`portal-pill portal-${job.status}`}>{STATUS_TEXT[job.status]}</span>
              </div>
              <p className="portal-note">To: {job.destination_name}</p>
              <p className="portal-note">
                {formatRwf(job.fare_rwf)} · {Number(job.distance_km).toFixed(1)} km · Ref {job.reference}
              </p>

              <div className="portal-actions">
                <a className="portal-btn" href={`tel:${job.customer_phone}`}>Call customer</a>
                <a className="portal-btn portal-btn-light" href={mapLink(job.pickup)} target="_blank" rel="noreferrer">
                  Directions to pickup
                </a>
                <a className="portal-btn portal-btn-light" href={mapLink(job.destination)} target="_blank" rel="noreferrer">
                  Directions to destination
                </a>
              </div>

              <div className="portal-actions">
                {job.status === 'assigned' && (
                  <>
                    <button type="button" className="portal-btn" disabled={busyId === job.id} onClick={() => act('start', job.id)}>
                      Start ride
                    </button>
                    <button type="button" className="portal-btn portal-btn-danger" disabled={busyId === job.id} onClick={() => act('release', job.id)}>
                      Give back
                    </button>
                  </>
                )}
                {job.status === 'in_progress' && (
                  <button type="button" className="portal-btn" disabled={busyId === job.id} onClick={() => act('complete', job.id)}>
                    Complete ride
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      {tab === 'past' && (
        <div className="portal-list">
          {past.length === 0 && <p className="portal-note">No finished rides yet.</p>}
          {past.map((job) => (
            <article className="portal-card" key={job.id}>
              <div className="portal-row">
                <strong>{job.destination_name}</strong>
                <span className={`portal-pill portal-${job.status}`}>{STATUS_TEXT[job.status]}</span>
              </div>
              <p className="portal-note">
                {formatRwf(job.fare_rwf)} · {ago(job.created_at)} · Ref {job.reference}
              </p>
            </article>
          ))}
        </div>
      )}
    </>
  );
}

export default function RiderPortal() {
  return (
    <PortalShell title="UBAmoto Rider">
      <RiderApp />
    </PortalShell>
  );
}