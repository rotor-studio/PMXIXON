const GIJON_CENTER = { lat: 43.5322, lon: -5.6611 };
const RADIUS_KM = 6;
const statusEl = document.getElementById("status");
const refreshBtn = document.getElementById("refresh");
const rotateBtn = document.getElementById("toggle-rotate");
const rotateControl = document.getElementById("rotate-control");
const rotateSpeedInput = document.getElementById("rotate-speed");
const terrainBtn = document.getElementById("toggle-terrain");
const labelsBtn = document.getElementById("toggle-labels");
const meshBtn = document.getElementById("toggle-mesh");
const windBtn = document.getElementById("toggle-wind");
const panelsLayer = document.getElementById("panels");
const windCanvas = document.getElementById("wind-canvas");
const windLegend = document.getElementById("wind-legend");
const fullscreenBtn = document.getElementById("toggle-fullscreen");
const fullscreenBtnDesktop = document.getElementById("toggle-fullscreen-desktop");
const mapWrap = document.querySelector(".map-wrap");
const topbar = document.querySelector(".topbar");
const controls = document.querySelector(".controls");
const meteoList = document.getElementById("meteo-list");
const meteoUpdated = document.getElementById("meteo-updated");

let map;
let deckOverlay;
let rotating = false;
let rotationHandle = null;
let rotationSpeed = 0.005;
const openPanels = new Map();
let terrainEnabled = true;
let labelsEnabled = true;
let lastSensors = [];
let lastOfficialStations = [];
let meshEnabled = false;
let meshEdges = [];
let officialError = null;
let windEnabled = false;
let windData = null;
let windRenderHandle = null;
let windRefreshTimer = null;
let windFetchInFlight = null;
let windField = null;
let windParticles = [];
let windParticleFrame = null;
let windParticleLast = 0;
let windAverageSpeed = null;
let windRebuildLast = 0;
const WIND_REBUILD_INTERVAL = 350;
let windIsRotating = false;
let meteoRefreshTimer = null;
let fullscreenActive = false;

function placeControlsForViewport() {
  if (!controls || !topbar || !statusEl) return;
  const isMobile = window.innerWidth <= 720;
  if (isMobile) {
    if (mapWrap && controls.parentElement !== mapWrap.parentElement) {
      mapWrap.insertAdjacentElement("afterend", controls);
    }
  } else if (controls.parentElement !== topbar) {
    topbar.appendChild(controls);
  }
}

function attachWindCanvas() {
  if (!windCanvas || !map) return;
  const container = map.getCanvasContainer();
  if (container && windCanvas.parentElement !== container) {
    container.appendChild(windCanvas);
  }
  windCanvas.style.position = "absolute";
  windCanvas.style.top = "0";
  windCanvas.style.left = "0";
  windCanvas.style.width = "100%";
  windCanvas.style.height = "100%";
  windCanvas.style.pointerEvents = "none";
  windCanvas.style.zIndex = "2";
}

const HISTORY_KEY = "pmxixon-history-v1";
const ADDRESS_KEY = "pmxixon-address-v1";
const OFFICIAL_STATIONS_KEY = "pmxixon-official-stations-v1";
const HISTORY_WINDOW_MS = 24 * 60 * 60 * 1000;
const AUTO_REFRESH_MS = 60 * 1000;
const ASTURAIRE_BASE = "https://calidaddelairews.asturias.es/RestCecoma";
const ASTURAIRE_PROXIES = ["./asturaire-proxy.php", "/asturaire"];
const ASTURAIRE_USER = "manten";
const ASTURAIRE_PASS = "MANTEN";
const MAPBOX_TOKEN =
  "pk.eyJ1Ijoicm90b3JzdHVkaW8iLCJhIjoiY2t5bTN2OXlvMDU0azJvcDh2OTB2aTNrbiJ9.Y_Bk3E1auflVo9J8t9LZZg";
const COMMUNITY_GRAFANA_BASE =
  "https://api-rrd.madavi.de:3000/grafana/d-solo/GUaL5aZMA/pm-sensors-by-map-id?orgId=1&timezone=browser&var-type=sds011&var-query0=feinstaub&__feature.dashboardSceneSolo=true";
const COMMUNITY_RANGES = [
  { label: "24h", value: "24h" },
  { label: "7d", value: "7d" },
  { label: "28d", value: "28d" },
];
const COMMUNITY_RANGE_PANELS = {
  "24h": "panel-3",
  "7d": "panel-5",
  "28d": "panel-7",
};
const TEXT_CHARSET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzÁÉÍÓÚÜÑáéíóúüñÇç0123456789 .,:;/\\-()°%|\\n";

const SERIES = [
  { key: "pm10", label: "PM10", color: "#ff5a3d", axis: "left" },
  { key: "pm25", label: "PM2.5", color: "#ffb703", axis: "left" },
  { key: "no2", label: "NO2", color: "#7c4dff", axis: "left" },
  { key: "no", label: "NO", color: "#9b8cff", axis: "left" },
  { key: "humidity", label: "Humedad", color: "#3fb5a3", axis: "right" },
  { key: "temperature", label: "Temp", color: "#1f6feb", axis: "right" },
  { key: "pressure", label: "Presion", color: "#334155", axis: "right" },
];

const addressCache = loadAddressCache();

async function preloadOfficialHistory() {
  try {
    const response = await fetch("data/official_history.json", { cache: "no-store" });
    if (!response.ok) return;
    const serverHistory = await response.json();
    if (!serverHistory || typeof serverHistory !== "object") return;
    const history = loadHistory();
    const now = Date.now();
    Object.entries(serverHistory).forEach(([sensorId, payload]) => {
      const incoming = payload?.data;
      if (!Array.isArray(incoming) || incoming.length === 0) return;
      if (!history[sensorId]) {
        history[sensorId] = { data: [] };
      }
      const combined = [...history[sensorId].data, ...incoming];
      const byTime = new Map();
      combined.forEach((entry) => {
        if (!entry || !entry.t) return;
        byTime.set(entry.t, entry);
      });
      const merged = Array.from(byTime.values()).sort((a, b) => a.t - b.t);
      history[sensorId].data = merged.filter(
        (entry) => now - entry.t <= HISTORY_WINDOW_MS
      );
    });
    saveHistory(history);
  } catch (error) {
    return;
  }
}

function formatValue(value, unit) {
  if (value === null || value === undefined) return "-";
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return `${number.toFixed(1)}${unit}`;
}

function valueFrom(values, key) {
  const match = values.find((entry) => entry.value_type === key);
  if (!match) return null;
  const number = Number(match.value);
  return Number.isFinite(number) ? number : null;
}

function parseTimestamp(timestamp) {
  if (!timestamp) return null;
  let iso = timestamp.includes("T")
    ? timestamp
    : timestamp.replace(" ", "T") + "Z";
  iso = iso.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : null;
}

function sha256HexFallback(message) {
  function rightRotate(value, amount) {
    return (value >>> amount) | (value << (32 - amount));
  }

  const msg = unescape(encodeURIComponent(message));
  const words = [];
  for (let i = 0; i < msg.length; i += 1) {
    words[i >> 2] |= msg.charCodeAt(i) << (24 - (i % 4) * 8);
  }
  words[msg.length >> 2] |= 0x80 << (24 - (msg.length % 4) * 8);
  words[((msg.length + 8) >> 6) * 16 + 15] = msg.length * 8;

  const w = new Array(64);
  const k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
    0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
    0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
    0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
    0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
    0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  for (let i = 0; i < words.length; i += 16) {
    for (let t = 0; t < 64; t += 1) {
      if (t < 16) {
        w[t] = words[i + t] | 0;
      } else {
        const s0 =
          rightRotate(w[t - 15], 7) ^
          rightRotate(w[t - 15], 18) ^
          (w[t - 15] >>> 3);
        const s1 =
          rightRotate(w[t - 2], 17) ^
          rightRotate(w[t - 2], 19) ^
          (w[t - 2] >>> 10);
        w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
      }
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let t = 0; t < 64; t += 1) {
      const s1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + k[t] + w[t]) | 0;
      const s0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) | 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }

    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
    h5 = (h5 + f) | 0;
    h6 = (h6 + g) | 0;
    h7 = (h7 + h) | 0;
  }

  const hash = [h0, h1, h2, h3, h4, h5, h6, h7];
  return hash
    .map((value) => (value >>> 0).toString(16).padStart(8, "0"))
    .join("");
}

async function sha256Hex(message) {
  if (globalThis.crypto?.subtle?.digest) {
    const data = new TextEncoder().encode(message);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }
  return sha256HexFallback(message);
}

