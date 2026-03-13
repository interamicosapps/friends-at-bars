// MapKit JS 5 — use version pinned in Apple Developer docs if needed
const MAPKIT_SCRIPT =
  "https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.js";

let loadPromise: Promise<void> | null = null;
/** True after mapkit.init() succeeded once — calling init again logs warnings. */
let mapKitInitialized = false;

/**
 * Loads MapKit JS once and initializes with VITE_MAPKIT_TOKEN.
 * Call before creating mapkit.Map.
 */
export function loadMapKit(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("MapKit JS requires window"));
  }
  if (mapKitInitialized) {
    return Promise.resolve();
  }
  if ((window as unknown as { mapkit?: unknown }).mapkit) {
    return initMapKit();
  }
  if (loadPromise) return loadPromise;

  loadPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector(
      `script[src="${MAPKIT_SCRIPT}"]`
    );
    if (existing) {
      existing.addEventListener("load", () => initMapKit().then(resolve).catch(reject));
      existing.addEventListener("error", () => reject(new Error("MapKit script failed")));
      return;
    }
    const script = document.createElement("script");
    script.src = MAPKIT_SCRIPT;
    script.crossOrigin = "anonymous";
    script.onload = () => initMapKit().then(resolve).catch(reject);
    script.onerror = () => reject(new Error("MapKit script failed to load"));
    document.head.appendChild(script);
  });
  return loadPromise;
}

function initMapKit(): Promise<void> {
  if (mapKitInitialized) {
    return Promise.resolve();
  }
  const token = import.meta.env.VITE_MAPKIT_TOKEN as string | undefined;
  if (!token) {
    return Promise.reject(
      new Error("VITE_MAPKIT_TOKEN is not set")
    );
  }
  return new Promise((resolve, reject) => {
    try {
      mapkit.init({
        authorizationCallback(done) {
          done(token);
        },
      });
      mapKitInitialized = true;
      resolve();
    } catch (e) {
      // MapKit throws if already initialized — treat as success so map still works
      if (
        e instanceof Error &&
        /already initialized/i.test(e.message)
      ) {
        mapKitInitialized = true;
        resolve();
        return;
      }
      reject(e);
    }
  });
}
