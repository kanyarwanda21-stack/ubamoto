import { useEffect, useState } from 'react';
import {
  MapContainer,
  Marker,
  Polyline,
  TileLayer,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './index.css';

const KIGALI = [-1.9441, 30.0619];
const SEARCH_URL = 'https://photon.komoot.io/api/';
const ROUTE_URL = 'https://router.project-osrm.org/route/v1/driving';

const BASE_FARE_RWF = 400;
const INCLUDED_DISTANCE_KM = 2;
const EXTRA_KM_RATE_RWF = 130;

function makeIcon() {
  return L.icon({
    iconUrl: new URL(
      'leaflet/dist/images/marker-icon.png',
      import.meta.url
    ).href,
    iconRetinaUrl: new URL(
      'leaflet/dist/images/marker-icon-2x.png',
      import.meta.url
    ).href,
    shadowUrl: new URL(
      'leaflet/dist/images/marker-shadow.png',
      import.meta.url
    ).href,
    iconSize: [25, 41],
    iconAnchor: [12, 41],
  });
}

const mapIcon = makeIcon();

function MapUpdater({ position }) {
  const map = useMap();

  useEffect(() => {
    map.flyTo(position, 15, { duration: 0.8 });
  }, [map, position]);

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

    const bounds = L.latLngBounds(coordinates);

    map.fitBounds(bounds, {
      padding: [35, 35],
      maxZoom: 15,
    });
  }, [map, coordinates]);

  return null;
}