async function asturAireHeaders() {
  const timestamp = Date.now().toString();
  const first = await sha256Hex(ASTURAIRE_USER + ASTURAIRE_PASS);
  const signature = await sha256Hex(first + timestamp);
  return { signature, timestamp };
}

function buildAsturAireUrl(base, path, params, options = {}) {
  const url = new URL(base, window.location.href);
  if (path) {
    url.pathname = url.pathname.replace(/\/$/, "") + path;
  }
  if (params) {
    url.search = new URLSearchParams(params).toString();
  }
  if (options.cacheBust !== false) {
    url.searchParams.set("_", Date.now().toString());
  }
  return url;
}

async function fetchAsturAire(path, params = null, options = {}) {
  const headers = await asturAireHeaders();
  const directUrl = buildAsturAireUrl(ASTURAIRE_BASE, path, params, options);
  try {
    const response = await fetch(directUrl, {
      headers,
      mode: "cors",
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error("No se pudo cargar datos de AsturAire");
    }
    return response.json();
  } catch (error) {
    const proxyParams = { ...(params || {}), path };
    let lastError = null;
    for (const proxyBase of ASTURAIRE_PROXIES) {
      const proxyUrl = buildAsturAireUrl(proxyBase, "", proxyParams, options);
      try {
        const response = await fetch(proxyUrl, { cache: "no-store" });
        if (!response.ok) {
          throw new Error("No se pudo cargar datos de AsturAire (proxy)");
        }
        return response.json();
      } catch (proxyError) {
        lastError = proxyError;
      }
    }
    const needsServer = window.location.protocol === "file:";
    const message = needsServer
      ? "AsturAire bloquea CORS. Abre el proyecto con servidor local (python server.py) o php -S."
      : "No se pudo cargar datos de AsturAire (proxy).";
    throw new Error(message);
  }
}

function parseDMS(value) {
  if (!value) return null;
  const parts = value.trim().split(/[^\d\w]+/).filter(Boolean);
  if (parts.length < 4) return null;
  const degrees = Number(parts[0]);
  const minutes = Number(parts[1]);
  const seconds = Number(parts[2]);
  const direction = parts[3];
  if (![degrees, minutes, seconds].every(Number.isFinite)) return null;
  let decimal = degrees + minutes / 60 + seconds / 3600;
  if (direction === "S" || direction === "W") decimal *= -1;
  return decimal;
}

function normalizeName(value) {
  return (value || "")
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function formatDateDDMMYYYY(date) {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}-${month}-${year}`;
}

function formatDateYYYYMMDD(date) {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${year}-${month}-${day}`;
}

function parseCecomaDate(value) {
  if (!value) return new Date();
  const iso = value.replace(" ", "T");
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function calcTargetPeriod(displayDate) {
  if (!displayDate || Number.isNaN(displayDate.getTime())) return null;
  const offsetHours = new Date().getTimezoneOffset() / 60;
  const raw = displayDate.getHours() + offsetHours;
  const period = Math.round(raw);
  if (!Number.isFinite(period)) return null;
  return Math.min(24, Math.max(1, period));
}

function buildDateRanges(stationInfo) {
  const now = new Date();
  const primaryTo = formatDateDDMMYYYY(now);
  const primaryFrom = formatDateDDMMYYYY(
    new Date(now.getTime() - 24 * 60 * 60 * 1000)
  );

  const baseDate = parseCecomaDate(stationInfo.tmpFEs);
  const fallbackTo = formatDateDDMMYYYY(baseDate);
  const fallbackFrom = formatDateDDMMYYYY(
    new Date(baseDate.getTime() - 24 * 60 * 60 * 1000)
  );

  return [
    { from: primaryFrom, to: primaryTo },
    { from: fallbackFrom, to: fallbackTo },
  ];
}

function toLabel(sensor) {
  const pmParts = [];
  if (sensor.pm10 !== null) pmParts.push(`PM10 ${formatValue(sensor.pm10, "")}`);
  if (sensor.pm25 !== null) pmParts.push(`PM2.5 ${formatValue(sensor.pm25, "")}`);
  if (sensor.source === "official") {
    if (sensor.no2 !== null) pmParts.push(`NO2 ${formatValue(sensor.no2, "")}`);
    if (sensor.no !== null) pmParts.push(`NO ${formatValue(sensor.no, "")}`);
  }

  const meteoParts = [];
  if (sensor.humidity !== null)
    meteoParts.push(`H ${formatValue(sensor.humidity, "%")}`);
  if (sensor.pressure !== null)
    meteoParts.push(`P ${formatValue(sensor.pressure, "hPa")}`);
  if (sensor.temperature !== null)
    meteoParts.push(`T ${formatValue(sensor.temperature, "°C")}`);

  const lines = [];
  if (pmParts.length) lines.push(pmParts.join(" | "));
  if (meteoParts.length) lines.push(meteoParts.join(" | "));
  return lines.length ? lines.join("\n") : "Sin datos";
}

function toStationLabel(sensor) {
  const name = sensor.name ? `Estacion ${sensor.name}` : "Estacion oficial";
  const metrics = toLabel(sensor);
  return metrics === "Sin datos" ? name : `${name}\n${metrics}`;
}

function toCommunityLabel(sensor) {
  const address = addressCache[sensor.id] || sensor.address;
  let title = "Sensor (-)";
  if (address) {
    const cleaned = address
      .replace(/\bGij[oó]n\b/gi, "")
      .replace(/\bGij\s*n\b/gi, "")
      .replace(/,\s*,/g, ",")
      .replace(/\s{2,}/g, " ")
      .replace(/\s+,/g, ",")
      .replace(/,\s+$/g, "")
      .trim();
    const parts = cleaned
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    const street = (parts[0] || "-").replace(/^(C\/|C\.|Calle)\s+/i, "");
    const barrio = parts[1] || "";
    title = barrio ? `Sensor ${street}, ${barrio}` : `Sensor ${street}`;
  }
  const metrics = toLabel(sensor);
  return metrics === "Sin datos" ? title : `${title}\n${metrics}`;
}

function colorFor(sensor) {
  const value = sensor.pm10 ?? sensor.pm25 ?? 0;
  const t = Math.max(0, Math.min(value / 100, 1));
  if (t < 0.5) {
    const mix = t / 0.5;
    return [Math.round(63 + (255 - 63) * mix), Math.round(181 + (183 - 181) * mix), Math.round(163 + (3 - 163) * mix)];
  }
  const mix = (t - 0.5) / 0.5;
  return [255, Math.round(183 + (90 - 183) * mix), Math.round(3 + (61 - 3) * mix)];
}

function idSeed(id) {
  if (Number.isFinite(Number(id))) return Number(id);
  const str = String(id);
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function elevationFor(sensor) {
  const base = Math.max(sensor.pm10 || 0, sensor.pm25 || 0, 5);
  const jitter = (idSeed(sensor.id) * 37) % 120;
  return (280 + base * 45 + jitter) * 2;
}

async function loadSensors() {
  const url = `https://data.sensor.community/airrohr/v1/filter/area=${GIJON_CENTER.lat},${GIJON_CENTER.lon},${RADIUS_KM}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("No se pudo cargar la API");
  }

  const data = await response.json();

  const sensorsByLocation = new Map();

  data.forEach((entry) => {
    const values = entry.sensordatavalues || [];
    const location = entry.location || {};
    const lon = Number(location.longitude);
    const lat = Number(location.latitude);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;

    const locationId = location.id || `${lat.toFixed(5)}:${lon.toFixed(5)}`;
    if (!sensorsByLocation.has(locationId)) {
      sensorsByLocation.set(locationId, {
        id: locationId,
        source: "community",
        nodeId: null,
        lon,
        lat,
        pm10: null,
        pm25: null,
        humidity: null,
        pressure: null,
        temperature: null,
        timestamp: null,
      });
    }

    const sensor = sensorsByLocation.get(locationId);
    const time = parseTimestamp(entry.timestamp);
    if (time) sensor.timestamp = Math.max(sensor.timestamp || 0, time);

    const pm10 = valueFrom(values, "P1");
    const pm25 = valueFrom(values, "P2");
    sensor.pm10 ??= pm10;
    sensor.pm25 ??= pm25;
    if ((pm10 !== null || pm25 !== null) && !sensor.nodeId) {
      sensor.nodeId = entry.sensor?.id || null;
    }
    sensor.humidity ??= valueFrom(values, "humidity");
    sensor.temperature ??= valueFrom(values, "temperature");

    const pressureSea = valueFrom(values, "pressure_at_sealevel");
    const pressureRaw = valueFrom(values, "pressure");
    const pressureValue = pressureSea ?? pressureRaw;
    if (sensor.pressure === null && pressureValue !== null) {
      sensor.pressure = pressureValue >= 2000 ? pressureValue / 100 : pressureValue;
    }
  });

  const sensors = Array.from(sensorsByLocation.values());

  return sensors;
}

async function loadOfficialStations() {
  try {
    const stations = await fetchAsturAire("/getEstacion");
    saveOfficialStationsCache(stations);
    return await hydrateAsturAireStations(stations);
  } catch (error) {
    const cached = loadOfficialStationsCache();
    if (cached.length) {
      return await hydrateAsturAireStations(cached);
    }
    throw error;
  }
}

async function hydrateAsturAireStations(stations) {
  const gijonStations = stations.filter((station) =>
    normalizeName(station.poblacEs).includes("gijon")
  );

  const hydrated = await Promise.all(
    gijonStations.map(async (station) => {
      let stationInfo = station;
      try {
        const stationDetails = await fetchAsturAire("/getEstacion", {
          ides: station.uuid || station.ides,
        });
        if (Array.isArray(stationDetails) && stationDetails.length) {
          stationInfo = stationDetails[0];
        }
      } catch (error) {
        stationInfo = station;
      }

      const dateRanges = buildDateRanges(stationInfo);
      const stationDisplayDate = parseCecomaDate(stationInfo.tmpFEs);
      const stationDisplayTimestamp = Number.isNaN(stationDisplayDate.getTime())
        ? null
        : stationDisplayDate.getTime();
      const targetPeriod = calcTargetPeriod(stationDisplayDate);
      let pollutants = {};
      try {
        const ids = [
          stationInfo.uuid || null,
          stationInfo.ides || null,
        ].filter(Boolean);
        for (const uuid of ids) {
          for (const range of dateRanges) {
            for (const validado of ["T", "F"]) {
              const response = await fetchAsturAire(
                "/getDato",
                {
                  uuidEs: uuid,
                  histo: "60m",
                  validado,
                  fechaiF: range.from,
                  fechafF: range.to,
                },
                { cacheBust: true }
              );
              if (Array.isArray(response) && response.length) {
                const displayDateKey = formatDateYYYYMMDD(stationDisplayDate);
                pollutants = parseAsturAirePollutants(response, {
                  displayDateKey,
                  targetPeriod,
                });
                if (pollutants.timestamp) {
                  break;
                }
              }
            }
            if (pollutants.timestamp) break;
          }
          if (pollutants.timestamp) break;
        }
      } catch (error) {
        pollutants = {};
      }

      return {
        id: `official-${stationInfo.ides}`,
        source: "official",
        name: stationInfo.nombreEs?.trim(),
        address: stationInfo.direcEs?.trim(),
        lon: parseDMS(stationInfo.lonEs),
        lat: parseDMS(stationInfo.latEs),
        pm10: pollutants.pm10 ?? null,
        pm25: pollutants.pm25 ?? null,
        no2: pollutants.no2 ?? null,
        no: pollutants.no ?? null,
        humidity: pollutants.humidity ?? null,
        pressure: pollutants.pressure ?? null,
        temperature: pollutants.temperature ?? null,
        timestamp: pollutants.timestamp || Date.now(),
        displayTimestamp:
          stationDisplayTimestamp ||
          pollutants.displayTimestamp ||
          pollutants.timestamp ||
          null,
      };
    })
  );

  return hydrated.filter(
    (sensor) => Number.isFinite(sensor.lon) && Number.isFinite(sensor.lat)
  );
}

function parseAsturAirePollutants(items, options = {}) {
  if (!Array.isArray(items)) return {};
  const displayDateKey = options.displayDateKey || null;
  const targetPeriod =
    Number.isFinite(options.targetPeriod) ? options.targetPeriod : null;
  const displayCana = new Set([10, 9, 8, 83, 86, 87]);
  let displayPeriod = null;
  const latest = {};
  const latestByName = {};
  const targetByCana = {};
  const targetByName = {};

  const itemTime = (item) => {
    const period = Number(item.periodo);
    if (item.fechaF) {
      const baseDate = parseCecomaDate(item.fechaF);
      const baseTime = baseDate.getTime();
      if (Number.isFinite(baseTime) && Number.isFinite(period)) {
        return baseTime + Math.max(0, period - 1) * 60 * 60 * 1000;
      }
      return baseTime;
    }
    if (Number.isFinite(Number(item.fecha))) {
      const base = Number(item.fecha);
      if (Number.isFinite(period)) {
        return base + Math.max(0, period - 1) * 60 * 60 * 1000;
      }
      return base;
    }
    return null;
  };

  const itemDate = (item) => {
    const time = itemTime(item);
    return Number.isFinite(time) ? new Date(time) : parseCecomaDate(item.fechaF);
  };

  const itemStamp = (item) => itemTime(item) || 0;

  items.forEach((item) => {
    const key = item.cana;
    const date = itemDate(item);
    const stamp = itemStamp(item);
    const dateKey = formatDateYYYYMMDD(date);
    if (!latest[key] || stamp > latest[key].stamp) {
      latest[key] = { date, stamp, item };
    }
    const name = (item.nombre || "").toString().trim().toUpperCase();
    if (name) {
      if (!latestByName[name] || stamp > latestByName[name].stamp) {
        latestByName[name] = { date, stamp, item };
      }
    }
    if (
      displayDateKey &&
      targetPeriod !== null &&
      dateKey === displayDateKey &&
      Number(item.periodo) === targetPeriod
    ) {
      targetByCana[item.cana] = item;
      if (name) targetByName[name] = item;
    }
    if (displayDateKey && displayCana.has(item.cana)) {
      const period = Number(item.periodo);
      if (dateKey === displayDateKey && Number.isFinite(period)) {
        if (displayPeriod === null || period > displayPeriod) {
          displayPeriod = period;
        }
      }
    }
  });

  const getValue = (cana) => {
    const record = targetByCana[cana] || latest[cana]?.item;
    if (!record) return null;
    const value = Number(record.val);
    return Number.isFinite(value) ? value : null;
  };

  const getValueByName = (name) => {
    const record = targetByName[name] || latestByName[name]?.item;
    if (!record) return null;
    const value = Number(record.val);
    return Number.isFinite(value) ? value : null;
  };

  const maxDate = Object.values(latest).reduce((acc, entry) => {
    if (!acc || entry.stamp > acc.stamp) return entry;
    return acc;
  }, null);

  let displayTimestamp = null;
  const periodForDisplay =
    targetPeriod !== null ? targetPeriod : displayPeriod;
  if (displayDateKey && periodForDisplay !== null) {
    const baseDate = new Date(`${displayDateKey}T00:00:00`);
    const offsetHours = new Date().getTimezoneOffset() / 60;
    const adjusted = periodForDisplay - offsetHours;
    displayTimestamp = baseDate.getTime() + adjusted * 60 * 60 * 1000;
  }

  return {
    pm10: getValue(10),
    pm25: getValue(9),
    no2: getValue(8) ?? getValueByName("NO2"),
    no: getValueByName("NO"),
    temperature: getValue(83),
    humidity: getValue(86),
    pressure: getValue(87),
    timestamp: maxDate ? maxDate.date.getTime() : null,
    displayTimestamp,
  };
}

function resizeWindCanvas() {
  if (!windCanvas || !map) return;
  const rect = map.getContainer().getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  windCanvas.width = Math.max(1, Math.floor(rect.width * ratio));
  windCanvas.height = Math.max(1, Math.floor(rect.height * ratio));
  windCanvas.style.width = `${rect.width}px`;
  windCanvas.style.height = `${rect.height}px`;
}

async function fetchWindData() {
  if (windFetchInFlight) return windFetchInFlight;
  windFetchInFlight = (async () => {
    const response = await fetch(
      "https://maps.sensor.community/data/v1/wind.json",
      { cache: "no-store" }
    );
    if (!response.ok) {
      throw new Error("No se pudo cargar la capa de viento.");
    }
    const data = await response.json();
    const u = data.find((item) => item?.header?.parameterNumber === 2);
    const v = data.find((item) => item?.header?.parameterNumber === 3);
    if (!u || !v) {
      throw new Error("Datos de viento incompletos.");
    }
    windData = {
      u: u.data,
      v: v.data,
      header: u.header,
    };
    windAverageSpeed = null;
    return windData;
  })();

  try {
    return await windFetchInFlight;
  } finally {
    windFetchInFlight = null;
  }
}

function windVectorAt(lon, lat) {
  if (!windData) return null;
  const header = windData.header;
  const nx = header.nx;
  const ny = header.ny;
  const dx = header.dx;
  const dy = header.dy;
  const lo1 = header.lo1;
  const la1 = header.la1;

  const lonWrapped = ((lon % 360) + 360) % 360;
  const i = (lonWrapped - lo1) / dx;
  const j = (la1 - lat) / dy;
  if (j < 0 || j > ny - 1) return null;

  const i0 = Math.floor(i);
  const j0 = Math.floor(j);
  const i1 = (i0 + 1) % nx;
  const j1 = j0 + 1;
  if (j0 < 0 || j1 >= ny) return null;

  const fi = i - i0;
  const fj = j - j0;
  const idx00 = j0 * nx + ((i0 + nx) % nx);
  const idx10 = j0 * nx + i1;
  const idx01 = j1 * nx + ((i0 + nx) % nx);
  const idx11 = j1 * nx + i1;

  const u00 = windData.u[idx00];
  const u10 = windData.u[idx10];
  const u01 = windData.u[idx01];
  const u11 = windData.u[idx11];
  const v00 = windData.v[idx00];
  const v10 = windData.v[idx10];
  const v01 = windData.v[idx01];
  const v11 = windData.v[idx11];
  if (![u00, u10, u01, u11, v00, v10, v01, v11].every(Number.isFinite)) {
    return null;
  }

  const u0 = u00 + (u10 - u00) * fi;
  const u1 = u01 + (u11 - u01) * fi;
  const v0 = v00 + (v10 - v00) * fi;
  const v1 = v01 + (v11 - v01) * fi;
  const u = u0 + (u1 - u0) * fj;
  const v = v0 + (v1 - v0) * fj;
  return { u, v };
}

function renderWind() {
  buildWindField();
  startWindParticles();
}

function scheduleWindRender() {
  if (!windEnabled) return;
  if (windRenderHandle) return;
  windRenderHandle = requestAnimationFrame(() => {
    windRenderHandle = null;
    renderWind();
  });
}

function scheduleWindRebuild() {
  if (!windEnabled) return;
  const now = performance.now();
  if (now - windRebuildLast < WIND_REBUILD_INTERVAL) return;
  windRebuildLast = now;
  scheduleWindRender();
}

function clearWind() {
  if (!windCanvas) return;
  const ctx = windCanvas.getContext("2d");
  ctx.clearRect(0, 0, windCanvas.width, windCanvas.height);
}

function updateWindLegend() {
  if (!windLegend) return;
  if (!windEnabled) {
    windLegend.style.display = "none";
    return;
  }
  const avg = Number.isFinite(windAverageSpeed) ? windAverageSpeed : null;
  const label = avg !== null ? `${avg} m/s` : "…";
  windLegend.textContent = `Viento medio: ${label}`;
  windLegend.style.display = "block";
}

function iconForWeather(code) {
  if (code === 0) return "☀️";
  if (code === 1 || code === 2) return "🌤️";
  if (code === 3) return "☁️";
  if (code === 45 || code === 48) return "🌫️";
  if (code >= 51 && code <= 67) return "🌧️";
  if (code >= 71 && code <= 77) return "❄️";
  if (code >= 80 && code <= 82) return "🌦️";
  if (code >= 95) return "⛈️";
  return "🌡️";
}

function formatDayLabel(dateStr) {
  const date = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateStr;
  return new Intl.DateTimeFormat("es-ES", {
    weekday: "short",
    day: "numeric",
  })
    .format(date)
    .replace(".", "");
}

async function loadMeteoForecast() {
  if (!meteoList) return;
  try {
    const url =
      "https://api.open-meteo.com/v1/forecast?latitude=43.5322&longitude=-5.6611&daily=weathercode,temperature_2m_max,temperature_2m_min,uv_index_max&timezone=Europe%2FMadrid";
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error("No se pudo cargar la previsión.");
    }
    const data = await response.json();
    const daily = data.daily || {};
    const dates = daily.time || [];
    const codes = daily.weathercode || [];
    const tMax = daily.temperature_2m_max || [];
    const tMin = daily.temperature_2m_min || [];
    const uvMax = daily.uv_index_max || [];

    meteoList.innerHTML = "";
    dates.slice(0, 5).forEach((dateStr, index) => {
      const card = document.createElement("div");
      card.className = "meteo-card";
      const day = document.createElement("div");
      day.className = "meteo-day";
      day.textContent = formatDayLabel(dateStr);
      const icon = document.createElement("div");
      icon.className = "meteo-icon";
      icon.textContent = iconForWeather(Number(codes[index]));
      const temp = document.createElement("div");
      temp.className = "meteo-temp";
      const max = Number(tMax[index]);
      const min = Number(tMin[index]);
      const uv = Number(uvMax[index]);
      const uvLabel = Number.isFinite(uv) ? ` · UV ${uv.toFixed(0)}` : "";
      temp.textContent =
        Number.isFinite(max) && Number.isFinite(min)
          ? `${min.toFixed(0)}° / ${max.toFixed(0)}°${uvLabel}`
          : "-";
      card.appendChild(day);
      card.appendChild(icon);
      card.appendChild(temp);
      meteoList.appendChild(card);
    });
    if (meteoUpdated) {
      const now = new Date();
      const label = `${String(now.getHours()).padStart(2, "0")}:${String(
        now.getMinutes()
      ).padStart(2, "0")}`;
      meteoUpdated.textContent = `Actualizado ${label}`;
    }
  } catch (error) {
    if (meteoUpdated) meteoUpdated.textContent = "No disponible";
  }
}

function buildWindField() {
  if (!windEnabled || !windCanvas || !map || !windData) return;
  resizeWindCanvas();
  const rect = windCanvas.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;
  const zoom = map.getZoom();
  const step = Math.max(28, Math.round(140 / Math.max(zoom, 1)));
  const cols = Math.ceil(width / step);
  const rows = Math.ceil(height / step);
  const zoomFactor = Math.pow(2, (zoom - 12) * 0.15);
  const timeScale = 600 / Math.max(0.6, zoomFactor);
  const vectors = new Array(rows * cols);
  let speedSum = 0;
  let speedCount = 0;

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const px = x * step;
      const py = y * step;
      const lngLat = map.unproject({ x: px, y: py });
      const wind = windVectorAt(lngLat.lng, lngLat.lat);
      if (!wind) {
        vectors[y * cols + x] = null;
        continue;
      }
      const speed = Math.hypot(wind.u, wind.v);
      if (Number.isFinite(speed)) {
        speedSum += speed;
        speedCount += 1;
      }
      const metersPerDegLat = 111320;
      const metersPerDegLon =
        metersPerDegLat * Math.cos((lngLat.lat * Math.PI) / 180);
      if (!Number.isFinite(metersPerDegLon) || metersPerDegLon === 0) {
        vectors[y * cols + x] = null;
        continue;
      }
      const deltaLon = (wind.u * timeScale) / metersPerDegLon;
      const deltaLat = (wind.v * timeScale) / metersPerDegLat;
      const targetLng = lngLat.lng + deltaLon;
      const targetLat = lngLat.lat + deltaLat;
      const end = map.project({ lng: targetLng, lat: targetLat });
      const dx = end.x - px;
      const dy = end.y - py;
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
        vectors[y * cols + x] = null;
        continue;
      }
      vectors[y * cols + x] = { dx, dy };
    }
  }

  windField = { cols, rows, step, width, height, vectors };
  windAverageSpeed =
    speedCount > 0 ? Math.round((speedSum / speedCount) * 10) / 10 : null;
  updateWindLegend();
}

function windVectorAtScreen(x, y) {
  if (!windField) return null;
  const { cols, rows, step, vectors } = windField;
  const gx = x / step;
  const gy = y / step;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  if (x0 < 0 || y0 < 0 || x1 >= cols || y1 >= rows) return null;
  const fX = gx - x0;
  const fY = gy - y0;
  const v00 = vectors[y0 * cols + x0];
  const v10 = vectors[y0 * cols + x1];
  const v01 = vectors[y1 * cols + x0];
  const v11 = vectors[y1 * cols + x1];
  if (!v00 || !v10 || !v01 || !v11) return null;

  const dx0 = v00.dx + (v10.dx - v00.dx) * fX;
  const dx1 = v01.dx + (v11.dx - v01.dx) * fX;
  const dy0 = v00.dy + (v10.dy - v00.dy) * fX;
  const dy1 = v01.dy + (v11.dy - v01.dy) * fX;
  return {
    dx: dx0 + (dx1 - dx0) * fY,
    dy: dy0 + (dy1 - dy0) * fY,
  };
}

function seedWindParticles() {
  if (!windField) return;
  windParticles = [];
  const { width, height, step } = windField;
  const count = Math.min(600, Math.floor((width * height) / (step * step) * 0.9));
  for (let i = 0; i < count; i += 1) {
    windParticles.push({
      x: Math.random() * width,
      y: Math.random() * height,
      age: Math.random() * 60,
    });
  }
}

function startWindParticles() {
  if (!windEnabled || !windCanvas || !windField) return;
  if (!windParticles.length) seedWindParticles();
  if (windParticleFrame) return;
  windParticleLast = performance.now();
  windParticleFrame = requestAnimationFrame(animateWindParticles);
}

function stopWindParticles() {
  if (windParticleFrame) cancelAnimationFrame(windParticleFrame);
  windParticleFrame = null;
}

function animateWindParticles(now) {
  if (!windEnabled || !windCanvas || !windField) {
    stopWindParticles();
    return;
  }
  const ctx = windCanvas.getContext("2d");
  const ratio = window.devicePixelRatio || 1;
  const rect = windCanvas.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;
  const dt = Math.min(32, now - windParticleLast);
  windParticleLast = now;

  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.globalCompositeOperation = "destination-in";
  ctx.fillStyle = "rgba(0, 0, 0, 0.92)";
  ctx.fillRect(0, 0, width, height);
  ctx.globalCompositeOperation = "source-over";
  ctx.strokeStyle = "rgba(16, 32, 39, 0.45)";
  ctx.lineWidth = 1;

  const zoomFactor = Math.pow(2, (map.getZoom() - 12) * 0.15);
  const speedScale = ((dt / 16) * 0.35) / Math.max(0.6, zoomFactor);
  for (const p of windParticles) {
    if (p.age > 80) {
      p.x = Math.random() * width;
      p.y = Math.random() * height;
      p.age = 0;
      continue;
    }
    const v = windVectorAtScreen(p.x, p.y);
    if (!v) {
      p.age = 81;
      continue;
    }
    const nextX = p.x + v.dx * 0.06 * speedScale;
    const nextY = p.y + v.dy * 0.06 * speedScale;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(nextX, nextY);
    ctx.stroke();
    p.x = nextX;
    p.y = nextY;
    p.age += 1;
    if (p.x < 0 || p.y < 0 || p.x > width || p.y > height) {
      p.age = 81;
    }
  }

  windParticleFrame = requestAnimationFrame(animateWindParticles);
}

async function setWindEnabled(enabled) {
  windEnabled = enabled;
  windBtn.textContent = windEnabled ? "Viento: ON" : "Viento: OFF";
  windCanvas.style.display = windEnabled ? "block" : "none";
  updateWindLegend();
  if (!windEnabled) {
    clearWind();
    stopWindParticles();
    if (windRefreshTimer) {
      clearInterval(windRefreshTimer);
      windRefreshTimer = null;
    }
    return;
  }
  try {
    await fetchWindData();
    renderWind();
    if (!windRefreshTimer) {
      windRefreshTimer = setInterval(async () => {
        try {
          await fetchWindData();
          scheduleWindRender();
        } catch (error) {
          return;
        }
      }, 10 * 60 * 1000);
    }
  } catch (error) {
    windEnabled = false;
    windBtn.textContent = "Viento: OFF";
    windCanvas.style.display = "none";
    console.error(error);
  }
}

function buildLayers(sensors, officialStations, showLabels, edges) {
  return [
    ...(edges.length
      ? [
          new deck.LineLayer({
            id: "mesh-lines",
            data: edges,
            getSourcePosition: (d) => d.source,
            getTargetPosition: (d) => d.target,
            getColor: (d) => d.color,
            getWidth: 2,
            widthUnits: "pixels",
            pickable: false,
          }),
        ]
      : []),
    new deck.ScatterplotLayer({
      id: "sensor-points",
      data: sensors,
      getPosition: (d) => [d.lon, d.lat],
      getFillColor: (d) => colorFor(d),
      getRadius: 30,
      radiusUnits: "meters",
      pickable: true,
    }),
    new deck.ScatterplotLayer({
      id: "official-points",
      data: officialStations,
      getPosition: (d) => [d.lon, d.lat],
      getFillColor: (d) => colorFor(d),
      getRadius: 55,
      radiusUnits: "meters",
      stroked: true,
      getLineColor: [16, 32, 39],
      lineWidthUnits: "pixels",
      getLineWidth: 2,
      pickable: true,
    }),
    new deck.LineLayer({
      id: "sensor-poles",
      data: sensors,
      getSourcePosition: (d) => [d.lon, d.lat, 0],
      getTargetPosition: (d) => [d.lon, d.lat, elevationFor(d)],
      getColor: (d) => colorFor(d),
      getWidth: 3,
      widthUnits: "pixels",
    }),
    new deck.LineLayer({
      id: "official-poles",
      data: officialStations,
      getSourcePosition: (d) => [d.lon, d.lat, 0],
      getTargetPosition: (d) => [d.lon, d.lat, elevationFor(d) * 0.5],
      getColor: (d) => colorFor(d),
      getWidth: 5,
      widthUnits: "pixels",
    }),
    ...(showLabels
      ? [
          new deck.TextLayer({
            id: "sensor-labels",
            data: sensors,
            getPosition: (d) => [d.lon, d.lat, elevationFor(d) + 40],
            getText: (d) => toCommunityLabel(d),
            getSize: 14,
            sizeUnits: "pixels",
            getColor: [16, 32, 39],
            getBackgroundColor: [255, 255, 255, 180],
            background: true,
            backgroundPadding: [8, 6],
            fontFamily: "Roboto Mono, monospace",
            characterSet: TEXT_CHARSET,
            getTextAnchor: "start",
            getAlignmentBaseline: "center",
            getPixelOffset: [12, 0],
            billboard: true,
            pickable: true,
          }),
          new deck.TextLayer({
            id: "official-labels",
            data: officialStations,
            getPosition: (d) => [d.lon, d.lat, elevationFor(d) * 0.5 + 50],
            getText: (d) => toStationLabel(d),
            getSize: 15,
            sizeUnits: "pixels",
            getColor: [16, 32, 39],
            getBackgroundColor: [255, 255, 255, 180],
            background: true,
            backgroundPadding: [8, 6],
            fontFamily: "Roboto Mono, monospace",
            characterSet: TEXT_CHARSET,
            getTextAnchor: "start",
            getAlignmentBaseline: "center",
            getPixelOffset: [12, 0],
            billboard: true,
            pickable: true,
          }),
        ]
      : []),
  ];
}

function initMap() {
  map = new maplibregl.Map({
    container: "map",
    style: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
    center: [GIJON_CENTER.lon, GIJON_CENTER.lat],
    zoom: 12.5,
    pitch: 55,
    bearing: -25,
    antialias: true,
  });

  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }));
  attachWindCanvas();

  map.on("load", () => {
    map.addSource("mapbox-dem", {
      type: "raster-dem",
      tiles: [
        `https://api.mapbox.com/v4/mapbox.terrain-rgb/{z}/{x}/{y}@2x.pngraw?access_token=${MAPBOX_TOKEN}`,
      ],
      tileSize: 512,
      maxzoom: 14,
    });
    map.setTerrain({ source: "mapbox-dem", exaggeration: 1.6 });
    map.addLayer({
      id: "hillshade",
      type: "hillshade",
      source: "mapbox-dem",
      paint: {
        "hillshade-exaggeration": 0.8,
      },
    });
  });

  map.on("moveend", () => {
    if (!meshEnabled) return;
    meshEdges = buildMeshEdges();
    setLayers(buildLayers(lastSensors, lastOfficialStations, labelsEnabled, meshEdges));
  });

  map.on("movestart", () => {
    if (!windEnabled) return;
    if (windIsRotating) return;
    stopWindParticles();
    clearWind();
  });
  map.on("zoomstart", () => {
    if (!windEnabled) return;
    stopWindParticles();
    clearWind();
  });

  map.on("moveend", scheduleWindRender);
  map.on("zoomend", scheduleWindRender);
  map.on("rotatestart", () => {
    windIsRotating = true;
  });
  map.on("rotateend", () => {
    windIsRotating = false;
    scheduleWindRender();
  });
  map.on("resize", scheduleWindRender);

  deckOverlay = new deck.MapboxOverlay({
    layers: [],
    onClick: handlePick,
  });
  map.addControl(deckOverlay);

  map.on("move", updatePanelPositions);
  map.on("zoom", updatePanelPositions);
}

