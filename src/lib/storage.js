// localStorage can be blocked (private mode) or full, so every call is guarded.
export function loadJson(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function saveJson(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore: the app still works without persistence
  }
}

export function removeKeys(keys) {
  try {
    keys.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // ignore
  }
}
