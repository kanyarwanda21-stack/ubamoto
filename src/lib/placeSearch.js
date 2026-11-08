export function normalizePlaceQuery(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, 100);
}

export function isValidRwandaCoordinate(lat, lng) {
  return Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -2.9 &&
    lat <= -1 &&
    lng >= 28.8 &&
    lng <= 30.95;
}

export function resultCategory(featureType) {
  if (featureType === 'poi') return 'Business';
  if (featureType === 'address') return 'Address';
  if (featureType === 'street') return 'Street';
  if (featureType === 'neighborhood') return 'Neighbourhood';
  if (featureType === 'locality' || featureType === 'place') return 'Landmark';
  if (featureType === 'district' || featureType === 'region' || featureType === 'country') {
    return 'Administrative area';
  }
  return 'Place';
}

export function rankAndDeduplicatePlaces(items, query) {
  const lowered = normalizePlaceQuery(query).toLowerCase();
  const seen = new Set();
  return (items ?? []).filter((item) => {
    const key = item.mapbox_id ?? `${item.name}|${item.full_address ?? item.place_formatted ?? item.address ?? ''}`;
    if (!item?.name || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((item) => {
    const name = String(item.name ?? '');
    const type = String(item.feature_type ?? 'place');
    const exact = name.toLowerCase() === lowered;
    const starts = name.toLowerCase().startsWith(lowered);
    const priority = { poi: 0, street: 1, address: 1, neighborhood: 2, locality: 2, place: 3 };
    return {
      ...item,
      _score: exact ? -1 : starts ? 0 : (priority[type] ?? 4),
      _distance: Number.isFinite(Number(item.distance)) ? Number(item.distance) : Infinity,
    };
  }).sort((a, b) => a._score - b._score || a._distance - b._distance)
    .map(({ _score, _distance, ...item }) => ({
      id: item.mapbox_id,
      name: item.name,
      details: item.full_address ?? item.place_formatted ?? item.address ?? '',
      address: item.full_address ?? item.place_formatted ?? item.address ?? '',
      type: resultCategory(item.feature_type),
      category: String(item.feature_type ?? ''),
    }));
}

export function isFreshRiderLocation(updatedAt, now = Date.now(), freshnessMs = 2 * 60 * 1000) {
  if (!updatedAt) return false;
  const timestamp = new Date(updatedAt).getTime();
  if (!Number.isFinite(timestamp)) return false;
  const age = now - timestamp;
  return age >= 0 && age <= freshnessMs;
}