function setLayers(layers) {
  if (!deckOverlay) return;
  deckOverlay.setProps({ layers });
}

function startRotation() {
  rotating = true;
  rotateBtn.textContent = "Rotación: ON";
  rotateControl.classList.remove("hidden");
  if (windEnabled) {
    setWindEnabled(false);
  }
  windBtn.style.display = "none";

  const rotate = () => {
    if (!rotating || !map) return;
    const bearing = map.getBearing();
    map.setBearing(bearing + rotationSpeed);
    rotationHandle = requestAnimationFrame(rotate);
  };

  rotationHandle = requestAnimationFrame(rotate);
}

function stopRotation() {
  rotating = false;
  rotateBtn.textContent = "Rotación: OFF";
  rotateControl.classList.add("hidden");
  if (rotationHandle) cancelAnimationFrame(rotationHandle);
  if (!windEnabled) {
    windBtn.style.display = "inline-flex";
  }
}

async function refreshData() {
  statusEl.textContent = "Cargando datos…";
  try {
    const [communityResult, officialResult] = await Promise.allSettled([
      loadSensors(),
      loadOfficialStations(),
    ]);

    const sensors =
      communityResult.status === "fulfilled" ? communityResult.value : [];
    const officialStations =
      officialResult.status === "fulfilled" ? officialResult.value : [];
    officialError =
      officialResult.status === "rejected"
        ? officialResult.reason?.message || "Sin acceso"
        : null;

    lastSensors = sensors;
    lastOfficialStations = officialStations;
    if (meshEnabled) {
      meshEdges = buildMeshEdges();
    }
    setLayers(buildLayers(sensors, officialStations, labelsEnabled, meshEdges));
    updateHistory([...sensors, ...officialStations]);
    const communityLatest = sensors.reduce((acc, sensor) => {
      if (!sensor.timestamp) return acc;
      if (!acc || sensor.timestamp > acc) return sensor.timestamp;
      return acc;
    }, null);
    const officialLatest = officialStations.reduce((acc, station) => {
      const stamp = station.displayTimestamp || station.timestamp;
      if (!stamp) return acc;
      if (!acc || stamp > acc) return stamp;
      return acc;
    }, null);
    const communityLabel = communityLatest
      ? ` · 🕒 ${formatTimeOnly(communityLatest)}`
      : "";
    const officialLabel = officialLatest
      ? ` · 🕒 ${formatTimeOnly(officialLatest)}`
      : "";
    const officialStatus =
      officialResult.status === "fulfilled"
        ? `${officialStations.length}${officialLabel}`
        : "no disponible";
    const officialHint = officialError ? ` (${officialError})` : "";
    statusEl.textContent = `Sensores: ${sensors.length}${communityLabel} · Estaciones oficiales: ${officialStatus}${officialHint}`;
    openPanels.forEach((panelState, sensorId) => {
      const updated =
        sensors.find((sensor) => sensor.id === sensorId) ||
        officialStations.find((sensor) => sensor.id === sensorId);
      if (updated) {
        panelState.sensor = updated;
        renderPanel(panelState);
      }
    });
    updatePanelPositions();
  } catch (error) {
    statusEl.textContent = "Error cargando datos";
    console.error(error);
  }
}

