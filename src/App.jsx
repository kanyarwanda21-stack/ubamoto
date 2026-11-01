import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import CustomerScreens from './CustomerScreens.jsx';
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  Bike,
  CheckCheck,
  CheckCircle2,
  CircleHelp,
  CircleUserRound,
  Clock3,
  Compass,
  LocateFixed,
  MapPin,
  Navigation,
  Route,
  ShieldCheck,
  Wallet,
  WifiOff,
} from 'lucide-react';
import {
  Circle,
  MapContainer,
  Marker,
  Polyline,
  TileLayer,
  Tooltip,
  ZoomControl,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './index.css';
import {
  BASE_FARE_RWF,
  FARE_TIERS,
  MAX_TRIP_KM,
  MIN_FARE_RWF,
  OVER_20_KM_RATE_RWF,
  formatRwf,
  getFareBreakdown,
} from './fare';
import { KIGALI, isInRwanda, normalizeRwandaPhone } from './lib/geo';
import {
  cancelRideRequest,
  createBooking,
  estimateRoute,
  retrievePlace,
  searchPlaces,
  trackRides,
} from './lib/api';
import { loadJson, removeKeys, saveJson } from './lib/storage';
import { TERMS_VERSION } from './config';
import { useInstallPrompt } from './lib/pwa';

// Rider and admin screens are loaded only when someone opens #/rider or #/admin.
const RiderPortal = lazy(() => import('./riderportal.jsx'));
const AdminPortal = lazy(() => import('./adminportal.jsx'));

const ACTIVE_STATUSES = ['requested', 'assigned', 'in_progress'];

const PINNED_LABEL = 'Pinned location';
const NO_ROUTE = [];

// Map tiles come from Mapbox (set VITE_MAPBOX_TOKEN to a URL-restricted public token).
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;
const TILE_LAYER = MAPBOX_TOKEN
  ? {
      url: `https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/512/{z}/{x}/{y}@2x?access_token=${MAPBOX_TOKEN}`,
      tileSize: 512,
      zoomOffset: -1,
      attribution:
        '&copy; <a href="https://www.mapbox.com/about/maps/">Mapbox</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }
  : {
      // Development fallback only: OpenStreetMap's public tiles are not for production traffic.
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      tileSize: 256,
      zoomOffset: 0,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    };

// crypto.randomUUID only exists on https/localhost, so keep a fallback.
function newSessionId() {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`
  );
}

const SCREENS = ['rides', 'help', 'fare', 'profile', 'terms', 'privacy'];
const NAV_ITEMS = [
  ['home', 'Home'],
  ['book', 'Book a Ride'],
  ['rides', 'My Rides'],
  ['help', 'Help'],
  ['fare', 'Fare'],
];

// Phone tab bar: every tab has a visible word, not only an icon.
const BOTTOM_NAV = [
  ['home', 'Home', Compass],
  ['book', 'Book', MapPin],
  ['rides', 'Rides', Route],
  ['fare', 'Fare', Wallet],
  ['help', 'Help', CircleHelp],
  ['profile', 'Profile', CircleUserRound],
];

const formatReference = (ref) => (ref ? `UB-${ref.slice(0, 4)}-${ref.slice(4)}` : '');

function makePin(kind) {
  return L.divIcon({
    className: 'uba-map-pin-wrap',
    html: `<span class="uba-map-pin ${kind}"></span>`,
    iconSize: [30, 38],
    iconAnchor: [15, 34],
  });
}

const pickupIcon = makePin('pickup');
const destinationIcon = makePin('destination');

// Hash routing (#/book, #/rides, ...) so the browser back button and
// refresh work without adding a router dependency.
function readRoute() {
  const name = window.location.hash.replace(/^#\/?/, '');
  return name === 'book' || name === 'rider' || name === 'admin' || SCREENS.includes(name)
    ? name
    : 'home';
}

function useRoute() {
  const [route, setRoute] = useState(readRoute);

  useEffect(() => {
    const onChange = () => setRoute(readRoute());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const go = (name) => {
    window.location.hash = name === 'home' ? '/' : `/${name}`;
  };

  return [route, go];
}

// Moves the map only when `focus` changes (GPS, search result, target buttons).
// Plain map clicks and pin drags never re-zoom the map.
function MapUpdater({ focus }) {
  const map = useMap();

  useEffect(() => {
    if (focus) map.flyTo(focus.position, focus.zoom ?? map.getZoom(), { duration: 0.8 });
  }, [map, focus]);

  return null;
}

function MapClickHandler({ onSelect }) {
  useMapEvents({
    click(event) {
      onSelect([event.latlng.lat, event.latlng.lng]);
    },
  });

  return null;
}

function RouteFitter({ coordinates }) {
  const map = useMap();

  useEffect(() => {
    if (coordinates.length < 2) return;

    // On desktop the booking panel covers the left side of the map.
    const wide = window.innerWidth > 760;

    map.fitBounds(L.latLngBounds(coordinates), {
      paddingTopLeft: wide ? [460, 40] : [30, 30],
      paddingBottomRight: [30, 30],
      maxZoom: 15,
    });
  }, [map, coordinates]);

  return null;
}

function App() {
  const [route, go] = useRoute();

  const [pickupPosition, setPickupPosition] = useState(KIGALI);
  const [destinationPosition, setDestinationPosition] = useState(null);
  const [mapFocus, setMapFocus] = useState({ position: KIGALI, zoom: 13 });
  const [activeMapTarget, setActiveMapTarget] = useState('pickup');

  const [gpsAccuracy, setGpsAccuracy] = useState(null); // metres, only after a GPS fix
  const watchRef = useRef(null);
  const stopTimerRef = useRef(null);
  const [pickupConfirmed, setPickupConfirmed] = useState(false);
  const [pickupMessage, setPickupMessage] = useState(
    'Use GPS or select your pickup on the map.'
  );

  const [destination, setDestination] = useState('');
  const [destinationResults, setDestinationResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchMessage, setSearchMessage] = useState('');
  const [selectedDestinationName, setSelectedDestinationName] = useState('');

  // quote = { distance_km, duration_minutes, fare_rwf, expires_at, quote, geometry }
  // It comes from the server, which is the only place fares are calculated.
  const [quote, setQuote] = useState(null);
  const [estimateError, setEstimateError] = useState('');
  const [calculatingRoute, setCalculatingRoute] = useState(false);

  const [showWelcome, setShowWelcome] = useState(true);
  const [profile, setProfile] = useState(() =>
    loadJson('uba:profile', { name: '', phone: '' })
  );
  const [rides, setRides] = useState(() => loadJson('uba:rides', []));
  const [acceptedTerms, setAcceptedTerms] = useState(
    () => loadJson('uba:terms', null) === TERMS_VERSION
  );
  const [online, setOnline] = useState(() => window.navigator.onLine);
  const [installDismissed, setInstallDismissed] = useState(false);
  const install = useInstallPrompt();

  const [notifications, setNotifications] = useState([
    {
      id: 1,
      title: 'Welcome to UBAmoto',
      message: 'Book a moto in a few taps and see your fare before you confirm.',
      time: 'Just now',
      read: false,
    },
  ]);
  const [showNotifications, setShowNotifications] = useState(false);
  const notificationRef = useRef(null);

  const [customerName, setCustomerName] = useState(profile.name);
  const [customerPhone, setCustomerPhone] = useState(profile.phone);
  const [rideConfirmed, setRideConfirmed] = useState(false);
  // { type: 'pending' | 'error' | 'success', text } | null
  const [bookingStatus, setBookingStatus] = useState(null);
  const [submittingBooking, setSubmittingBooking] = useState(false);

  const routeCoordinates = quote ? quote.geometry : NO_ROUTE;

  const fareBreakdown = useMemo(
    () =>
      quote
        ? { ...getFareBreakdown(quote.distance_km), total: quote.fare_rwf }
        : null,
    [quote]
  );

  const pickupRef = useRef(pickupPosition);
  pickupRef.current = pickupPosition;
  // One search session = typing + picking one result (keeps Mapbox billing per session).
  const sessionRef = useRef(null);
  if (sessionRef.current === null) sessionRef.current = newSessionId();

  const destinationLabel =
    (selectedDestinationName || destination).trim() || PINNED_LABEL;

  const unreadCount = notifications.filter((item) => !item.read).length;
  const bookingMode = route === 'book';
  const screenMode = SCREENS.includes(route);

  function addNotification(title, message) {
    setNotifications((current) => [
      {
        id: Date.now(),
        title,
        message,
        time: new Date().toLocaleTimeString('en-RW', {
          hour: 'numeric',
          minute: '2-digit',
        }),
        read: false,
      },
      ...current,
    ]);
  }

  function markAllRead() {
    setNotifications((current) =>
      current.map((item) => ({ ...item, read: true }))
    );
  }

  useEffect(() => {
    const timer = setTimeout(() => setShowWelcome(false), 1800);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  // Each screen starts at the top and closes the notification panel.
  useEffect(() => {
    window.scrollTo(0, 0);
    setShowNotifications(false);
  }, [route]);

  // Close the notification panel on outside click or Escape.
  useEffect(() => {
    if (!showNotifications) return undefined;

    function handlePointer(event) {
      if (
        notificationRef.current &&
        !notificationRef.current.contains(event.target)
      ) {
        setShowNotifications(false);
      }
    }

    function handleKey(event) {
      if (event.key === 'Escape') setShowNotifications(false);
    }

    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('touchstart', handlePointer);
    document.addEventListener('keydown', handleKey);

    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('touchstart', handlePointer);
      document.removeEventListener('keydown', handleKey);
    };
  }, [showNotifications]);

  // Place search runs on the server (the provider key never reaches the browser).
  useEffect(() => {
    const query = destination.trim();

    if (query.length < 3 || selectedDestinationName === query) {
      setDestinationResults([]);
      setSearching(false);
      setSearchMessage('');
      return undefined;
    }

    let cancelled = false;

    const timer = setTimeout(async () => {
      setSearching(true);
      setSearchMessage('');

      try {
        const { results } = await searchPlaces(query, pickupRef.current, sessionRef.current);
        if (cancelled) return;

        setDestinationResults(results);
        if (results.length === 0) {
          setSearchMessage(
            'No match found. Try another spelling, or tap "Adjust destination" and tap the exact spot on the map.'
          );
        }
      } catch (error) {
        if (!cancelled) {
          setDestinationResults([]);
          setSearchMessage(error.message);
        }
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [destination, selectedDestinationName]);

  function clearRoute() {
    setQuote(null);
    setEstimateError('');
    setRideConfirmed(false);
    setBookingStatus(null);
    setSubmittingBooking(false);
  }

  // Returns true when the pickup was accepted.
  function selectPickup(position, focus = false) {
    if (!isInRwanda(position)) {
      setPickupMessage('UBAmoto serves Rwanda only. Choose a pickup inside Rwanda.');
      return false;
    }

    setPickupPosition(position);
    setGpsAccuracy(null);
    if (focus) setMapFocus({ position, zoom: 17 });
    setPickupConfirmed(false);
    clearRoute();
    setPickupMessage('Pickup changed. Confirm your new pickup point.');
    return true;
  }

  // Returns true when the destination was accepted.
  function selectDestination(position, name, focus = false) {
    if (!isInRwanda(position)) {
      setSearchMessage('UBAmoto serves Rwanda only. Choose a destination inside Rwanda.');
      return false;
    }

    setDestinationPosition(position);
    if (focus) setMapFocus({ position, zoom: 17 });
    setActiveMapTarget('destination');
    setDestination(name || '');
    setSelectedDestinationName(name || '');
    setDestinationResults([]);
    setSearchMessage('');
    clearRoute();
    return true;
  }

  // Fetches the exact coordinates of the chosen suggestion, then shows it on the map.
  async function chooseSearchResult(place) {
    setSearching(true);
    setSearchMessage('');

    try {
      const { place: found } = await retrievePlace(place.id, sessionRef.current);
      sessionRef.current = newSessionId();
      selectDestination([found.lat, found.lng], found.name || place.name, true);
    } catch (error) {
      setSearchMessage(error.message);
    } finally {
      setSearching(false);
    }
  }

  function stopLocating() {
    if (watchRef.current !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchRef.current);
    }
    watchRef.current = null;
    clearTimeout(stopTimerRef.current);
  }

  // Stop listening for GPS when the app unmounts.
  useEffect(() => stopLocating, []);

  // Listens for a few seconds and keeps the most accurate fix, because the
  // first position a browser returns is often a rough Wi-Fi/IP estimate.
  function locateMe() {
    if (!navigator.geolocation) {
      setPickupMessage('GPS is unavailable. Choose your pickup on the map.');
      return;
    }

    if (!window.isSecureContext) {
      setPickupMessage('Location needs a secure (https) connection. Choose your pickup on the map.');
      return;
    }

    stopLocating();
    setPickupMessage('Finding your location...');

    let bestAccuracy = Infinity;

    watchRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        if (accuracy >= bestAccuracy) return; // only keep better fixes
        bestAccuracy = accuracy;

        if (!selectPickup([latitude, longitude], true)) {
          stopLocating();
          return;
        }

        setActiveMapTarget('pickup');
        setGpsAccuracy(accuracy);
        const meters = Math.round(accuracy);

        if (accuracy <= 30) {
          setPickupMessage(`Location found (accurate to about ${meters} m). Confirm your pickup.`);
          stopLocating();
        } else {
          setPickupMessage(`Improving accuracy... currently about ${meters} m.`);
        }
      },
      (error) => {
        stopLocating();
        const messages = {
          1: 'Location permission denied. Allow location for this site, or select your pickup on the map.',
          2: 'Location unavailable. Turn on location services, or select it manually.',
          3: 'GPS timed out. Try again or select your pickup manually.',
        };

        setPickupMessage(messages[error.code] || 'Could not find your location.');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );

    stopTimerRef.current = setTimeout(() => {
      stopLocating();
      setPickupMessage(
        bestAccuracy === Infinity
          ? 'Could not get your location. Select your pickup on the map.'
          : `Best location found (about ${Math.round(bestAccuracy)} m). Drag the pin to adjust, then confirm.`
      );
    }, 12000);
  }

  function confirmPickup() {
    setPickupConfirmed(true);
    setPickupMessage('Pickup point confirmed.');
  }

  async function getFareEstimate(event) {
    event.preventDefault();

    if (!pickupConfirmed) {
      setPickupMessage('Please confirm your pickup point first.');
      return;
    }

    if (!destinationPosition) {
      setSearchMessage('Search for a destination and select one of the results.');
      return;
    }

    setCalculatingRoute(true);
    clearRoute();

    try {
      setQuote(await estimateRoute(pickupPosition, destinationPosition));
    } catch (error) {
      setEstimateError(error.message);
    } finally {
      setCalculatingRoute(false);
    }
  }

  async function handleConfirmRide(event) {
    event.preventDefault();

    if (submittingBooking || rideConfirmed) return;

    const name = customerName.trim();
    const phone = normalizeRwandaPhone(customerPhone);
    const fail = (text) => setBookingStatus({ type: 'error', text });

    if (!name || !customerPhone.trim()) {
      fail('Please enter your name and phone number.');
      return;
    }

    if (name.length > 100) {
      fail('Your name must be 100 characters or fewer.');
      return;
    }

    if (!phone) {
      fail('Please enter a valid Rwandan phone number, e.g. 078 123 4567.');
      return;
    }

    if (!acceptedTerms) {
      fail('Please accept the Terms of Service and Privacy Policy to continue.');
      return;
    }

    if (!pickupConfirmed || !quote) {
      fail('Please confirm your pickup and calculate your route first.');
      return;
    }

    if (Date.now() > quote.expires_at) {
      fail('Your fare estimate expired. Please calculate the route again.');
      return;
    }

    setSubmittingBooking(true);
    setBookingStatus({ type: 'pending', text: 'Sending your ride request...' });

    try {
      // Only the signed quote is sent: the server reads the route and fare from it.
      const result = await createBooking({
        customer_name: name,
        customer_phone: phone,
        destination_name: destinationLabel,
        quote: quote.quote,
        accepted_terms: true,
      });

      const ride = {
        id: result.booking_id ?? Date.now(),
        reference: result.reference,
        token: result.access_token, // private key to follow or cancel this ride from this device
        rider: null,
        from: 'Pickup point',
        to: destinationLabel,
        createdAt: new Date().toISOString(),
        distanceKm: quote.distance_km,
        fareRwf: quote.fare_rwf,
        durationMinutes: quote.duration_minutes,
        pickup: pickupPosition,
        destination: destinationPosition,
        status: 'requested',
      };
      const nextRides = [ride, ...rides].slice(0, 50);
      setRides(nextRides);
      saveJson('uba:rides', nextRides);

      setRideConfirmed(true);
      setBookingStatus({
        type: 'success',
        text: `Your ride request was sent. Your reference is ${formatReference(result.reference)}. Follow it in My Rides: your rider's details appear there once a rider accepts.`,
      });
      addNotification(
        'Ride request sent',
        `Your request to ${destinationLabel} (${formatRwf(quote.fare_rwf)}) was sent. Reference ${formatReference(result.reference)}. We will tell you when a rider accepts.`
      );
    } catch (error) {
      setBookingStatus({ type: 'error', text: error.message });
    } finally {
      setSubmittingBooking(false);
    }
  }

  function startNewBooking() {
    setDestination('');
    setDestinationPosition(null);
    setSelectedDestinationName('');
    clearRoute();
  }

  function saveProfile(next) {
    setProfile(next);
    saveJson('uba:profile', next);
    setCustomerName(next.name);
    setCustomerPhone(next.phone);
  }

  // ---------- Live ride status (no accounts: each ride is proven by its private token) ----------
  const ridesRef = useRef(rides);
  ridesRef.current = rides;

  function rideCredentials(ride) {
    if (!ride.reference) return null;
    if (ride.token) return { reference: ride.reference, token: ride.token };
    if (ride.phone) return { reference: ride.reference, phone: ride.phone };
    return null;
  }

  function announceChange(ride, fresh) {
    const place = ride.to;
    if (fresh.status === 'assigned' && ride.status !== 'assigned') {
      addNotification('Rider assigned', `${fresh.rider?.name ?? 'A rider'} accepted your ride to ${place}. Open My Rides to call them.`);
    } else if (fresh.status === 'in_progress' && ride.status !== 'in_progress') {
      addNotification('Ride started', `Your ride to ${place} has started.`);
    } else if (fresh.status === 'completed' && ride.status !== 'completed') {
      addNotification('Ride completed', `Your ride to ${place} is complete.`);
    } else if (fresh.status === 'cancelled' && ride.status !== 'cancelled') {
      addNotification('Ride cancelled', `Your ride to ${place} was cancelled.`);
    } else if (fresh.status === 'requested' && ride.status === 'assigned') {
      addNotification('Looking for another rider', `Your rider could not take the ride to ${place}. We are finding another rider.`);
    }
  }

  async function refreshRides() {
    const active = ridesRef.current.filter(
      (ride) => rideCredentials(ride) && ACTIVE_STATUSES.includes(ride.status)
    );
    if (active.length === 0) return;

    try {
      const { results } = await trackRides(active.map(rideCredentials).slice(0, 10));
      const byReference = new Map(results.filter((item) => item.found).map((item) => [item.reference, item]));
      let changed = false;

      const next = ridesRef.current.map((ride) => {
        const fresh = byReference.get(ride.reference);
        if (!fresh) return ride;
        const sameRider = JSON.stringify(fresh.rider) === JSON.stringify(ride.rider ?? null);
        if (fresh.status === ride.status && sameRider) return ride;
        changed = true;
        announceChange(ride, fresh);
        return { ...ride, status: fresh.status, rider: fresh.rider };
      });

      if (changed) {
        setRides(next);
        saveJson('uba:rides', next);
      }
    } catch {
      // Offline or busy: the next check will try again.
    }
  }

  useEffect(() => {
    if (!online) return undefined;
    refreshRides();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') refreshRides();
    }, 20000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshRides();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [online]);

  async function cancelRide(ride) {
    const credentials = rideCredentials(ride);
    if (!credentials) {
      return { ok: false, message: 'This ride cannot be cancelled from this device. Please contact support.' };
    }

    try {
      await cancelRideRequest(credentials);
      const next = ridesRef.current.map((item) =>
        item.reference === ride.reference ? { ...item, status: 'cancelled', rider: null } : item
      );
      setRides(next);
      saveJson('uba:rides', next);
      addNotification('Ride cancelled', `Your request to ${ride.to} was cancelled.`);
      return { ok: true, message: 'Your ride request was cancelled.' };
    } catch (error) {
      return { ok: false, message: error.message };
    }
  }

  // Lets a customer open a ride on another phone with reference + booking phone number.
  async function findRide(referenceInput, phoneInput) {
    const phone = normalizeRwandaPhone(phoneInput);
    if (!referenceInput.trim() || !phone) {
      return { ok: false, message: 'Enter your reference and the phone number used for the booking.' };
    }

    try {
      const { results } = await trackRides([{ reference: referenceInput, phone }]);
      const found = results[0];
      if (!found?.found) return { ok: false, message: 'We could not find a ride with those details.' };

      if (ridesRef.current.some((ride) => ride.reference === found.reference)) {
        return { ok: true, message: 'That ride is already in your list.' };
      }

      const ride = {
        id: found.reference,
        reference: found.reference,
        phone, // proves ownership on this device instead of a token
        rider: found.rider,
        from: 'Pickup point',
        to: found.destination_name,
        createdAt: found.created_at,
        distanceKm: found.distance_km,
        fareRwf: found.fare_rwf,
        durationMinutes: found.duration_minutes,
        pickup: found.pickup,
        destination: found.destination,
        status: found.status,
      };
      const next = [ride, ...ridesRef.current].slice(0, 50);
      setRides(next);
      saveJson('uba:rides', next);
      return { ok: true, message: 'Ride added to your list.' };
    } catch (error) {
      return { ok: false, message: error.message };
    }
  }

  function rebook(ride) {
    if (!ride.destination) return;
    selectDestination(ride.destination, ride.to, true);
    go('book');
  }

  function clearRides() {
    setRides([]);
    removeKeys(['uba:rides']);
  }

  function clearAllData() {
    removeKeys(['uba:rides', 'uba:profile', 'uba:terms']);
    setRides([]);
    setProfile({ name: '', phone: '' });
    setCustomerName('');
    setCustomerPhone('');
    setAcceptedTerms(false);
  }

  function openBooking() {
    go('book');
    setMapFocus({ position: pickupPosition });
  }

  function navigate(name) {
    if (name === 'book') openBooking();
    else go(name);
  }

  const mapContent = (
    <>
      <TileLayer
        attribution={TILE_LAYER.attribution}
        url={TILE_LAYER.url}
        tileSize={TILE_LAYER.tileSize}
        zoomOffset={TILE_LAYER.zoomOffset}
        maxZoom={19}
      />

      <ZoomControl position="bottomright" />
      <MapUpdater focus={mapFocus} />
      <RouteFitter coordinates={routeCoordinates} />

      <MapClickHandler
        onSelect={
          activeMapTarget === 'pickup'
            ? (point) => selectPickup(point)
            : (point) => selectDestination(point, PINNED_LABEL)
        }
      />

      <Marker
        position={pickupPosition}
        icon={pickupIcon}
        draggable
        eventHandlers={{
          dragend(event) {
            const point = event.target.getLatLng();
            // Snap the pin back if the new spot was rejected.
            if (!selectPickup([point.lat, point.lng])) {
              event.target.setLatLng(pickupPosition);
            }
          },
        }}
      />

      {gpsAccuracy > 0 && (
        <Circle
          center={pickupPosition}
          radius={gpsAccuracy}
          pathOptions={{ color: '#16834b', weight: 1, fillOpacity: 0.12 }}
        />
      )}

      {routeCoordinates.length > 1 && (
        <Polyline
          positions={routeCoordinates}
          pathOptions={{ color: '#159447', weight: 5, opacity: 0.9 }}
        />
      )}

      {destinationPosition && (
        <Marker
          position={destinationPosition}
          icon={destinationIcon}
          draggable
          eventHandlers={{
            dragend(event) {
              const point = event.target.getLatLng();
              if (!selectDestination([point.lat, point.lng], PINNED_LABEL)) {
                event.target.setLatLng(destinationPosition);
              }
            },
          }}
        >
          <Tooltip permanent direction="top" offset={[0, -30]}>
            {destinationLabel}
          </Tooltip>
        </Marker>
      )}
    </>
  );

  // Rider and admin portals use their own simple header, with no customer tab bar.
  if (route === 'rider' || route === 'admin') {
    return (
      <div className="app-shell screen-mode">
        <header className="site-header">
          <a className="brand" href="#/" aria-label="UBAmoto customer app">
            <img className="brand-mark-image" src="/ubamoto-pin.svg" alt="" />
            <span>
              UBA<span className="brand-accent">moto</span>
            </span>
          </a>
        </header>
        <main>
          <Suspense fallback={<p className="portal-note" style={{ padding: 24 }}>Loading...</p>}>
            {route === 'rider' ? <RiderPortal /> : <AdminPortal />}
          </Suspense>
        </main>
      </div>
    );
  }

  return (
    <>
      {showWelcome && (
        <div className="welcome-screen" role="status" aria-label="Welcome to UBAmoto">
          <div className="welcome-content">
            <img className="welcome-logo" src="/ubamoto-pin.svg" alt="" />
            <h1>
              UBA<span>moto</span>
            </h1>
            <p>Your ride. Your time. Your way.</p>
            <div className="welcome-loader" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          </div>
        </div>
      )}

      <div
        className={`app-shell ${
          screenMode ? 'screen-mode' : bookingMode ? 'booking-mode' : 'home-mode'
        }`}
      >
        <header className="site-header">
          <a className="brand" href="#/" aria-label="UBAmoto home">
            <img className="brand-mark-image" src="/ubamoto-pin.svg" alt="" />
            <span>
              UBA<span className="brand-accent">moto</span>
            </span>
          </a>

          <nav className="desktop-header-nav" aria-label="Main navigation">
            {NAV_ITEMS.map(([name, label]) => (
              <button
                key={name}
                type="button"
                className={route === name ? 'header-nav-link active' : 'header-nav-link'}
                aria-current={route === name ? 'page' : undefined}
                onClick={() => navigate(name)}
              >
                {label}
              </button>
            ))}
          </nav>

          <div className="header-location">
            <span className="location-dot" />
            Kigali, Rwanda
          </div>

          <div className="header-actions">
            <div className="notification-wrap" ref={notificationRef}>
              <button
                type="button"
                className={showNotifications ? 'notification-button active' : 'notification-button'}
                aria-label={
                  unreadCount ? `Notifications, ${unreadCount} unread` : 'Notifications'
                }
                aria-expanded={showNotifications}
                onClick={() => setShowNotifications((open) => !open)}
              >
                <Bell size={21} />
                {unreadCount > 0 && (
                  <span className="notification-badge">{unreadCount}</span>
                )}
              </button>

              {showNotifications && (
                <div className="notification-panel" role="region" aria-label="Notifications">
                  <div className="notification-panel-header">
                    <strong>Notifications</strong>
                    {unreadCount > 0 && (
                      <button type="button" onClick={markAllRead}>
                        <CheckCheck size={15} /> Mark all read
                      </button>
                    )}
                  </div>

                  {notifications.length === 0 ? (
                    <p className="notification-empty">You&rsquo;re all caught up.</p>
                  ) : (
                    <ul className="notification-list">
                      {notifications.map((item) => (
                        <li
                          key={item.id}
                          className={item.read ? 'notification-item' : 'notification-item unread'}
                        >
                          <span className="notification-dot" aria-hidden="true" />
                          <div>
                            <strong>{item.title}</strong>
                            <p>{item.message}</p>
                            <small>{item.time}</small>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            <button
              type="button"
              className={
                route === 'profile'
                  ? 'uba-app-profile-button active'
                  : 'uba-app-profile-button'
              }
              aria-label="Open profile"
              onClick={() => go('profile')}
            >
              <CircleUserRound size={22} />
              <span>Profile</span>
            </button>
          </div>
        </header>

        {!online && (
          <div className="offline-banner" role="status">
            <WifiOff size={16} /> You are offline. Booking needs an internet connection.
          </div>
        )}

        {route === 'home' && install.canInstall && !install.installed && !installDismissed && (
          <div className="install-banner">
            <span>Install UBAmoto on your phone for faster booking.</span>
            <div className="install-banner-actions">
              <button type="button" className="install-banner-go" onClick={install.install}>
                Install app
              </button>
              <button type="button" onClick={() => setInstallDismissed(true)}>
                Not now
              </button>
            </div>
          </div>
        )}

        <main>
          {screenMode ? (
            <CustomerScreens
              screen={route}
              profile={profile}
              rides={rides}
              install={install}
              onSaveProfile={saveProfile}
              onNavigate={navigate}
              onRebook={rebook}
              onClearRides={clearRides}
              onClearAll={clearAllData}
              onCancelRide={cancelRide}
              onFindRide={findRide}
              onRefresh={refreshRides}
            />
          ) : !bookingMode ? (
            <>
              <section className="hero-section home-hero">
                <div className="hero-copy">
                  <p className="eyebrow">YOUR CITY. YOUR RIDE.</p>

                  <h1>
                    Kigali moves.
                    <br />
                    <span>UBAmoto gets you there.</span>
                  </h1>

                  <p className="hero-description">
                    Book a moto from wherever you are. Choose your pickup, find
                    your destination and see your estimated fare before
                    requesting a ride, without searching the streets for a
                    rider.
                  </p>

                  <div className="trust-points">
                    <span>
                      <CheckCircle2 size={17} /> Convenient pickup
                    </span>
                    <span>
                      <ShieldCheck size={17} /> Fare transparency
                    </span>
                  </div>
                </div>

                <section className="booking-card home-fare-card">
                  <div className="booking-heading">
                    <div>
                      <p className="eyebrow">YOUR NEXT RIDE STARTS HERE</p>
                      <h2>Getting around, made easier.</h2>
                    </div>
                    <div className="icon-orb">
                      <Bike size={28} />
                    </div>
                  </div>

                  <p className="hero-description">
                    Book your moto in a few simple steps, with your route and
                    estimated fare shown before you confirm.
                  </p>

                  <div className="home-feature-row">
                    <span className="feature-icon">
                      <MapPin size={19} />
                    </span>
                    <div>
                      <strong>Choose your pickup</strong>
                      <p>Use GPS or select your point on the map.</p>
                    </div>
                  </div>

                  <div className="home-feature-row">
                    <span className="feature-icon">
                      <Route size={19} />
                    </span>
                    <div>
                      <strong>See your route</strong>
                      <p>Choose a destination and calculate the road distance.</p>
                    </div>
                  </div>

                  <div className="fare-rule">
                    <span>Minimum fare</span>
                    <strong>{formatRwf(MIN_FARE_RWF)}</strong>
                  </div>

                  <div className="fare-rule">
                    <span>Base fare (once per trip)</span>
                    <strong>{formatRwf(BASE_FARE_RWF)}</strong>
                  </div>

                  {FARE_TIERS.map((tier) => (
                    <div className="fare-rule" key={tier.label}>
                      <span>{tier.label}</span>
                      <strong>RWF {tier.ratePerKm}/km</strong>
                    </div>
                  ))}

                  <div className="fare-rule">
                    <span>Over 20 km</span>
                    <strong>RWF {OVER_20_KM_RATE_RWF}/km</strong>
                  </div>

                  <p className="field-hint">
                    Your fare is calculated from the road distance of your
                    route and shown before you request a ride.
                  </p>

                  <button
                    className="estimate-button home-book-button"
                    type="button"
                    onClick={openBooking}
                  >
                    Start booking <ArrowRight size={19} />
                  </button>
                </section>
              </section>

              <section className="benefits-section">
                <div>
                  <span className="benefit-icon">
                    <MapPin size={22} />
                  </span>
                  <h3>Pickup on your terms</h3>
                  <p>Choose a convenient pickup point on the map.</p>
                </div>

                <div>
                  <span className="benefit-icon">
                    <Wallet size={22} />
                  </span>
                  <h3>Know your estimated fare</h3>
                  <p>See the estimated cost before sending a request.</p>
                </div>

                <div>
                  <span className="benefit-icon">
                    <Compass size={22} />
                  </span>
                  <h3>Made for Kigali</h3>
                  <p>A simple moto-booking experience designed for the city.</p>
                </div>
              </section>
            </>
          ) : (
            <section className="booking-workspace">
              <div className="booking-map-stage">
                <MapContainer
                  center={KIGALI}
                  zoom={13}
                  scrollWheelZoom
                  zoomControl={false}
                  className="pickup-map"
                >
                  {mapContent}
                </MapContainer>

                <div className="map-floating-label">
                  <span className="location-dot" />
                  <div>
                    <strong>Kigali, Rwanda</strong>
                    <span>Choose a pickup and destination</span>
                  </div>
                </div>

                <div className="map-floating-legend">
                  <span>
                    <i className="legend-pickup" /> Pickup
                  </span>
                  <span>
                    <i className="legend-destination" /> Destination
                  </span>
                  <span>
                    <i className="legend-route" /> Route
                  </span>
                </div>
              </div>

              <section className="booking-card booking-floating-panel">
                <div className="booking-heading">
                  <div>
                    <p className="eyebrow">LET'S GET YOU THERE</p>
                    <h2>Book your ride</h2>
                    <p className="booking-subtitle">
                      Set your pickup, choose where you're going, and review
                      your estimated fare.
                    </p>
                  </div>
                  <div className="icon-orb">
                    <Bike size={26} />
                  </div>
                </div>

                <a className="back-home-button" href="#/">
                  <ArrowLeft size={16} /> Back to home
                </a>

                <div className="field-group">
                  <span className="field-label">Pickup location</span>

                  <button className="gps-button" type="button" onClick={locateMe}>
                    <LocateFixed size={18} />
                    Use my current location
                  </button>

                  <p className="field-hint">
                    Or choose pickup on the map. Select which pin you want to
                    adjust below.
                  </p>
                </div>

                <div className="map-target-buttons">
                  <button
                    type="button"
                    className={
                      activeMapTarget === 'pickup'
                        ? 'map-target-button active'
                        : 'map-target-button'
                    }
                    onClick={() => {
                      setActiveMapTarget('pickup');
                      setMapFocus({ position: pickupPosition });
                    }}
                  >
                    <MapPin size={16} /> Choose pickup
                  </button>

                  <button
                    type="button"
                    className={
                      activeMapTarget === 'destination'
                        ? 'map-target-button active'
                        : 'map-target-button'
                    }
                    onClick={() => {
                      setActiveMapTarget('destination');
                      if (destinationPosition) {
                        setMapFocus({ position: destinationPosition });
                      }
                    }}
                  >
                    <Navigation size={16} /> Adjust destination
                  </button>
                </div>

                <div className="coordinates-panel">
                  <span className="coordinate-pin">
                    <MapPin size={19} />
                  </span>
                  <div className="coordinate-copy">
                    <strong>Pickup point</strong>
                    <span>
                      {pickupPosition[0].toFixed(5)}, {pickupPosition[1].toFixed(5)}
                    </span>
                  </div>
                </div>

                <p className="location-message" role="status">
                  {pickupMessage}
                </p>

                <button className="confirm-button" type="button" onClick={confirmPickup}>
                  {pickupConfirmed ? (
                    <>
                      <CheckCircle2 size={17} /> Pickup confirmed
                    </>
                  ) : (
                    'Confirm pickup point'
                  )}
                </button>

                {/* Form 1: destination and fare. Form 2 (review) is separate so
                    pressing Enter in the name/phone fields never recalculates. */}
                <form onSubmit={getFareEstimate}>
                  <div className="field-group destination-field">
                    <label htmlFor="destination">Destination</label>

                    <div className="destination-input-wrap">
                      <MapPin size={18} />
                      <input
                        id="destination"
                        name="destination"
                        type="text"
                        autoComplete="off"
                        placeholder="Search a place, road or business"
                        value={destination}
                        onChange={(event) => {
                          setDestination(event.target.value);
                          setSelectedDestinationName('');
                          setDestinationPosition(null);
                          clearRoute();
                          setSearchMessage('');
                        }}
                      />
                    </div>

                    {searching && <p className="field-hint">Searching places...</p>}

                    {destinationResults.length > 0 && (
                      <div className="destination-results">
                        {destinationResults.map((place) => (
                          <button
                            className="destination-result"
                            type="button"
                            key={place.id}
                            onClick={() => chooseSearchResult(place)}
                          >
                            <strong>{place.name}</strong>
                            <span>{place.details || 'Rwanda'}</span>
                          </button>
                        ))}
                      </div>
                    )}

                    {searchMessage && (
                      <p className="search-message" role="status">
                        {searchMessage}
                      </p>
                    )}

                    {destinationPosition && (
                      <p className="field-hint selected-destination">
                        <CheckCircle2 size={15} />
                        Selected: {destinationLabel}
                      </p>
                    )}
                  </div>

                  <button
                    className="estimate-button"
                    type="submit"
                    disabled={calculatingRoute || submittingBooking}
                  >
                    {calculatingRoute ? (
                      'Calculating route...'
                    ) : (
                      <>
                        Calculate route &amp; fare <ArrowRight size={18} />
                      </>
                    )}
                  </button>
                </form>

                {estimateError && (
                  <p className="estimate-error" role="alert">
                    {estimateError}
                  </p>
                )}

                {quote && fareBreakdown && (
                  <>
                    <div className="estimate-message" role="status">
                      <strong>Estimated fare: {formatRwf(quote.fare_rwf)}</strong>

                      <div className="route-details">
                        <span>
                          <Route size={15} /> {quote.distance_km.toFixed(1)} km
                        </span>
                        <span>
                          <Clock3 size={15} /> {quote.duration_minutes} min
                        </span>
                      </div>
                    </div>

                    <section className="ride-review-card">
                      <p className="eyebrow">ONE LAST CHECK</p>
                      <h3>Review your ride</h3>

                      <div className="review-row">
                        <span>
                          <MapPin size={15} /> Pickup
                        </span>
                        <strong>
                          {pickupPosition[0].toFixed(5)}, {pickupPosition[1].toFixed(5)}
                        </strong>
                      </div>

                      <div className="review-row">
                        <span>
                          <Navigation size={15} /> Destination
                        </span>
                        <strong>{destinationLabel}</strong>
                      </div>

                      <div className="review-row">
                        <span>
                          <Route size={15} /> Road distance
                        </span>
                        <strong>{quote.distance_km.toFixed(1)} km</strong>
                      </div>

                      <div className="review-row">
                        <span>
                          <Clock3 size={15} /> Estimated time
                        </span>
                        <strong>{quote.duration_minutes} min</strong>
                      </div>

                      <div className="review-row">
                        <span>Base fare</span>
                        <strong>{formatRwf(fareBreakdown.base)}</strong>
                      </div>

                      <div className="review-row">
                        <span>Distance charge</span>
                        <strong>{formatRwf(fareBreakdown.distanceCharge)}</strong>
                      </div>

                      <div className="review-fare">
                        <span>Estimated fare</span>
                        <strong>{formatRwf(fareBreakdown.total)}</strong>
                      </div>

                      {fareBreakdown.minimumApplied && (
                        <p className="field-hint minimum-note">
                          Minimum fare of {formatRwf(MIN_FARE_RWF)} applied to this
                          short trip.
                        </p>
                      )}

                      {!rideConfirmed && (
                        <form className="customer-details" onSubmit={handleConfirmRide}>
                          <div className="field-group">
                            <label htmlFor="customer-name">Your name</label>
                            <input
                              id="customer-name"
                              type="text"
                              autoComplete="name"
                              maxLength={100}
                              placeholder="Enter your name"
                              value={customerName}
                              onChange={(event) => setCustomerName(event.target.value)}
                              disabled={submittingBooking}
                            />
                          </div>

                          <div className="field-group">
                            <label htmlFor="customer-phone">Phone number</label>
                            <input
                              id="customer-phone"
                              type="tel"
                              autoComplete="tel"
                              maxLength={20}
                              placeholder="e.g. 078 123 4567"
                              value={customerPhone}
                              onChange={(event) => setCustomerPhone(event.target.value)}
                              disabled={submittingBooking}
                            />
                          </div>

                          <label className="consent-row">
                            <input
                              type="checkbox"
                              checked={acceptedTerms}
                              disabled={submittingBooking}
                              onChange={(event) => {
                                setAcceptedTerms(event.target.checked);
                                saveJson('uba:terms', event.target.checked ? TERMS_VERSION : null);
                              }}
                            />
                            <span>
                              I agree to the <a href="#/terms">Terms of Service</a> and{' '}
                              <a href="#/privacy">Privacy Policy</a>.
                            </span>
                          </label>

                          <button
                            className="estimate-button"
                            type="submit"
                            disabled={submittingBooking}
                          >
                            {submittingBooking ? (
                              'Submitting request...'
                            ) : (
                              <>
                                Confirm ride request <ArrowRight size={18} />
                              </>
                            )}
                          </button>
                        </form>
                      )}

                      {bookingStatus && (
                        <p
                          className={`booking-${
                            bookingStatus.type === 'success'
                              ? 'success'
                              : bookingStatus.type === 'pending'
                                ? 'pending'
                                : 'error'
                          }`}
                          role="status"
                        >
                          {bookingStatus.text}
                        </p>
                      )}

                      {rideConfirmed && (
                        <button
                          className="confirm-button new-booking-button"
                          type="button"
                          onClick={startNewBooking}
                        >
                          Start a new booking
                        </button>
                      )}
                    </section>
                  </>
                )}

                <p className="demo-note">
                  Fare: {formatRwf(BASE_FARE_RWF)} base, then RWF{' '}
                  {FARE_TIERS[0].ratePerKm}/km up to 8 km, RWF{' '}
                  {FARE_TIERS[1].ratePerKm}/km from 8 to 20 km and RWF{' '}
                  {OVER_20_KM_RATE_RWF}/km beyond. Minimum fare{' '}
                  {formatRwf(MIN_FARE_RWF)}. Trips are limited to {MAX_TRIP_KM} km.
                </p>
              </section>
            </section>
          )}
        </main>

        {route === 'home' && (
          <footer className="site-footer">
            <a className="brand footer-brand" href="#/">
              <img className="brand-mark-image" src="/ubamoto-pin.svg" alt="" />
              <span>
                UBA<span className="brand-accent">moto</span>
              </span>
            </a>
            <p>Getting Kigali moving, one ride at a time.</p>
            <nav className="footer-links" aria-label="Legal">
              <a href="#/terms">Terms of Service</a>
              <a href="#/privacy">Privacy Policy</a>
              <a href="#/help">Help</a>
              <a href="#/rider">Rider login</a>
            </nav>
          </footer>
        )}

        <nav className="bottom-nav" aria-label="App navigation">
          {BOTTOM_NAV.map(([name, label, Icon]) => (
            <button
              key={name}
              type="button"
              className={route === name ? 'bottom-nav-item active' : 'bottom-nav-item'}
              aria-current={route === name ? 'page' : undefined}
              onClick={() => navigate(name)}
            >
              <Icon size={22} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
      </div>
    </>
  );
}

export default App;