function App() {
  const [pickupPosition, setPickupPosition] = useState(KIGALI);
  const [destinationPosition, setDestinationPosition] = useState(null);
  const [mapFocusPosition, setMapFocusPosition] = useState(KIGALI);
  const [activeMapTarget, setActiveMapTarget] = useState('pickup');

  const [pickupConfirmed, setPickupConfirmed] = useState(false);
  const [pickupMessage, setPickupMessage] = useState(
    'Use GPS or select your pickup on the map.'
  );

  const [destination, setDestination] = useState('');
  const [destinationResults, setDestinationResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchMessage, setSearchMessage] = useState('');
  const [selectedDestinationName, setSelectedDestinationName] = useState('');

  const [estimate, setEstimate] = useState('');
  const [routeCoordinates, setRouteCoordinates] = useState([]);
  const [routeDistanceKm, setRouteDistanceKm] = useState(null);
  const [routeDurationMinutes, setRouteDurationMinutes] = useState(null);
  const [calculatingRoute, setCalculatingRoute] = useState(false);

  // Welcome screen and demo ride confirmation
  const [showWelcome, setShowWelcome] = useState(true);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [showRideReview, setShowRideReview] = useState(false);
  const [rideConfirmed, setRideConfirmed] = useState(false);
  const [bookingMessage, setBookingMessage] = useState('');

  // Show the welcome screen for 1.8 seconds.
  useEffect(() => {
    const timer = setTimeout(() => setShowWelcome(false), 1800);
    return () => clearTimeout(timer);
  }, []);

  // Search for destinations in Rwanda.
  useEffect(() => {
    const query = destination.trim();

    if (query.length < 3 || selectedDestinationName === query) {
      setDestinationResults([]);
      setSearching(false);
      setSearchMessage('');
      return;
    }

    let cancelled = false;

    const timer = setTimeout(async () => {
      setSearching(true);
      setSearchMessage('');

      try {
        const params = new URLSearchParams({
          q: query,
          limit: '5',
          lat: String(pickupPosition[0]),
          lon: String(pickupPosition[1]),
          lang: 'en',
        });

        const response = await fetch(`${SEARCH_URL}?${params}`);

        if (!response.ok) {
          throw new Error('Search request failed');
        }

        const data = await response.json();

        if (cancelled) return;

        const results = (data.features || []).filter((feature) => {
          const coordinates = feature.geometry?.coordinates;
          const country = feature.properties?.countrycode;

          return (
            Array.isArray(coordinates) &&
            coordinates.length >= 2 &&
            country === 'RW'
          );
        });

        setDestinationResults(results);

        if (results.length === 0) {
          setSearchMessage(
            'No matching places in Rwanda. Try another name.'
          );
        }
      } catch {
        if (!cancelled) {
          setDestinationResults([]);
          setSearchMessage(
            'Place search is temporarily unavailable. Try again.'
          );
        }
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 650);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [destination, pickupPosition, selectedDestinationName]);

  function clearRoute() {
    setEstimate('');
    setRouteCoordinates([]);
    setRouteDistanceKm(null);
    setRouteDurationMinutes(null);
    setShowRideReview(false);
    setRideConfirmed(false);
    setBookingMessage('');
  }

  function selectPickup(position) {
    setPickupPosition(position);
    setMapFocusPosition(position);
    setPickupConfirmed(false);
    clearRoute();
    setPickupMessage(
      'Pickup changed. Confirm your new pickup point.'
    );
  }

  function selectDestination(position, name) {
    setDestinationPosition(position);
    setMapFocusPosition(position);
    setActiveMapTarget('destination');
    setDestination(name || '');
    setSelectedDestinationName(name || '');
    setDestinationResults([]);
    setSearchMessage('');
    clearRoute();
  }

  function useMyLocation() {
    if (!navigator.geolocation) {
      setPickupMessage(
        'GPS is unavailable. Choose your pickup on the map.'
      );
      return;
    }

    setPickupMessage('Finding your location…');

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const point = [
          position.coords.latitude,
          position.coords.longitude,
        ];

        selectPickup(point);
        setActiveMapTarget('pickup');
        setPickupMessage(
          'GPS location found. Check the pin and confirm pickup.'
        );
      },
      (error) => {
        const messages = {
          1: 'Location permission denied. You can still select your pickup on the map.',
          2: 'Location unavailable. Try again or select it manually.',
          3: 'GPS timed out. Try again or select your pickup manually.',
        };

        setPickupMessage(
          messages[error.code] || 'Could not find your location.'
        );
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 30000,
      }
    );
  }

  function confirmPickup() {
    setPickupConfirmed(true);
    setPickupMessage('Pickup point confirmed for this demo.');
  }

  // Get the road route and calculate an estimated fare.
  async function getFareEstimate(event) {
    event.preventDefault();

    if (!pickupConfirmed) {
      setPickupMessage(
        'Please confirm your pickup point first.'
      );
      return;
    }

    if (!destinationPosition) {
      setSearchMessage(
        'Search for a destination and select one of the results.'
      );
      return;
    }

    const sameLatitude =
      Math.abs(pickupPosition[0] - destinationPosition[0]) < 0.00001;
    const sameLongitude =
      Math.abs(pickupPosition[1] - destinationPosition[1]) < 0.00001;

    if (sameLatitude && sameLongitude) {
      setEstimate(
        'Pickup and destination are almost the same point. Please choose a different destination.'
      );
      return;
    }

    setCalculatingRoute(true);
    clearRoute();

    try {
      // OSRM expects longitude,latitude coordinates.
      const coordinates = [
        `${pickupPosition[1]},${pickupPosition[0]}`,
        `${destinationPosition[1]},${destinationPosition[0]}`,
      ].join(';');

      const response = await fetch(
        `${ROUTE_URL}/${coordinates}?overview=full&geometries=geojson&steps=false`
      );

      if (!response.ok) {
        throw new Error('Routing request failed');
      }

      const data = await response.json();
      const route = data.routes?.[0];

      if (data.code !== 'Ok' || !route) {
        throw new Error('No drivable route found');
      }

      const distanceKm = route.distance / 1000;
      const durationMinutes = route.duration / 60;

      const extraKm = Math.max(
        0,
        distanceKm - INCLUDED_DISTANCE_KM
      );

      const fareRwf = Math.round(
        BASE_FARE_RWF + extraKm * EXTRA_KM_RATE_RWF
      );

      const lineCoordinates = (
        route.geometry?.coordinates || []
      ).map(([longitude, latitude]) => [
        latitude,
        longitude,
      ]);

      setRouteCoordinates(lineCoordinates);
      setRouteDistanceKm(distanceKm);
      setRouteDurationMinutes(durationMinutes);

      setEstimate(
        `Estimated fare: RWF ${fareRwf.toLocaleString('en-RW')}`
      );
      setShowRideReview(true);
      setRideConfirmed(false);
      setBookingMessage('');
    } catch {
      setEstimate(
        'We could not calculate the road route right now. Please try again in a moment.'
      );
    } finally {
      setCalculatingRoute(false);
    }
  }

  function handleConfirmRide(event) {
    event.preventDefault();

    if (!customerName.trim() || !customerPhone.trim()) {
      setBookingMessage('Please enter your name and phone number.');
      return;
    }

    if (!/^[0-9+\s()-]{8,20}$/.test(customerPhone.trim())) {
      setBookingMessage('Please enter a valid phone number.');
      return;
    }

    setRideConfirmed(true);
    setBookingMessage(
      'Your demo ride request has been confirmed on this device. No rider has been contacted yet.'
    );
  }

  return (
    <>
      {showWelcome && (
        <div
          className="welcome-screen"
          role="status"
          aria-label="Welcome to UBAmoto"
        >
          <div className="welcome-content">
            <div className="welcome-bike" aria-hidden="true">
              🏍️
            </div>
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

      <div className="app-shell">
        <header className="site-header">
          <a className="brand" href="/" aria-label="UBAmoto home">
            <span className="brand-mark">U</span>
            <span>
              UBA<span className="brand-accent">moto</span>
            </span>
          </a>

          <div className="header-location">
            <span className="location-dot" />
            Kigali, Rwanda
          </div>

          <button
            className="sign-in-button"
            type="button"
            onClick={() => alert('Sign-in will be added later.')}
          >
            Sign in
          </button>
        </header>

        <main>
          <section className="hero-section">
            <div className="hero-copy">
              <p className="eyebrow">YOUR CITY. YOUR RIDE.</p>

              <h1>
                Kigali moves
                <br />
                with <span>UBAmoto.</span>
              </h1>

              <p className="hero-description">
                Book a moto from wherever you are. Choose your pickup,
                search for your destination, and get ready to ride.
              </p>

              <div className="trust-points">
                <span>✓ Convenient pickup</span>
                <span>✓ Built for Kigali</span>
              </div>
            </div>

            <section className="booking-card">
              <div className="booking-heading">
                <div>
                  <p className="eyebrow">LET'S GET YOU THERE</p>
                  <h2>Book your ride</h2>
                </div>

                <span className="bike-emoji" aria-hidden="true">
                  🏍️
                </span>
              </div>

              <form onSubmit={getFareEstimate}>
                <div className="field-group">
                  <label>Pickup location</label>

                  <button
                    className="gps-button"
                    type="button"
                    onClick={useMyLocation}
                  >
                    <span aria-hidden="true">◎</span>
                    Use my current location
                  </button>

                  <p className="field-hint">
                    GPS suggests a pickup. Adjust the pin on the map if needed.
                  </p>
                </div>

                <div className="map-wrapper">
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
                        setMapFocusPosition(pickupPosition);
                      }}
                    >
                      📍 Choose pickup
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
                          setMapFocusPosition(destinationPosition);
                        }
                      }}
                    >
                      🏁 Adjust destination
                    </button>
                  </div>

                  <MapContainer
                    center={KIGALI}
                    zoom={13}
                    scrollWheelZoom
                    className="pickup-map"
                  >
                    <TileLayer
                      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />

                    <MapUpdater position={mapFocusPosition} />

                    <RouteFitter coordinates={routeCoordinates} />

                    <MapClickHandler
                      onSelect={
                        activeMapTarget === 'pickup'
                          ? selectPickup
                          : (point) =>
                              selectDestination(point, destination)
                      }
                    />

                    <Marker
                      position={pickupPosition}
                      icon={mapIcon}
                      draggable
                      eventHandlers={{
                        dragend(event) {
                          const point = event.target.getLatLng();
                          selectPickup([point.lat, point.lng]);
                        },
                      }}
                    />

                    {routeCoordinates.length > 1 && (
                      <Polyline
                        positions={routeCoordinates}
                        pathOptions={{
                          color: '#159447',
                          weight: 5,
                          opacity: 0.85,
                        }}
                      />
                    )}

                    {destinationPosition && (
                      <Marker
                        position={destinationPosition}
                        icon={mapIcon}
                        draggable
                        eventHandlers={{
                          dragend(event) {
                            const point = event.target.getLatLng();
                            selectDestination(point, destination);
                          },
                        }}
                      />
                    )}
                  </MapContainer>

                  <p className="map-instruction">
                    {activeMapTarget === 'pickup'
                      ? 'Tap the map or drag the pin to adjust your pickup.'
                      : 'Your searched destination is shown here. You can adjust its pin.'}
                  </p>
                </div>

                <div className="coordinates-panel">
                  <span className="coordinate-pin" aria-hidden="true">
                    📍
                  </span>

                  <div className="coordinate-copy">
                    <strong>Pickup point</strong>
                    <span>
                      {pickupPosition[0].toFixed(6)},{' '}
                      {pickupPosition[1].toFixed(6)}
                    </span>
                  </div>
                </div>

                <p className="location-message" role="status">
                  {pickupMessage}
                </p>

                <button
                  className="confirm-button"
                  type="button"
                  onClick={confirmPickup}
                >
                  {pickupConfirmed
                    ? '✓ Pickup confirmed'
                    : 'Confirm pickup point'}
                </button>

                <div className="field-group destination-field">
                  <label htmlFor="destination">
                    Where are you going?
                  </label>

                  <input
                    id="destination"
                    name="destination"
                    type="text"
                    autoComplete="off"
                    placeholder="Try Kigali Convention Centre"
                    value={destination}
                    onChange={(event) => {
                      setDestination(event.target.value);
                      setSelectedDestinationName('');
                      setDestinationPosition(null);
                      clearRoute();
                      setSearchMessage('');
                    }}
                  />

                  {searching && (
                    <p className="field-hint">Searching places…</p>
                  )}

                  {destinationResults.length > 0 && (
                    <div className="destination-results">
                      {destinationResults.map((feature, index) => {
                        const props = feature.properties || {};
                        const coords = feature.geometry.coordinates;
                        const title = props.name || 'Unnamed place';

                        const details = [
                          props.street,
                          props.district,
                          props.city,
                          props.state,
                        ]
                          .filter(Boolean)
                          .join(', ');

                        return (
                          <button
                            className="destination-result"
                            type="button"
                            key={`${props.osm_type || 'place'}-${props.osm_id || index}-${index}`}
                            onClick={() => {
                              selectDestination(
                                [coords[1], coords[0]],
                                title
                              );
                            }}
                          >
                            <strong>{title}</strong>
                            <span>
                              {details || props.country || 'Rwanda'}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {searchMessage && (
                    <p className="search-message" role="status">
                      {searchMessage}
                    </p>
                  )}

                  {destinationPosition && (
                    <p className="field-hint">
                      Selected: {selectedDestinationName || destination}
                      <br />
                      {destinationPosition[0].toFixed(6)},{' '}
                      {destinationPosition[1].toFixed(6)}
                    </p>
                  )}
                </div>

                <button
                  className="estimate-button"
                  type="submit"
                  disabled={calculatingRoute}
                >
                  {calculatingRoute
                    ? 'Calculating route…'
                    : 'Calculate route & fare'}

                  {!calculatingRoute && (
                    <span aria-hidden="true"> →</span>
                  )}
                </button>

                {estimate && (
                  <div className="estimate-message" role="status">
                    <strong>{estimate}</strong>

                    {routeDistanceKm !== null && (
                      <div className="route-details">
                        <span>
                          Road distance: {routeDistanceKm.toFixed(1)} km
                        </span>

                        <span>
                          Estimated ride time:{' '}
                          {Math.max(1, Math.round(routeDurationMinutes))}{' '}
                          min
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {showRideReview && routeDistanceKm !== null && (
                  <section className="ride-review-card">
                    <p className="eyebrow">ONE LAST CHECK</p>
                    <h3>Review your ride</h3>

                    <div className="review-row">
                      <span>📍 Pickup</span>
                      <strong>
                        {pickupPosition[0].toFixed(5)},{' '}
                        {pickupPosition[1].toFixed(5)}
                      </strong>
                    </div>

                    <div className="review-row">
                      <span>🏁 Destination</span>
                      <strong>{selectedDestinationName || destination}</strong>
                    </div>

                    <div className="review-row">
                      <span>🛣️ Road distance</span>
                      <strong>{routeDistanceKm.toFixed(1)} km</strong>
                    </div>

                    <div className="review-row">
                      <span>⏱️ Estimated time</span>
                      <strong>
                        {Math.max(1, Math.round(routeDurationMinutes))} min
                      </strong>
                    </div>

                    <div className="review-fare">
                      <span>Estimated fare</span>
                      <strong>
                        RWF{' '}
                        {Math.round(
                          BASE_FARE_RWF +
                            Math.max(
                              0,
                              routeDistanceKm - INCLUDED_DISTANCE_KM
                            ) *
                              EXTRA_KM_RATE_RWF
                        ).toLocaleString('en-RW')}
                      </strong>
                    </div>

                    {!rideConfirmed && (
                      <div className="customer-details">
                        <div className="field-group">
                          <label htmlFor="customer-name">Your name</label>
                          <input
                            id="customer-name"
                            type="text"
                            autoComplete="name"
                            placeholder="Enter your name"
                            value={customerName}
                            onChange={(event) =>
                              setCustomerName(event.target.value)
                            }
                          />
                        </div>

                        <div className="field-group">
                          <label htmlFor="customer-phone">Phone number</label>
                          <input
                            id="customer-phone"
                            type="tel"
                            autoComplete="tel"
                            placeholder="e.g. 078 123 4567"
                            value={customerPhone}
                            onChange={(event) =>
                              setCustomerPhone(event.target.value)
                            }
                          />
                        </div>

                        <button
                          className="estimate-button"
                          type="button"
                          onClick={handleConfirmRide}
                        >
                          Confirm ride request{' '}
                          <span aria-hidden="true">→</span>
                        </button>
                      </div>
                    )}

                    {bookingMessage && (
                      <p
                        className={
                          rideConfirmed ? 'booking-success' : 'booking-error'
                        }
                        role="status"
                      >
                        {bookingMessage}
                      </p>
                    )}

                    {rideConfirmed && (
                      <button
                        className="confirm-button new-booking-button"
                        type="button"
                        onClick={() => {
                          setRideConfirmed(false);
                          setShowRideReview(false);
                          setCustomerName('');
                          setCustomerPhone('');
                          setBookingMessage('');
                          clearRoute();
                        }}
                      >
                        Start a new booking
                      </button>
                    )}
                  </section>
                )}

                <p className="demo-note">
                  Prototype estimate only. Uses a public routing service
                  and the selected RWF 400 + RWF 130/km fare model.
                  Confirm current official tariffs before launch.
                </p>
              </form>
            </section>
          </section>

          <section className="benefits-section">
            <div>
              <span className="benefit-icon">📍</span>
              <h3>Pickup on your terms</h3>
              <p>Choose a convenient pickup point on the map.</p>
            </div>

            <div>
              <span className="benefit-icon">🏍️</span>
              <h3>Made for moto rides</h3>
              <p>A simple booking experience designed for Kigali.</p>
            </div>

            <div>
              <span className="benefit-icon">⚡</span>
              <h3>Less hassle</h3>
              <p>
                Start your booking without searching the street for a rider.
              </p>
            </div>
          </section>
        </main>

        <footer className="site-footer">
          <a className="brand footer-brand" href="/">
            <span className="brand-mark">U</span>
            <span>
              UBA<span className="brand-accent">moto</span>
            </span>
          </a>

          <p>Getting Kigali moving, one ride at a time.</p>
        </footer>
      </div>
    </>
  );
}

export default App;