if (refreshBtn) {
  refreshBtn.addEventListener("click", () => {
    refreshData();
  });
}

rotateBtn.addEventListener("click", () => {
  if (rotating) {
    stopRotation();
  } else {
    startRotation();
  }
});

terrainBtn.addEventListener("click", () => {
  if (!map) return;
  terrainEnabled = !terrainEnabled;
  if (terrainEnabled) {
    map.setTerrain({ source: "mapbox-dem", exaggeration: 1.6 });
    if (!map.getLayer("hillshade")) {
      map.addLayer({
        id: "hillshade",
        type: "hillshade",
        source: "mapbox-dem",
        paint: {
          "hillshade-exaggeration": 0.8,
        },
      });
    }
    terrainBtn.textContent = "Relieve: ON";
  } else {
    map.setTerrain(null);
    if (map.getLayer("hillshade")) {
      map.removeLayer("hillshade");
    }
    terrainBtn.textContent = "Relieve: OFF";
  }
});

labelsBtn.addEventListener("click", () => {
  labelsEnabled = !labelsEnabled;
  labelsBtn.textContent = labelsEnabled ? "Banderas: ON" : "Banderas: OFF";
  meshBtn.style.display = labelsEnabled ? "none" : "inline-flex";
  if (labelsEnabled && meshEnabled) {
    meshEnabled = false;
    meshBtn.textContent = "Malla: OFF";
    meshEdges = [];
  }
  setLayers(buildLayers(lastSensors, lastOfficialStations, labelsEnabled, meshEdges));
});

meshBtn.addEventListener("click", () => {
  meshEnabled = !meshEnabled;
  meshBtn.textContent = meshEnabled ? "Malla: ON" : "Malla: OFF";
  meshEdges = meshEnabled ? buildMeshEdges() : [];
  setLayers(buildLayers(lastSensors, lastOfficialStations, labelsEnabled, meshEdges));
});

windBtn.addEventListener("click", () => {
  setWindEnabled(!windEnabled);
  if (windEnabled) {
    stopRotation();
    rotateBtn.style.display = "none";
    rotateControl.classList.add("hidden");
  } else {
    rotateBtn.style.display = "inline-flex";
  }
});

function syncFullscreenState(active) {
  fullscreenActive = active;
  if (fullscreenBtn) {
    fullscreenBtn.textContent = active ? "⤡" : "⤢";
  }
  if (fullscreenBtnDesktop) {
    fullscreenBtnDesktop.textContent = active
      ? "Salir de pantalla completa"
      : "Pantalla completa";
  }
  if (mapWrap) {
    mapWrap.classList.toggle("fullscreen", active);
  }
  if (map) {
    setTimeout(() => {
      map.resize();
      scheduleWindRender();
    }, 50);
  }
}

function handleFullscreenToggle() {
  if (!mapWrap) return;
  const element = mapWrap;
  const isNative =
    !!document.fullscreenElement || !!document.webkitFullscreenElement;
  if (isNative) {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    } else {
      syncFullscreenState(false);
    }
    return;
  }
  if (fullscreenActive) {
    syncFullscreenState(false);
    return;
  }
  if (element.requestFullscreen) {
    element.requestFullscreen().catch(() => {
      syncFullscreenState(true);
    });
  } else if (element.webkitRequestFullscreen) {
    element.webkitRequestFullscreen();
    syncFullscreenState(true);
  } else {
    syncFullscreenState(true);
  }
}

if ((fullscreenBtn || fullscreenBtnDesktop) && mapWrap) {
  if (fullscreenBtn) {
    fullscreenBtn.addEventListener("click", handleFullscreenToggle);
  }
  if (fullscreenBtnDesktop) {
    fullscreenBtnDesktop.addEventListener("click", handleFullscreenToggle);
  }

  document.addEventListener("fullscreenchange", () => {
    const active = !!document.fullscreenElement;
    syncFullscreenState(active);
  });
  document.addEventListener("webkitfullscreenchange", () => {
    const active = !!document.webkitFullscreenElement;
    syncFullscreenState(active);
  });
}

rotateSpeedInput.addEventListener("input", () => {
  rotationSpeed = Number(rotateSpeedInput.value);
});

initMap();
preloadOfficialHistory().finally(() => {
  refreshData();
});
setInterval(refreshData, AUTO_REFRESH_MS);
meshBtn.style.display = labelsEnabled ? "none" : "inline-flex";
if (windCanvas) windCanvas.style.display = "none";
loadMeteoForecast();
meteoRefreshTimer = setInterval(loadMeteoForecast, 3 * 60 * 60 * 1000);
placeControlsForViewport();
window.addEventListener("resize", placeControlsForViewport);

function handlePick(info) {
  if (!info || !info.object) {
    return;
  }

  const sensor = info.object;
  const existing = openPanels.get(sensor.id);
  if (existing) {
    removePanel(sensor.id);
    return;
  }

  createPanel(sensor);
}

function updatePanelPositions() {
  if (!map) return;
  const mapRect = map.getContainer().getBoundingClientRect();
  openPanels.forEach((panelState) => {
    if (!panelState.anchored) return;
    const point = map.project([panelState.sensor.lon, panelState.sensor.lat]);
    const width = panelState.el.offsetWidth || 280;
    const height = panelState.el.offsetHeight || 240;
    const targetX = point.x - width * 0.35;
    const targetY = point.y - height - 32;
    const x = Math.max(12, Math.min(targetX, mapRect.width - width - 12));
    const y = Math.max(12, Math.min(targetY, mapRect.height - height - 12));
    panelState.el.style.left = `${x}px`;
    panelState.el.style.top = `${y}px`;
  });
}

function createPanel(sensor) {
  const panelEl = document.createElement("div");
  panelEl.className = "panel";
  panelEl.dataset.sensorId = sensor.id;

  const header = document.createElement("div");
  header.className = "panel-header";

  const titleWrap = document.createElement("div");
  const title = document.createElement("p");
  title.className = "panel-title";
  title.textContent = `Sensor ${sensor.id}`;
  const meta = document.createElement("p");
  meta.className = "panel-meta";
  meta.textContent = "Cargando historial…";
  titleWrap.appendChild(title);
  titleWrap.appendChild(meta);

  const actions = document.createElement("div");
  actions.style.display = "flex";
  actions.style.gap = "8px";

  const reset = document.createElement("button");
  reset.className = "panel-close";
  reset.textContent = "Reubicar";

  const close = document.createElement("button");
  close.className = "panel-close";
  close.textContent = "Cerrar";
  close.addEventListener("click", (event) => {
    event.stopPropagation();
    removePanel(sensor.id);
  });

  header.appendChild(titleWrap);
  actions.appendChild(reset);
  actions.appendChild(close);
  header.appendChild(actions);

  let canvas = null;
  let legend = null;
  let tooltip = null;
  let embed = null;

  if (sensor.source === "official") {
    canvas = document.createElement("canvas");
    canvas.id = `chart-${sensor.id}`;
    legend = document.createElement("div");
    legend.className = "panel-legend";
    tooltip = document.createElement("div");
    tooltip.className = "chart-tooltip";
  } else {
    embed = buildCommunityEmbed(sensor);
  }

  panelEl.appendChild(header);
  if (canvas) panelEl.appendChild(canvas);
  if (legend) panelEl.appendChild(legend);
  if (embed) panelEl.appendChild(embed);
  if (tooltip) panelEl.appendChild(tooltip);
  panelsLayer.appendChild(panelEl);

  const panelState = {
    sensor,
    el: panelEl,
    title,
    meta,
    canvas,
    legend,
    tooltip,
    embed,
    address: sensor.address || addressCache[sensor.id] || null,
    anchored: true,
    points: [],
    series: [],
  };
  openPanels.set(sensor.id, panelState);
  renderPanel(panelState);
  updatePanelPositions();
  if (!panelState.address && sensor.source !== "official") {
    resolveAddress(panelState);
  }

  reset.addEventListener("click", (event) => {
    event.stopPropagation();
    panelState.anchored = true;
    updatePanelPositions();
  });

  enableDrag(panelState);
  if (sensor.source === "official") {
    enableTooltip(panelState);
  }
}

function removePanel(sensorId) {
  const panelState = openPanels.get(sensorId);
  if (!panelState) return;
  panelState.el.remove();
  openPanels.delete(sensorId);
}

function enableDrag(panelState) {
  const panel = panelState.el;
  let startX = 0;
  let startY = 0;
  let originX = 0;
  let originY = 0;

  const onMove = (event) => {
    if (!panelState.dragging) return;
    const point = getPoint(event);
    const dx = point.x - startX;
    const dy = point.y - startY;
    panel.style.left = `${originX + dx}px`;
    panel.style.top = `${originY + dy}px`;
  };

  const onUp = () => {
    if (!panelState.dragging) return;
    panelState.dragging = false;
    panel.classList.remove("dragging");
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
    window.removeEventListener("touchmove", onMove);
    window.removeEventListener("touchend", onUp);
  };

  const onDown = (event) => {
    if (event.target.closest("button, select, option, iframe, input")) return;
    panelState.dragging = true;
    panelState.anchored = false;
    panel.classList.add("dragging");
    const rect = panel.getBoundingClientRect();
    const point = getPoint(event);
    startX = point.x;
    startY = point.y;
    originX = rect.left - panel.offsetParent.getBoundingClientRect().left;
    originY = rect.top - panel.offsetParent.getBoundingClientRect().top;
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onUp);
    event.preventDefault();
  };

  panel.addEventListener("mousedown", onDown);
  panel.addEventListener("touchstart", onDown, { passive: false });
}

function getPoint(event) {
  if (event.touches && event.touches[0]) {
    return { x: event.touches[0].clientX, y: event.touches[0].clientY };
  }
  return { x: event.clientX, y: event.clientY };
}

function enableTooltip(panelState) {
  const canvas = panelState.canvas;
  const tooltip = panelState.tooltip;

  const hide = () => {
    tooltip.classList.remove("visible");
  };

  const show = (event) => {
    if (!panelState.points.length || !panelState.series.length) return;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const width = rect.width;
    const paddingLeft = 36;
    const paddingRight = 32;
    const plotWidth = width - paddingLeft - paddingRight;
    if (x < paddingLeft || x > paddingLeft + plotWidth) {
      hide();
      return;
    }

    const points = panelState.points;
    const times = points.map((p) => p.t);
    const tMin = Math.min(...times);
    const tMax = Math.max(...times);
    const ratio = (x - paddingLeft) / Math.max(plotWidth, 1);
    const targetTime = tMin + ratio * (tMax - tMin);
    let nearest = points[0];
    let best = Math.abs(points[0].t - targetTime);
    for (const point of points) {
      const diff = Math.abs(point.t - targetTime);
      if (diff < best) {
        best = diff;
        nearest = point;
      }
    }

    const timeLabel = formatTimestamp(nearest.t);
    const rows = panelState.series
      .map((series) => {
        const value = nearest[series.key];
        if (value === null || Number.isNaN(value)) return null;
        return `<span style=\"color:${series.color}\">${series.label}: ${value.toFixed(1)}</span>`;
      })
      .filter(Boolean)
      .join("<br>");

    tooltip.innerHTML = `${timeLabel}<br>${rows || "Sin datos"}`;
    tooltip.classList.add("visible");
  };

  canvas.addEventListener("mousemove", show);
  canvas.addEventListener("mouseleave", hide);
}

function formatTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${day}/${month}/${year} ${hours}:${minutes}`;
}

function formatTimeOnly(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function buildMeshEdges() {
  if (!map || !window.d3) return [];
  const combined = [...lastSensors, ...lastOfficialStations].filter(
    (sensor) => Number.isFinite(sensor.lon) && Number.isFinite(sensor.lat)
  );
  if (!combined.length) return [];

  const points = combined.map((sensor) => {
    const point = map.project([sensor.lon, sensor.lat]);
    return { sensor, x: point.x, y: point.y };
  });

  const delaunay = window.d3.Delaunay.from(points, (d) => d.x, (d) => d.y);
  const edges = [];
  const seen = new Set();

  for (let i = 0; i < points.length; i += 1) {
    for (const j of delaunay.neighbors(i)) {
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const sourceSensor = points[i].sensor;
      const targetSensor = points[j].sensor;
      const sourceElevation =
        sourceSensor.source === "official"
          ? elevationFor(sourceSensor) * 0.5
          : elevationFor(sourceSensor);
      const targetElevation =
        targetSensor.source === "official"
          ? elevationFor(targetSensor) * 0.5
          : elevationFor(targetSensor);
      const source = [sourceSensor.lon, sourceSensor.lat, sourceElevation];
      const target = [targetSensor.lon, targetSensor.lat, targetElevation];
      const color = colorFor(sourceSensor);
      edges.push({ source, target, color });
    }
  }

  return edges;
}

function renderPanel(panelState) {
  const { sensor } = panelState;
  const displayTime =
    sensor.source === "official"
      ? sensor.displayTimestamp || sensor.timestamp
      : sensor.timestamp;
  const timestampText = displayTime
    ? `Actualizado ${formatTimestamp(displayTime)}`
    : "Actualizado -";
  if (sensor.source === "community") {
    const address = panelState.address || "-";
    panelState.title.textContent = `Sensor ${sensor.nodeId || sensor.id}`;
    const addressLine = `C/ ${address}`;
    panelState.meta.textContent = panelState.address
      ? `${addressLine} · ${timestampText}`
      : `${addressLine} · ${timestampText} · Buscando dirección…`;
  } else {
    const addressText = panelState.address ? ` · ${panelState.address}` : "";
    const baseTitle =
      sensor.source === "official" && sensor.name
        ? `Estacion ${sensor.name}`
        : `Sensor ${sensor.id}`;
    panelState.title.textContent = `${baseTitle}${addressText}`;
  }
  const history = getHistory(sensor.id);
  const points = history?.data || [];
  if (sensor.source === "community") {
    panelState.points = [];
    panelState.series = [];
  } else {
    const coverage = points.length
      ? `${points.length} muestras (últimas 24h)`
      : "Historial local iniciándose…";
    if (panelState.address || sensor.source === "official") {
      panelState.meta.textContent = `${coverage} · ${timestampText}`;
    } else {
      panelState.meta.textContent = `${coverage} · ${timestampText} · Buscando dirección…`;
    }
    const availableSeries = SERIES.filter((series) =>
      points.some((point) => point[series.key] !== null)
    );
    panelState.points = points;
    panelState.series = availableSeries;
    if (panelState.canvas && panelState.legend) {
      renderLegend(panelState.legend, availableSeries);
      drawChart(panelState.canvas, points, availableSeries);
    }
  }
}

function renderLegend(container, seriesList) {
  container.innerHTML = "";
  seriesList.forEach((series) => {
    const item = document.createElement("span");
    const dot = document.createElement("i");
    dot.style.background = series.color;
    item.appendChild(dot);
    item.append(series.label);
    container.appendChild(item);
  });
}

function buildCommunityEmbed(sensor) {
  const container = document.createElement("div");
  const label = document.createElement("div");
  label.textContent = "Grafica Sensor.Community";
  label.style.fontSize = "0.75rem";
  label.style.color = "#2c3e45";
  label.style.marginTop = "6px";

  const select = document.createElement("select");
  select.style.margin = "6px 0 8px";
  COMMUNITY_RANGES.forEach((range) => {
    const option = document.createElement("option");
    option.value = range.value;
    option.textContent = range.label;
    select.appendChild(option);
  });

  const iframe = document.createElement("iframe");
  iframe.loading = "lazy";
  iframe.style.width = "100%";
  iframe.style.height = "220px";
  iframe.style.border = "0";

  const nodeId = sensor.nodeId || sensor.id;
  const setUrl = (range) => {
    const panelId = COMMUNITY_RANGE_PANELS[range] || COMMUNITY_RANGE_PANELS["24h"];
    const cacheBust = Date.now();
    iframe.src = `${COMMUNITY_GRAFANA_BASE}&panelId=${panelId}&var-chipID=${encodeURIComponent(
      nodeId
    )}&k=${cacheBust}`;
  };
  setUrl(COMMUNITY_RANGES[0].value);
  select.addEventListener("change", () => {
    setUrl(select.value);
  });

  container.appendChild(label);
  container.appendChild(select);
  container.appendChild(iframe);
  return container;
}

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY)) || {};
  } catch (error) {
    return {};
  }
}

function saveHistory(history) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

function loadAddressCache() {
  try {
    return JSON.parse(localStorage.getItem(ADDRESS_KEY)) || {};
  } catch (error) {
    return {};
  }
}

function saveAddressCache(cache) {
  localStorage.setItem(ADDRESS_KEY, JSON.stringify(cache));
}

function loadOfficialStationsCache() {
  try {
    return JSON.parse(localStorage.getItem(OFFICIAL_STATIONS_KEY)) || [];
  } catch (error) {
    return [];
  }
}

function saveOfficialStationsCache(stations) {
  localStorage.setItem(OFFICIAL_STATIONS_KEY, JSON.stringify(stations));
}

function formatAddress(data) {
  const addr = data.address || {};
  const parts = [];
  const road = addr.road || addr.pedestrian || addr.cycleway || addr.path;
  if (road) {
    parts.push(addr.house_number ? `${road} ${addr.house_number}` : road);
  }
  if (addr.suburb) parts.push(addr.suburb);
  if (addr.city || addr.town || addr.village) {
    parts.push(addr.city || addr.town || addr.village);
  }
  if (!parts.length && data.display_name) {
    parts.push(data.display_name.split(",").slice(0, 3).join(", "));
  }
  return parts.join(", ");
}

async function resolveAddress(panelState) {
  const { sensor } = panelState;
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${sensor.lat}&lon=${sensor.lon}&zoom=18&addressdetails=1&accept-language=es`;
  try {
    const response = await fetch(url, {
      headers: { "Accept-Language": "es" },
    });
    if (!response.ok) return;
    const data = await response.json();
    const formatted = formatAddress(data);
    if (!formatted) return;
    addressCache[sensor.id] = formatted;
    saveAddressCache(addressCache);
    panelState.address = formatted;
    sensor.address = formatted;
    renderPanel(panelState);
    if (sensor.source === "community") {
      refreshData();
    }
  } catch (error) {
    return;
  }
}

function updateHistory(sensors) {
  const history = loadHistory();
  const now = Date.now();

  sensors.forEach((sensor) => {
    if (sensor.source === "community") return;
    const sampleTime =
      sensor.source === "official"
        ? sensor.displayTimestamp || sensor.timestamp || now
        : sensor.timestamp || now;
    const sample = {
      t: sampleTime,
      pm10: sensor.pm10 ?? null,
      pm25: sensor.pm25 ?? null,
      no2: sensor.no2 ?? null,
      no: sensor.no ?? null,
      humidity: sensor.humidity ?? null,
      temperature: sensor.temperature ?? null,
      pressure: sensor.pressure ?? null,
    };

    if (!history[sensor.id]) {
      history[sensor.id] = { data: [] };
    }

    const entries = history[sensor.id].data;
    const last = entries[entries.length - 1];
    if (!last || Math.abs(sample.t - last.t) > 2 * 60 * 1000) {
      entries.push(sample);
    } else {
      entries[entries.length - 1] = sample;
    }
    history[sensor.id].data = history[sensor.id].data.filter(
      (entry) => now - entry.t <= HISTORY_WINDOW_MS
    );
  });

  saveHistory(history);
}

function getHistory(sensorId) {
  const history = loadHistory();
  return history[sensorId] || { data: [] };
}

function drawChart(canvas, points, seriesList) {
  const ctx = canvas.getContext("2d");
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  ctx.scale(dpr, dpr);

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#fffaf2";
  ctx.fillRect(0, 0, width, height);

  if (!points.length || !seriesList.length) {
    ctx.fillStyle = "#2c3e45";
    ctx.font = "12px Roboto Mono";
    ctx.fillText("Esperando datos para construir 24h.", 12, height / 2);
    return;
  }

  const padding = { left: 36, right: 32, top: 18, bottom: 24 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const times = points.map((p) => p.t);
  const tMin = Math.min(...times);
  const tMax = Math.max(...times);

  const leftSeries = seriesList.filter((s) => s.axis === "left");
  const rightSeries = seriesList.filter((s) => s.axis === "right");
  const leftValues = points.flatMap((p) =>
    leftSeries.map((s) => p[s.key]).filter((v) => v !== null)
  );
  const rightValues = points.flatMap((p) =>
    rightSeries.map((s) => p[s.key]).filter((v) => v !== null)
  );
  const leftMin = leftValues.length ? Math.min(...leftValues, 0) : 0;
  const leftMax = leftValues.length ? Math.max(...leftValues, 10) : 10;
  const rightMin = rightValues.length ? Math.min(...rightValues) : 0;
  const rightMax = rightValues.length ? Math.max(...rightValues) : 1;

  ctx.strokeStyle = "rgba(16,32,39,0.15)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padding.left, padding.top);
  ctx.lineTo(padding.left, padding.top + plotHeight);
  ctx.lineTo(padding.left + plotWidth, padding.top + plotHeight);
  ctx.stroke();

  seriesList.forEach((series) => {
    const values = points.map((p) => p[series.key]);
    const axisMin = series.axis === "left" ? leftMin : rightMin;
    const axisMax = series.axis === "left" ? leftMax : rightMax;

    ctx.strokeStyle = series.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    let started = false;
    values.forEach((value, index) => {
      if (value === null) return;
      const t = (points[index].t - tMin) / Math.max(tMax - tMin, 1);
      const x = padding.left + t * plotWidth;
      const v = (value - axisMin) / Math.max(axisMax - axisMin, 1);
      const y = padding.top + (1 - v) * plotHeight;
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    });
    if (started) {
      ctx.stroke();
    }
  });
}
