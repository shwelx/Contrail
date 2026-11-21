import { createClient } from "https://esm.sh/@supabase/supabase-js@2.118.0";

const SUPABASE_URL = "https://agkrfxqdfviztqulrsnt.supabase.co";
const SUPABASE_KEY = "sb_publishable_Up9og2isHmvAeUlyqAsKWw_1W8xYKCW";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const LIVE_COLUMNS =
  "icao24,callsign,origin_country,lat,lon,baro_altitude_m,velocity_ms,heading_deg,vertical_rate_ms,on_ground,observed_at,registration,aircraft_type";

const $ = (id) => document.getElementById(id);
// callsigns come from outside data, so escape anything that goes into innerHTML
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const PLANE = {
  outline: "#000",
  schemes: {
    "plane-air": { light: "#ffffff", dark: "#c9ced6", engine: "#9aa1ab" },
    "plane-watch": { light: "#a8d4ff", dark: "#1f7fe0", engine: "#155fae" },
    "plane-ground": { light: "#9ca3af", dark: "#4b5563", engine: "#374151" },
  },
};
const BBOX = [[-76.0, 39.5], [-71.5, 42.5]]; // the recorded area, same box as the ingest function

// A callsign's first three letters are the airline's ICAO code when a digit follows.
const AIRLINES = {
  TGZ: "Georgian Airways", MYW: "MyWay Airlines", AHY: "Azerbaijan Airlines", AZG: "Silk Way West",
  THY: "Turkish Airlines", PGT: "Pegasus", TKJ: "AJet", SXS: "SunExpress",
  QTR: "Qatar Airways", UAE: "Emirates", FDB: "flydubai", ETD: "Etihad", ABY: "Air Arabia",
  AFL: "Aeroflot", SBI: "S7 Airlines", SDM: "Rossiya", UTA: "UTair", AUL: "Smartavia",
  WZZ: "Wizz Air", WMT: "Wizz Air Malta", WUK: "Wizz Air UK", LOT: "LOT Polish Airlines",
  AUA: "Austrian", DLH: "Lufthansa", AFR: "Air France", KLM: "KLM", BAW: "British Airways",
  BTI: "airBaltic", ISR: "Israir", ELY: "El Al", IRA: "Iran Air", IRM: "Mahan Air",
  KAC: "Kuwait Airways", GFA: "Gulf Air", SVA: "Saudia", KZR: "Air Astana", UZB: "Uzbekistan Airways",
  CCA: "Air China", CES: "China Eastern", CSN: "China Southern", AIC: "Air India", CAL: "China Airlines",
  CHH: "Hainan Airlines", XAX: "AirAsia X", UPS: "UPS", FDX: "FedEx", CPA: "Cathay Pacific", BLX: "TUI fly Nordic",
  RYR: "Ryanair", EZY: "easyJet", EJU: "easyJet Europe", VLG: "Vueling", IBE: "Iberia", SWR: "Swiss", SAS: "SAS",
  FIN: "Finnair", TAP: "TAP Air Portugal", AEE: "Aegean", EIN: "Aer Lingus", VIR: "Virgin Atlantic", ITY: "ITA Airways",
  EWG: "Eurowings", CFG: "Condor", BEL: "Brussels Airlines", NOZ: "Norwegian", NSZ: "Norwegian", EXS: "Jet2", TOM: "TUI",
  AAL: "American Airlines", DAL: "Delta", UAL: "United", SWA: "Southwest", JBU: "JetBlue", ASA: "Alaska Airlines",
  ACA: "Air Canada", WJA: "WestJet", AMX: "Aeroméxico", AZU: "Azul", TAM: "LATAM Brasil", ETH: "Ethiopian Airlines",
  MSR: "EgyptAir", RAM: "Royal Air Maroc", SIA: "Singapore Airlines", QFA: "Qantas", ANA: "ANA", JAL: "Japan Airlines",
  KAL: "Korean Air", AEA: "Air Europa", AAR: "Asiana", EVA: "EVA Air", IGO: "IndiGo", CLX: "Cargolux", GTI: "Atlas Air", DHK: "DHL", BCS: "DHL",
};
const QUICK_PICKS = ["AAL", "DAL", "UAL", "SWA", "RYR", "UAE"];
// adsb.lol only sends the ICAO type code; adsb.fi sends a description.
const TYPES = {
  A319: "Airbus A319", A320: "Airbus A320", A20N: "Airbus A320neo", A321: "Airbus A321", A21N: "Airbus A321neo",
  A332: "Airbus A330-200", A333: "Airbus A330-300", A339: "Airbus A330-900", A359: "Airbus A350-900", A35K: "Airbus A350-1000",
  A388: "Airbus A380", B737: "Boeing 737-700", B738: "Boeing 737-800", B739: "Boeing 737-900", B38M: "Boeing 737 MAX 8",
  B39M: "Boeing 737 MAX 9", B744: "Boeing 747-400", B748: "Boeing 747-8", B752: "Boeing 757-200", B763: "Boeing 767-300",
  B772: "Boeing 777-200", B77L: "Boeing 777-200LR", B77W: "Boeing 777-300ER", B788: "Boeing 787-8", B789: "Boeing 787-9",
  B78X: "Boeing 787-10", E190: "Embraer 190", E195: "Embraer 195", CRJ9: "Bombardier CRJ900", AT72: "ATR 72",
  AT76: "ATR 72-600", DH8D: "Dash 8-400", SU95: "Sukhoi Superjet 100", C17: "Boeing C-17", A400: "Airbus A400M",
};

const airlineCode = (a) => /^([A-Z]{3})\d/.exec(a.callsign ?? "")?.[1] ?? null;
const airlineName = (a) => AIRLINES[airlineCode(a)] ?? null;
function typeName(a) {
  const t = a.aircraft_type;
  if (!t) return null;
  if (TYPES[t]) return TYPES[t];
  if (/\s/.test(t) || t.length > 5) {
    // "BOEING 777-300ER" -> "Boeing 777-300ER"; words with digits stay as they are
    return t.split(" ").map((w) => /\d/.test(w) || w.length <= 3 ? w : w[0] + w.slice(1).toLowerCase()).join(" ");
  }
  return t;
}
// some light aircraft broadcast junk like "2" as a callsign
const realCallsign = (a) => (a.callsign && a.callsign.length >= 3 && /[A-Z]/i.test(a.callsign) ? a.callsign : null);
const titleOf = (a) => realCallsign(a) || a.registration || a.icao24.toUpperCase();
let units = "ft";
try { units = localStorage.getItem("units") === "km" ? "km" : "ft"; } catch { /* private mode */ }
const altText = (m) => units === "km"
  ? `${(m / 1000).toFixed(1)} km`
  : `${(Math.round(m * 3.28084 / 100) * 100).toLocaleString()} ft`;
// ADS-B altitude is pressure altitude (vs 1013.25 hPa), so on high-pressure
// days planes near sea level can read below zero. Below ~50 m the rounded
// figure would show "0 ft" / "0.0 km", which says nothing either.
const belowZero = (a) => a.baro_altitude_m != null && a.baro_altitude_m < 50;
const fmtAlt = (a) => a.on_ground ? "On ground"
  : a.baro_altitude_m == null ? "–"
  : belowZero(a) ? "Near ground level"
  : altText(a.baro_altitude_m);
const DIRS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
const dirOf = (a) => a.heading_deg == null ? null : DIRS[Math.round(Number(a.heading_deg) / 45) % 8];

function summary(a) {
  if (a.on_ground) {
    const moving = a.velocity_ms != null && a.velocity_ms > 3;
    return moving ? "On the ground, taxiing." : "On the ground.";
  }
  const v = a.vertical_rate_ms;
  const level = v == null || Math.abs(v) < 1.5;
  const verb = level ? (belowZero(a) ? "Moving" : "Cruising") : v > 0 ? "Climbing" : "Descending";
  const dir = dirOf(a);
  const alt = a.baro_altitude_m == null ? ""
    : belowZero(a) ? "near ground level"
    : `${verb === "Cruising" ? "at" : "through"} ${altText(a.baro_altitude_m)}`;
  const speed = a.velocity_ms != null ? `${Math.round(a.velocity_ms * 3.6).toLocaleString()} km/h` : "";
  return `${verb}${dir ? ` ${dir}` : ""} ${alt}${alt && speed ? ", " : ""}${speed}.`.replace(/\s+/g, " ").replace(" .", ".");
}
function ago(iso) {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso)) / 1000));
  return s < 60 ? `${s} sec ago` : `${Math.round(s / 60)} min ago`;
}

function toast(message, kind = "") {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = message;
  $("toasts").append(el);
  setTimeout(() => {
    el.classList.add("leaving");
    el.addEventListener("animationend", () => el.remove(), { once: true });
    setTimeout(() => el.remove(), 500);
  }, 3200);
}

const H = {
  space: "#000510", ocean: "#010812", land: "#06172e", cyan: "#4aa8ff", glow: "#1aa8ff",
  label: "#dbeaff", dim: "#8fbfd6", halo: "#020a18",
};
const name = ["coalesce", ["get", "name:en"], ["get", "name:latin"], ["get", "name"]];

function graticule(step = 15) {
  const lines = [];
  for (let lon = -180; lon < 180; lon += step) {
    lines.push(Array.from({ length: 35 }, (_, i) => [lon, -85 + i * 5]));
  }
  // parallels are curves on the globe, and the map joins points with straight
  // lines, so they need a point every degree or they show visible corners
  for (let lat = -75; lat <= 75; lat += step) {
    lines.push(Array.from({ length: 361 }, (_, i) => [-180 + i, lat]));
  }
  return { type: "Feature", geometry: { type: "MultiLineString", coordinates: lines }, properties: {} };
}

const style = {
  version: 8,
  glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
  sources: {
    omt: {
      type: "vector", url: "https://tiles.openfreemap.org/planet",
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · <a href="https://openmaptiles.org/">OpenMapTiles</a>',
    },
    dem: {
      type: "raster-dem", encoding: "terrarium", tileSize: 256, maxzoom: 12,
      tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
    },
    grid: { type: "geojson", data: graticule() },
  },
  projection: { type: "globe" },
  sky: {
    "sky-color": H.space, "horizon-color": H.glow, "fog-color": "#0b3d6e",
    "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 5, 1, 7, 0],
  },
  layers: [
    { id: "land", type: "background", paint: { "background-color": H.land } },
    { id: "relief", type: "hillshade", source: "dem", minzoom: 3,
      paint: {
        "hillshade-shadow-color": "#000814", "hillshade-highlight-color": "#3b9eff", "hillshade-accent-color": "#000814",
        "hillshade-exaggeration": ["interpolate", ["linear"], ["zoom"], 3, 0.25, 8, 0.4],
      } },
    // a dot pattern over everything; the ocean drawn next hides it, leaving dotted land
    { id: "land-dots", type: "background",
      paint: { "background-pattern": "dots", "background-opacity": ["interpolate", ["linear"], ["zoom"], 2, 0.85, 3.5, 0.6, 5, 0] } },
    { id: "water", type: "fill", source: "omt", "source-layer": "water", paint: { "fill-color": H.ocean } },
    { id: "grid", type: "line", source: "grid",
      paint: { "line-color": H.cyan, "line-opacity": 0.16, "line-width": 0.6 } },
    { id: "coast-glow", type: "line", source: "omt", "source-layer": "water",
      filter: ["==", ["get", "class"], "ocean"],
      paint: { "line-color": H.glow, "line-opacity": 0.45, "line-width": 5, "line-blur": 5 } },
    { id: "coast", type: "line", source: "omt", "source-layer": "water",
      paint: { "line-color": H.cyan, "line-opacity": 0.85, "line-width": ["interpolate", ["linear"], ["zoom"], 2, 0.5, 8, 1.2] } },
    { id: "rivers", type: "line", source: "omt", "source-layer": "waterway", filter: ["==", ["get", "class"], "river"],
      paint: { "line-color": H.glow, "line-opacity": 0.5, "line-width": ["interpolate", ["linear"], ["zoom"], 6, 0.6, 10, 1.5] } },
    { id: "roads", type: "line", source: "omt", "source-layer": "transportation", minzoom: 6,
      filter: ["in", ["get", "class"], ["literal", ["motorway", "trunk", "primary"]]],
      paint: { "line-color": "#1d5f8a", "line-opacity": 0.7, "line-width": ["interpolate", ["linear"], ["zoom"], 6, 0.5, 11, 1.8] } },
    { id: "regions", type: "line", source: "omt", "source-layer": "boundary",
      filter: ["all", ["==", ["get", "admin_level"], 4], ["!=", ["get", "maritime"], 1]], minzoom: 6,
      paint: { "line-color": H.cyan, "line-opacity": 0.2, "line-width": 0.6, "line-dasharray": [3, 3] } },
    { id: "borders", type: "line", source: "omt", "source-layer": "boundary",
      filter: ["all", ["==", ["get", "admin_level"], 2], ["!=", ["get", "maritime"], 1]],
      paint: { "line-color": H.cyan, "line-opacity": 0.5, "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.5, 10, 1.3] } },
    { id: "city-glow", type: "circle", source: "omt", "source-layer": "place",
      filter: ["in", ["get", "class"], ["literal", ["city", "town"]]],
      paint: {
        "circle-color": H.glow, "circle-blur": 1, "circle-opacity": 0.35,
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 2, 3, 8, 10],
      } },
    { id: "city-lights", type: "circle", source: "omt", "source-layer": "place",
      filter: ["in", ["get", "class"], ["literal", ["city", "town"]]],
      paint: {
        "circle-color": "#cfe6ff", "circle-blur": 0.4,
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 2, 0.8, 8, 2.2],
      } },
    { id: "sea-names", type: "symbol", source: "omt", "source-layer": "water_name",
      layout: { "text-field": name, "text-font": ["Noto Sans Italic"], "text-size": 12, "text-letter-spacing": 0.2 },
      paint: { "text-color": "#2f8fc0" } },
    { id: "airports", type: "symbol", source: "omt", "source-layer": "aerodrome_label", minzoom: 7,
      filter: ["has", "iata"],
      layout: { "text-field": ["concat", "✈ ", ["get", "iata"]], "text-font": ["Noto Sans Bold"], "text-size": 11, "text-offset": [0, 0.9] },
      paint: { "text-color": "#9ca3af", "text-halo-color": H.halo, "text-halo-width": 1.2 } },
    { id: "towns", type: "symbol", source: "omt", "source-layer": "place", minzoom: 7,
      filter: ["==", ["get", "class"], "town"],
      layout: { "text-field": name, "text-font": ["Noto Sans Regular"], "text-size": 11, "text-offset": [0, 0.8], "text-anchor": "top" },
      paint: { "text-color": H.dim, "text-halo-color": H.halo, "text-halo-width": 1.2 } },
    { id: "cities", type: "symbol", source: "omt", "source-layer": "place",
      filter: ["==", ["get", "class"], "city"],
      layout: {
        "text-field": name, "text-font": ["Noto Sans Regular"], "text-letter-spacing": 0.05,
        "text-size": ["interpolate", ["linear"], ["zoom"], 4, 11, 9, 13],
        "text-offset": [0, 0.8], "text-anchor": "top", "symbol-sort-key": ["get", "rank"],
      },
      paint: { "text-color": H.label, "text-halo-color": H.halo, "text-halo-width": 1.4 } },
    { id: "countries", type: "symbol", source: "omt", "source-layer": "place",
      filter: ["==", ["get", "class"], "country"], maxzoom: 8,
      layout: { "text-field": ["upcase", name], "text-font": ["Noto Sans Regular"], "text-size": 11, "text-letter-spacing": 0.35 },
      paint: { "text-color": "#6cb6ff", "text-opacity": 0.85, "text-halo-color": H.halo, "text-halo-width": 1.2 } },
  ],
};

function dotsImage() {
  const size = 8, px = 2;
  const c = document.createElement("canvas");
  c.width = c.height = size * px;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#4aa8ff";
  ctx.beginPath();
  ctx.arc((size * px) / 2, (size * px) / 2, 1.1 * px, 0, Math.PI * 2);
  ctx.fill();
  return { image: ctx.getImageData(0, 0, c.width, c.height), pixelRatio: px };
}

const phone = innerWidth <= 720;
const collapsed = () => $("panel").classList.contains("collapsed");
const padding = () => phone
  ? { top: 40, bottom: collapsed() ? 120 : innerHeight * 0.5 + 20, left: 20, right: 20 }
  : { top: 40, bottom: 40, left: collapsed() ? 40 : 420, right: 40 };
const openedWithView = Boolean(location.hash);
const map = new maplibregl.Map({
  container: "map", style, center: [-60, 35], zoom: 1.6,
  minZoom: 1, maxZoom: 12, hash: true,
  attributionControl: false, dragRotate: false, pitchWithRotate: false,
});
map.touchZoomRotate.disableRotation();

map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
map.addControl(new maplibregl.AttributionControl({
  compact: true,
  customAttribution: 'Terrain: Mapzen · Flights: <a href="https://adsb.fi">adsb.fi</a>, <a href="https://adsb.lol">adsb.lol</a>',
}), "bottom-right");

// Airliner icon on a 64-unit grid, nose up.
const AIRLINER = {
  wing: "M35 23 L60 37 Q61.5 38 61.5 39.5 L61.5 41 L35.5 35 Z M29 23 L4 37 Q2.5 38 2.5 39.5 L2.5 41 L28.5 35 Z",
  tail: "M34.5 49 L45 55.5 L45 58 L34 56 Z M29.5 49 L19 55.5 L19 58 L30 56 Z",
  body: "M32 2.5 C35 2.5 36 7 36 11 L36 50 C36 55 34 60.5 32 61.5 C30 60.5 28 55 28 50 L28 11 C28 7 29 2.5 32 2.5 Z",
  engines: '<rect x="42" y="27" width="3.6" height="9" rx="1.6"/><rect x="19" y="27" width="3.6" height="9" rx="1.6"/>',
};
const airlinerSvg = (fill, size, heading = 0, stroke = "") =>
  `<svg width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true" style="transform:rotate(${Number(heading) || 0}deg)">` +
  `<g fill="${fill}"${stroke ? ` stroke="${stroke}" stroke-width="3" stroke-linejoin="round" paint-order="stroke"` : ""}>` +
  `<path d="${AIRLINER.wing} ${AIRLINER.tail} ${AIRLINER.body}"/>${AIRLINER.engines}</g></svg>`;

$("legend").innerHTML = [["#e5e7eb", "In the air"], ["#3b9eff", "On your watchlist"], ["#6b7280", "On the ground"]]
  .map(([fill, label]) => `<span>${airlinerSvg(fill, 18, 0, "#000")}${label}</span>`).join("");

function planeImage({ light, dark, engine }) {
  const px = 2, size = 32;
  const c = document.createElement("canvas");
  c.width = c.height = size * px;
  const ctx = c.getContext("2d");
  ctx.scale((size * px) / 64, (size * px) / 64);
  ctx.lineJoin = "round";

  const wing = new Path2D(AIRLINER.wing);
  const tail = new Path2D(AIRLINER.tail);
  const body = new Path2D(AIRLINER.body);
  const engines = new Path2D();
  for (const x of [42, 19]) engines.roundRect(x, 27, 3.6, 9, 1.6);

  ctx.strokeStyle = PLANE.outline;
  ctx.lineWidth = 3;
  for (const p of [wing, tail, engines, body]) ctx.stroke(p);

  const span = ctx.createLinearGradient(0, 0, 64, 0);
  span.addColorStop(0, dark); span.addColorStop(0.5, light); span.addColorStop(1, dark);
  ctx.fillStyle = span;
  ctx.fill(wing);
  ctx.fill(tail);
  ctx.fillStyle = engine;
  ctx.fill(engines);

  const round = ctx.createLinearGradient(28, 0, 36, 0);
  round.addColorStop(0, dark); round.addColorStop(0.45, light); round.addColorStop(1, dark);
  ctx.fillStyle = round;
  ctx.fill(body);

  ctx.fillStyle = PLANE.outline;
  ctx.beginPath();
  ctx.moveTo(29.6, 9); ctx.quadraticCurveTo(32, 6.6, 34.4, 9); ctx.lineTo(34.4, 10.6); ctx.quadraticCurveTo(32, 9.4, 29.6, 10.6); ctx.closePath();
  ctx.fill();

  return { image: ctx.getImageData(0, 0, c.width, c.height), pixelRatio: px };
}

const empty = { type: "FeatureCollection", features: [] };
const mapReady = new Promise((resolve) => map.on("load", () => {
  document.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");
  const dots = dotsImage();
  map.addImage("dots", dots.image, { pixelRatio: dots.pixelRatio });
  if (!openedWithView) setTimeout(() => map.fitBounds(BBOX, { padding: padding(), duration: reducedMotion ? 0 : 3500, essential: true }), 400);
  for (const [id, scheme] of Object.entries(PLANE.schemes)) {
    const { image, pixelRatio } = planeImage(scheme);
    map.addImage(id, image, { pixelRatio });
  }
  map.addSource("planes", { type: "geojson", data: empty });
  map.addSource("trail", { type: "geojson", data: empty });
  map.addSource("contrails", { type: "geojson", data: empty, lineMetrics: true });
  map.addSource("near", { type: "geojson", data: empty });

  map.addLayer({ id: "near-fill", type: "fill", source: "near", paint: { "fill-color": "#3b9eff", "fill-opacity": 0.08 } });
  map.addLayer({ id: "near-line", type: "line", source: "near", paint: { "line-color": "#3b9eff", "line-width": 1.5, "line-dasharray": [2, 2] } });
  map.addLayer({ id: "trail", type: "line", source: "trail",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#7cbcff", "line-width": 2.5, "line-opacity": 0.85, "line-dasharray": [0.5, 2] } });
  // line-gradient can't depend on feature data, hence one layer per colour
  for (const [id, rgb, watched] of [["contrails", "229, 231, 235", false], ["contrails-watch", "59, 158, 255", true]]) {
    map.addLayer({ id, type: "line", source: "contrails", filter: ["==", ["get", "watched"], watched],
      layout: { "line-cap": "round" },
      paint: {
        "line-width": ["interpolate", ["linear"], ["zoom"], 3, 2, 8, 4.5],
        "line-blur": ["interpolate", ["linear"], ["zoom"], 3, 1, 8, 2.5],
        "line-gradient": ["interpolate", ["linear"], ["line-progress"], 0, `rgba(${rgb}, 0)`, 0.5, `rgba(${rgb}, .35)`, 1, `rgba(${rgb}, .95)`],
      } });
  }
  map.addLayer({ id: "plane-glow", type: "circle", source: "planes", filter: ["!", ["get", "ground"]],
    paint: {
      "circle-color": ["case", ["get", "watched"], "#3b9eff", "#2563eb"], "circle-blur": 1, "circle-opacity": 0.35,
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 2, 4, 8, 12],
    } });
  map.addLayer({ id: "selected-ring", type: "circle", source: "planes", filter: ["==", ["get", "selected"], true],
    paint: { "circle-radius": 20, "circle-color": "#7cbcff", "circle-opacity": 0.1, "circle-stroke-color": "#7cbcff", "circle-stroke-width": 1.5 } });
  map.addLayer({ id: "planes", type: "symbol", source: "planes",
    layout: {
      "icon-image": ["get", "icon"],
      "icon-size": ["interpolate", ["linear"], ["zoom"],
        3, ["case", ["get", "selected"], 0.65, ["get", "watched"], 0.5, ["get", "ground"], 0.3, 0.4],
        6, ["case", ["get", "selected"], 1.15, ["get", "watched"], 1, ["get", "ground"], 0.65, 0.85],
        10, ["case", ["get", "selected"], 1.4, ["get", "watched"], 1.25, ["get", "ground"], 0.85, 1.1]],
      "icon-rotate": ["get", "heading"],
      "icon-rotation-alignment": "map",
      "icon-allow-overlap": true, "icon-ignore-placement": true,
      "symbol-sort-key": ["case", ["get", "selected"], 3, ["get", "watched"], 2, ["get", "ground"], 0, 1],
    } });
  map.addLayer({ id: "plane-labels", type: "symbol", source: "planes", minzoom: 7.5,
    layout: {
      "text-field": ["get", "label"], "text-font": ["Noto Sans Bold"], "text-size": 11,
      "text-offset": [0, 1.5], "text-anchor": "top", "text-optional": true,
    },
    paint: { "text-color": "#e5e7eb", "text-halo-color": H.halo, "text-halo-width": 1.5 } });
  resolve();
}));

const aircraft = new Map();
const offsets = new Map(); // icao24 -> correction still being blended in
const trails = new Map();
let watchRules = [];
let signedIn = false;
let userEmail = null;
let selectedId = null;
let lastUpdate = null;
let realtimeDown = false;
// "home": over New York, from our database with history and live updates.
// "away": anywhere else, fetched live from the planes-near function.
// "far": zoomed out too far to pick an area; New York's planes stay up.
let area = { mode: "home" };

function isWatched(a) {
  return watchRules.some((w) =>
    (w.kind === "icao24" && a.icao24 === w.value.toLowerCase()) ||
    (w.kind === "callsign_prefix" && (a.callsign ?? "").toUpperCase().startsWith(w.value.toUpperCase()))) ||
    overWatchedCountry(a);
}

// A country on the watchlist means "planes flying over it". Outlines are
// Natural Earth 1:50m (world-atlas), fetched the first time they're needed.
let countryDB = null; // lower-case name -> { name, parts: [{ rings, bbox }] }
let countriesP = null;
function loadCountries() {
  countriesP ??= (async () => {
    const res = await fetch("https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-50m.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const db = new Map();
    for (const { name, polys } of decodeTopology(await res.json())) {
      const parts = polys.map((rings) => {
        const bbox = [180, 90, -180, -90];
        for (const [x, y] of rings[0]) {
          bbox[0] = Math.min(bbox[0], x); bbox[1] = Math.min(bbox[1], y);
          bbox[2] = Math.max(bbox[2], x); bbox[3] = Math.max(bbox[3], y);
        }
        return { rings, bbox };
      });
      db.set(name.toLowerCase(), { name, parts });
    }
    countryDB = db;
    countryVersion++;
    scheduleRender();
    return db;
  })().catch((err) => { countriesP = null; throw err; });
  return countriesP;
}

// The outlines come as TopoJSON: shared borders stored once as delta-encoded
// "arcs", and each ring a list of arc indices (~i means the arc reversed).
// Decoding it here saves loading a library for it.
function decodeTopology(topo) {
  const { scale: [sx, sy], translate: [tx, ty] } = topo.transform;
  const arcs = topo.arcs.map((arc) => {
    let x = 0, y = 0;
    return arc.map(([dx, dy]) => [(x += dx) * sx + tx, (y += dy) * sy + ty]);
  });
  const ring = (ids) => ids.flatMap((i, n) => {
    const pts = i < 0 ? [...arcs[~i]].reverse() : arcs[i];
    return n ? pts.slice(1) : pts;
  });
  return topo.objects.countries.geometries
    .filter((g) => g.properties?.name && (g.type === "Polygon" || g.type === "MultiPolygon"))
    .map((g) => ({
      name: String(g.properties.name),
      polys: g.type === "Polygon" ? [g.arcs.map(ring)] : g.arcs.map((p) => p.map(ring)),
    }));
}

function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function inCountry(c, lon, lat) {
  return c.parts.some(({ rings, bbox }) =>
    lon >= bbox[0] && lon <= bbox[2] && lat >= bbox[1] && lat <= bbox[3] &&
    inRing(lon, lat, rings[0]) && !rings.slice(1).some((hole) => inRing(lon, lat, hole)));
}
// The 1:50m coastline is rough (it puts parts of Istanbul in the sea), and
// airspace includes territorial waters, so a plane counts when it's within
// about 20 km (0.2°) of the outline too.
const BUFFER = [[0, 0], [0.2, 0], [-0.2, 0], [0, 0.2], [0, -0.2], [0.14, 0.14], [-0.14, 0.14], [0.14, -0.14], [-0.14, -0.14]];
function overAny(countries, lon, lat) {
  if (!countries.length) return false;
  const kx = 1 / Math.max(Math.cos((lat * Math.PI) / 180), 0.2);
  return BUFFER.some(([dx, dy]) => countries.some((c) => inCountry(c, lon + dx * kx, lat + dy)));
}
const watchedCountries = () => countryDB
  ? watchRules.filter((w) => w.kind === "country").map((w) => countryDB.get(w.value.toLowerCase())).filter(Boolean)
  : [];

// isWatched runs for every plane on every draw, so remember the answer
// until the plane moves or the watched countries change.
let countryVersion = 0;
const countryHit = new WeakMap();
function overWatchedCountry(a) {
  if (!countryDB || a.lat == null) return false;
  const key = `${countryVersion}|${a.lat}|${a.lon}`;
  const hit = countryHit.get(a);
  if (hit?.key === key) return hit.val;
  const val = overAny(watchedCountries(), a.lon, a.lat);
  countryHit.set(a, { key, val });
  return val;
}

// The flight API only answers "planes within 250 nm of a point", so each
// watched country is covered with a grid of those circles, asked one at a
// time (adsb.fi allows one request a second). Planes found over a watched
// country are kept on the map alongside whatever area is in view.
const countryPlanes = new Map(); // icao24 -> { row, at }
let countryLoopId = 0;
let countryKey = "";
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

function circlesFor(c) {
  const STEP = 5.5; // degrees of latitude between centres; each circle reaches ~4.1°
  const out = [];
  for (const { rings, bbox: [x0, y0, x1, y1] } of c.parts) {
    const nLat = Math.max(1, Math.ceil((y1 - y0) / STEP));
    for (let i = 0; i < nLat; i++) {
      const lat = y0 + ((y1 - y0) / nLat) * (i + 0.5);
      const lonStep = STEP / Math.max(Math.cos((lat * Math.PI) / 180), 0.2);
      const nLon = Math.max(1, Math.ceil((x1 - x0) / lonStep));
      for (let k = 0; k < nLon; k++) {
        const lon = x0 + ((x1 - x0) / nLon) * (k + 0.5);
        const kx = Math.cos((lat * Math.PI) / 180);
        const near = inCountry(c, lon, lat) || rings[0].some(([x, y]) => Math.hypot((x - lon) * kx, y - lat) < 4);
        if (near) out.push([Math.round(lat), Math.round(lon)]);
      }
    }
  }
  return out;
}

function syncCountryPlanes() {
  const names = watchRules.filter((w) => w.kind === "country" && !w.pending).map((w) => w.value.toLowerCase()).sort();
  const key = names.join("|");
  if (key === countryKey) return;
  countryKey = key;
  const id = ++countryLoopId;
  if (!names.length) { countryPlanes.clear(); applyRows(); return; }
  loadCountries().then(() => countryLoop(id)).catch((err) => toast(`Couldn't load country outlines: ${err.message}`, "error"));
}

async function countryLoop(id) {
  const seen = new Set();
  const circles = watchedCountries().flatMap(circlesFor).filter(([lat, lon]) => {
    const k = `${lat},${lon}`;
    if (seen.has(k) || Math.abs(lat) > 85) return false;
    seen.add(k);
    return true;
  }).slice(0, 150);
  // drop planes from countries that are no longer watched
  for (const [icao24, { row }] of countryPlanes) if (!overWatchedCountry(row)) countryPlanes.delete(icao24);
  applyRows();
  while (id === countryLoopId) {
    const passStart = Date.now();
    for (const [lat, lon] of circles) {
      while (document.hidden && id === countryLoopId) await sleep(2000);
      if (id !== countryLoopId) return;
      try {
        const now = Date.now();
        for (const row of await planesNear(lat, lon)) {
          if (overWatchedCountry(row)) countryPlanes.set(row.icao24, { row, at: now });
        }
      } catch { /* rate limited or down: the next pass tries again */ }
      if (id !== countryLoopId) return;
      for (const [icao24, { at }] of countryPlanes) if (Date.now() - at > 180_000) countryPlanes.delete(icao24);
      applyRows();
      await sleep(1100);
    }
    await sleep(Math.max(0, 30_000 - (Date.now() - passStart)));
  }
}

function flyToCountry(name) {
  const c = countryDB?.get(name.toLowerCase());
  if (!c) return;
  // the biggest piece, so France means France and not France plus Guiana
  const size = ({ bbox: [x0, y0, x1, y1] }) => (x1 - x0) * (y1 - y0);
  const { bbox } = c.parts.reduce((best, p) => (size(p) > size(best) ? p : best));
  map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: padding(), maxZoom: 7, duration: reducedMotion ? 0 : 1200 });
}

// Between reports each plane keeps flying along its heading at its last
// speed (at most 90 s ahead). When a new report lands, the gap between
// where we drew it and where it really is closes over a second.
const BLEND_MS = 1000;
const ease = (t) => 1 - (1 - t) ** 3;
function predict(a, now = Date.now()) {
  if (a.on_ground || a.velocity_ms == null || a.heading_deg == null) return [a.lon, a.lat];
  const dt = Math.min(90, Math.max(0, (now - Date.parse(a.observed_at)) / 1000));
  const metres = a.velocity_ms * dt;
  const h = (Number(a.heading_deg) * Math.PI) / 180;
  return [
    a.lon + (metres * Math.sin(h)) / (111_320 * Math.cos((a.lat * Math.PI) / 180)),
    a.lat + (metres * Math.cos(h)) / 111_320,
  ];
}
function positionOf(id) {
  const a = aircraft.get(id);
  if (!a) return null;
  const p = predict(a);
  const o = offsets.get(id);
  if (!o) return p;
  const t = (performance.now() - o.t0) / BLEND_MS;
  if (t >= 1) { offsets.delete(id); return p; }
  const k = 1 - ease(t);
  return [p[0] + o.dx * k, p[1] + o.dy * k];
}

// Contrails are drawn to a fixed length on screen (longer for faster
// planes), so they read the same at every zoom level.
function contrail(a, pos, watched) {
  const lat = (pos[1] * Math.PI) / 180;
  const metresPerPx = (40_075_016 * Math.cos(lat)) / (512 * 2 ** map.getZoom());
  const len = 90 * metresPerPx * Math.min(1.3, Math.max(0.5, (a.velocity_ms ?? 220) / 230));
  const h = (Number(a.heading_deg) * Math.PI) / 180;
  const tail = [pos[0] - (len * Math.sin(h)) / (111_320 * Math.cos(lat)), pos[1] - (len * Math.cos(h)) / 111_320];
  return { type: "Feature", geometry: { type: "LineString", coordinates: [tail, pos] }, properties: { watched } };
}

function drawPlanes() {
  const src = map.getSource("planes");
  if (!src) return;
  const features = [];
  const streaks = [];
  for (const a of aircraft.values()) {
    const watched = isWatched(a);
    const pos = positionOf(a.icao24);
    if (!a.on_ground && a.heading_deg != null) streaks.push(contrail(a, pos, watched));
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: pos },
      properties: {
        id: a.icao24,
        heading: Number(a.heading_deg) || 0,
        icon: watched ? "plane-watch" : a.on_ground ? "plane-ground" : "plane-air",
        watched, ground: Boolean(a.on_ground), selected: a.icao24 === selectedId,
        label: titleOf(a),
      },
    });
  }
  src.setData({ type: "FeatureCollection", features });
  map.getSource("contrails")?.setData({ type: "FeatureCollection", features: streaks });
  drawTrail();
}

// Redraw a few times a second; more often is wasted on GeoJSON updates,
// and planes move well under a pixel per frame anyway.
let dirty = true, lastDraw = 0;
function requestDraw() { dirty = true; }
function loop(ts) {
  const every = reducedMotion ? 2000 : aircraft.size > 300 ? 120 : 60;
  if (dirty || ts - lastDraw > every) { drawPlanes(); lastDraw = ts; dirty = false; }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

function drawTrail() {
  const src = map.getSource("trail");
  if (!src) return;
  const pts = selectedId ? [...(trails.get(selectedId) ?? [])] : [];
  const cur = selectedId && positionOf(selectedId);
  if (cur) { pts.pop(); pts.push(cur); }
  src.setData(pts.length > 1
    ? { type: "Feature", geometry: { type: "LineString", coordinates: pts }, properties: {} }
    : empty);
}

function upsertAircraft(a) {
  if (aircraft.get(a.icao24) === a) return; // unchanged row: keep its blend running
  const before = positionOf(a.icao24);
  aircraft.set(a.icao24, a);
  const after = predict(a);
  const gap = before && Math.abs(before[0] - after[0]) + Math.abs(before[1] - after[1]);
  if (before && !reducedMotion && gap < 1.5) offsets.set(a.icao24, { dx: before[0] - after[0], dy: before[1] - after[1], t0: performance.now() });
  else offsets.delete(a.icao24);
  const to = [a.lon, a.lat];

  const trail = trails.get(a.icao24) ?? [];
  const last = trail[trail.length - 1];
  if (!last || last[0] !== to[0] || last[1] !== to[1]) trail.push(to);
  if (trail.length > 240) trail.shift();
  trails.set(a.icao24, trail);
  requestDraw();
}

function removeAircraft(icao24) {
  aircraft.delete(icao24);
  offsets.delete(icao24);
  trails.delete(icao24);
  if (icao24 === selectedId) select(null);
  requestDraw();
}

let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    renderStatus();
    renderFlights();
    renderDetail();
    renderWatchedNow();
    if (currentTab === "watch" && $("pick-list") && currentKind() === "icao24") renderPickList();
    requestDraw();
  });
}

const tip = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 14, className: "plane-tip" });
mapReady.then(() => {
  map.on("mousemove", "planes", (e) => {
    map.getCanvas().style.cursor = "pointer";
    const a = aircraft.get(e.features[0].properties.id);
    if (!a) return;
    tip.setLngLat(e.features[0].geometry.coordinates)
      .setHTML(`${esc(titleOf(a))}<span>${esc(fmtAlt(a))}</span>`).addTo(map);
  });
  map.on("mouseleave", "planes", () => { map.getCanvas().style.cursor = ""; tip.remove(); });
  // the page may open somewhere else (a shared link), not just over New York
  const start = areaFromMap();
  if (start.mode !== "home") { area = start; loadLive(); scheduleRender(); }
  map.on("click", (e) => {
    const box = [[e.point.x - 8, e.point.y - 8], [e.point.x + 8, e.point.y + 8]];
    const hit = map.queryRenderedFeatures(box, { layers: ["planes"] })[0];
    select(hit ? hit.properties.id : null);
  });
  requestDraw();
});

function countTo(el, value) {
  if (value == null) { el.textContent = "–"; delete el.dataset.v; return; }
  const from = el.dataset.v == null ? value : Number(el.dataset.v);
  if (from === value && el.textContent !== "–") return;
  el.dataset.v = value;
  if (reducedMotion || from === value) { el.textContent = value; return; }
  replay(el, "bump");
  const t0 = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - t0) / 600);
    el.textContent = Math.round(from + (value - from) * (1 - (1 - k) ** 3));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function renderStatus() {
  let air = 0, ground = 0, watched = 0;
  for (const a of aircraft.values()) {
    a.on_ground ? ground++ : air++;
    if (isWatched(a)) watched++;
  }
  countTo($("stat-air"), air);
  countTo($("stat-ground"), ground);
  countTo($("stat-watched"), watched);
  $("flights-count").textContent = aircraft.size || "";

  $("live").className = `live${realtimeDown ? " down" : ""}`;
  const t = lastUpdate ? `Updated ${lastUpdate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Loading…";
  $("live-text").textContent = area.mode !== "away" && realtimeDown ? `Connection lost, checking every minute · ${t}` : t;
  $("tagline").textContent = {
    home: "Planes over New York right now, updated every minute.",
    away: "Live planes around the middle of the map, updated every 20 seconds.",
    far: "Zoom in anywhere in the world to see its planes.",
  }[area.mode];
}

const ICON = (fill, heading) => airlinerSvg(fill, 16, heading);
function flightRow(a, meta) {
  const watched = isWatched(a);
  const sub = [airlineName(a), typeName(a), !airlineName(a) && a.origin_country].filter(Boolean).join(" · ") || "Unknown plane";
  return `<li><button class="item${a.icao24 === selectedId ? " selected" : ""}" data-icao="${esc(a.icao24)}">
    <span class="ico${watched ? " watched" : a.on_ground ? " ground" : ""}">${ICON("#000", a.heading_deg)}</span>
    <span class="main"><span class="title">${esc(titleOf(a))}</span><span class="sub">${esc(sub)}</span></span>
    <span class="meta num">${meta ?? esc(fmtAlt(a))}</span>
  </button></li>`;
}
function wireRows(list) {
  list.querySelectorAll("button[data-icao]").forEach((b) => b.onclick = () => select(b.dataset.icao, true));
}

function renderFlights() {
  const q = $("q").value.trim().toLowerCase();
  const rows = [...aircraft.values()]
    .filter((a) => !q || [a.callsign, a.registration, a.icao24, a.origin_country, airlineName(a), typeName(a)]
      .some((v) => (v ?? "").toLowerCase().includes(q)))
    .sort((a, b) => (isWatched(b) - isWatched(a)) || (a.on_ground - b.on_ground) ||
      (!realCallsign(a) - !realCallsign(b)) || titleOf(a).localeCompare(titleOf(b)));
  const list = $("flights");
  const LIMIT = 150;
  list.innerHTML = rows.length
    ? rows.slice(0, LIMIT).map((a) => flightRow(a)).join("") +
      (rows.length > LIMIT ? `<li class="empty">Showing ${LIMIT} of ${rows.length}. Search to find the rest.</li>` : "")
    : `<li class="empty">${aircraft.size ? `Nothing matches “${esc(q)}”.` : lastUpdate ? "No planes in range right now." : "Loading flights…"}</li>`;
  wireRows(list);
}
$("q").addEventListener("input", renderFlights);

async function select(icao24, fly = false) {
  selectedId = icao24;
  tip.remove();
  renderDetail();
  renderFlights();
  requestDraw();
  if (!icao24) return;

  setCollapsed(false);
  document.querySelector(".panel .scroll").scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
  const a = aircraft.get(icao24);
  if (fly && a) map.easeTo({ center: [a.lon, a.lat], padding: padding(), duration: reducedMotion ? 0 : 500 });

  if (area.mode === "away") return;
  const since = new Date(Date.now() - 2 * 3600_000).toISOString();
  const { data } = await supabase.from("aircraft_positions").select("lat,lon")
    .eq("icao24", icao24).gte("observed_at", since).order("observed_at").limit(500);
  if (data?.length && selectedId === icao24) {
    const pts = data.map((p) => [p.lon, p.lat]);
    const cur = aircraft.get(icao24);
    if (cur) pts.push([cur.lon, cur.lat]);
    trails.set(icao24, pts);
    drawTrail();
  }
}
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && selectedId) select(null); });

let cardShownFor = null;
function renderDetail() {
  const el = $("detail");
  const a = selectedId && aircraft.get(selectedId);
  if (!a) { el.hidden = true; el.innerHTML = ""; cardShownFor = null; return; }
  const code = airlineCode(a);
  const has = (kind, value) => watchRules.some((w) => w.kind === kind && w.value.toLowerCase() === value.toLowerCase());
  let actions = "";
  if (signedIn) {
    if (code && AIRLINES[code]) actions += has("callsign_prefix", code)
      ? `<button class="btn secondary" disabled>Watching ${esc(AIRLINES[code] ?? code)}</button>`
      : `<button class="btn secondary" data-watch="callsign_prefix" data-value="${esc(code)}">Watch all ${esc(AIRLINES[code] ?? code)}</button>`;
    actions += has("icao24", a.icao24)
      ? `<button class="btn secondary" disabled>Watching this plane</button>`
      : `<button class="btn secondary" data-watch="icao24" data-value="${esc(a.icao24)}">Watch this plane</button>`;
  } else {
    actions = `<button class="btn link" id="detail-signin">Sign in to add it to your watchlist</button>`;
  }
  const who = [airlineName(a), typeName(a)].filter(Boolean).join(" · ") || "Airline unknown";
  el.hidden = false;
  el.innerHTML = `<div class="card">
    <button class="close" id="detail-close" aria-label="Close">✕</button>
    <div class="callsign">${esc(titleOf(a))}${isWatched(a) ? `<span class="badge">On your list</span>` : ""}</div>
    <div class="airline">${esc(who)}</div>
    <p class="summary">${esc(summary(a))}</p>
    <dl class="facts num">
      <div><dt>Registered in</dt><dd>${esc(a.origin_country ?? "–")}</dd></div>
      <div><dt>Registration</dt><dd>${esc(a.registration ?? "–")}</dd></div>
      <div><dt>Altitude</dt><dd>${esc(fmtAlt(a))}</dd></div>
      <div><dt>Last heard</dt><dd>${esc(ago(a.observed_at))}</dd></div>
    </dl>
    <div class="actions">${actions}</div>
  </div>`;
  if (cardShownFor !== selectedId) { el.querySelector(".card").classList.add("card-in"); cardShownFor = selectedId; }
  $("detail-close").onclick = () => select(null);
  el.querySelectorAll("[data-watch]").forEach((b) => b.onclick = () => addRule(b.dataset.watch, b.dataset.value));
  if ($("detail-signin")) $("detail-signin").onclick = () => showTab("watch");
}
setInterval(renderDetail, 15_000);

const TABS = ["flights", "watch", "near"];
let currentTab = "flights";
function moveInk() {
  const tab = $(`tab-${currentTab}`);
  const pad = parseFloat(getComputedStyle(tab).paddingLeft) || 0;
  const w = tab.offsetWidth - 2 * pad; // the label, without the button's padding
  $("tab-ink").style.width = `${w}px`;
  $("tab-ink").style.transform = `translateX(${tab.offsetLeft + (tab.offsetWidth - w) / 2}px)`;
}
function replay(el, ...classes) {
  el.classList.remove(...classes, "enter-left", "enter-right", "stagger");
  void el.offsetWidth; // restart the CSS animation
  el.classList.add(...classes);
}
function showTab(name) {
  const from = TABS.indexOf(currentTab), to = TABS.indexOf(name);
  currentTab = name;
  for (const t of TABS) {
    $(`tab-${t}`).setAttribute("aria-selected", String(t === name));
    $(`panel-${t}`).hidden = t !== name;
  }
  if (to !== from) replay($(`panel-${name}`), to > from ? "enter-right" : "enter-left", "stagger");
  moveInk();
  setCollapsed(false);
}
moveInk();
addEventListener("resize", moveInk);
// the flight count fills in after load and changes the tab's width
if (window.ResizeObserver) { const ro = new ResizeObserver(moveInk); TABS.forEach((t) => ro.observe($(`tab-${t}`))); }
document.fonts?.ready.then(moveInk);
TABS.forEach((t) => $(`tab-${t}`).onclick = () => showTab(t));
function setUnits(u) {
  units = u;
  $("units").dataset.u = u;
  $("units").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.u === u)));
  try { localStorage.setItem("units", u); } catch { /* private mode */ }
  scheduleRender();
}
$("units").querySelectorAll("button").forEach((b) => b.onclick = () => setUnits(b.dataset.u));
setUnits(units);

function measureCollapsed() {
  const live = $("live");
  $("panel").style.setProperty("--collapsed-h", `${live.offsetTop + live.offsetHeight + 20}px`);
}
measureCollapsed();
addEventListener("resize", measureCollapsed);
document.fonts?.ready.then(measureCollapsed);

function setCollapsed(on) {
  $("panel").classList.toggle("collapsed", on);
  $("collapse").setAttribute("aria-expanded", String(!on));
  $("collapse").setAttribute("aria-label", on ? "Show the panel" : "Hide the panel");
  try { localStorage.setItem("panel-collapsed", on ? "1" : ""); } catch { /* private mode */ }
}
$("grab").onclick = () => setCollapsed(!collapsed());
$("collapse").onclick = () => setCollapsed(!collapsed());
try { if (!phone && localStorage.getItem("panel-collapsed")) setCollapsed(true); } catch { /* private mode */ }

// Replaces the area's planes wholesale, so planes that left (and deletes
// missed while the tab slept) disappear too.
let areaRows = [];
function showOnly(rows) {
  areaRows = rows;
  lastUpdate = new Date();
  applyRows();
}
// what's on the map = the area in view + planes over watched countries
function applyRows() {
  const rows = new Map(areaRows.map((a) => [a.icao24, a]));
  for (const [icao24, { row }] of countryPlanes) if (!rows.has(icao24)) rows.set(icao24, row);
  for (const icao24 of [...aircraft.keys()]) if (!rows.has(icao24)) removeAircraft(icao24);
  rows.forEach(upsertAircraft);
  scheduleRender();
}

async function loadLive() {
  if (area.mode === "away") return loadAway();
  const { data, error } = await supabase.from("live_aircraft").select(LIVE_COLUMNS);
  if (error) { toast(`Couldn't load flights: ${error.message}`, "error"); return; }
  showOnly(data);
}

async function planesNear(lat, lon) {
  // the function snaps to a 1° grid anyway
  const res = await fetch(`${SUPABASE_URL}/functions/v1/planes-near?lat=${Math.round(lat)}&lon=${Math.round(lon)}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return Array.isArray(body.planes) ? body.planes : [];
}

async function loadAway() {
  const { lat, lon } = area;
  try {
    const planes = await planesNear(lat, lon);
    if (area.mode === "away" && area.lat === lat && area.lon === lon) showOnly(planes);
  } catch (err) {
    toast(`Couldn't load planes here: ${err.message}`, "error");
  }
}

const HOME = { lamin: 38.8, lomin: -77.0, lamax: 43.2, lomax: -70.5 }; // the recorded box plus a margin
function areaFromMap() {
  const c = map.getCenter();
  if (map.getZoom() < 5) return { mode: "far" };
  if (c.lat >= HOME.lamin && c.lat <= HOME.lamax && c.lng >= HOME.lomin && c.lng <= HOME.lomax) return { mode: "home" };
  return { mode: "away", lat: Math.round(c.lat), lon: Math.round(c.lng) }; // same 1° grid as the function
}
let moveTimer = null;
map.on("moveend", () => {
  clearTimeout(moveTimer);
  moveTimer = setTimeout(() => {
    const next = areaFromMap();
    const wasAway = area.mode === "away";
    const changed = next.mode !== area.mode || next.lat !== area.lat || next.lon !== area.lon;
    if (!changed) return;
    if (next.mode === "far" && !wasAway) { area = next; scheduleRender(); return; }
    area = next;
    if (selectedId && next.mode !== "away") select(null);
    loadLive();
  }, 400);
});
setInterval(() => { if (area.mode === "away" && !document.hidden) loadAway(); }, 20_000);

loadLive();
// The ingest function broadcasts one "update" per run; we then reload the
// live table in a single request.
// Reloads are throttled to one per 15 s.
let lastBroadcastLoad = 0;
supabase
  .channel("live", { config: { private: true } })
  .on("broadcast", { event: "update" }, () => {
    if (area.mode === "away" || Date.now() - lastBroadcastLoad < 15_000) return;
    lastBroadcastLoad = Date.now();
    loadLive();
  })
  .subscribe((status) => {
    if (status === "SUBSCRIBED") { realtimeDown = false; loadLive(); }
    if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") { realtimeDown = true; scheduleRender(); }
  });
// if realtime can't connect, fall back to plain polling
setInterval(() => { if (realtimeDown) loadLive(); }, 60_000);

function renderFoot() {
  const foot = $("foot");
  if (signedIn) {
    foot.innerHTML = `<span class="who" title="${esc(userEmail)}">Signed in as ${esc(userEmail)}</span>
                      <button class="btn link" id="sign-out">Sign out</button>`;
    $("sign-out").onclick = async () => { await supabase.auth.signOut(); toast("Signed out"); };
  } else {
    foot.innerHTML = `<span>Not signed in</span><button class="btn link" id="foot-signin">Sign in</button>`;
    $("foot-signin").onclick = () => { showTab("watch"); $("email")?.focus(); };
  }
}

const MAIL_ICON = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 7 8 6 8-6"/></svg>`;
const STAR_ICON = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>`;
const ARROW_ICON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`;

function renderSignIn(prefill = "") {
  $("panel-watch").innerHTML = `<div class="signin fade-in">
    <span class="signin-ico">${STAR_ICON}</span>
    <h3>Keep a watchlist</h3>
    <p>Save airlines, planes or countries.</p>
    <form id="signin-form" class="pill" novalidate>
      <label class="sr-only" for="email">Your email</label>
      <input id="email" type="email" required autocomplete="email" placeholder="you@example.com" value="${esc(prefill)}" />
      <button id="sign-in" type="submit" aria-label="Send sign-in link">${ARROW_ICON}</button>
    </form>
    <p class="hint" id="signin-hint">We'll email you a link. No password.</p>
  </div>`;
  const input = $("email"), btn = $("sign-in"), hint = $("signin-hint");
  const sync = () => btn.classList.toggle("ready", input.validity.valid && input.value.trim() !== "");
  input.oninput = () => { sync(); hint.classList.remove("bad"); hint.textContent = "We'll email you a link. No password."; };
  sync();
  $("signin-form").onsubmit = async (e) => {
    e.preventDefault();
    const email = input.value.trim();
    if (!email || !input.validity.valid) {
      hint.textContent = "That doesn't look like an email address.";
      hint.classList.add("bad");
      input.focus();
      return;
    }
    btn.disabled = true; btn.innerHTML = `<span class="spinner" aria-hidden="true"></span>`;
    const { error } = await supabase.auth.signInWithOtp({
      email, options: { emailRedirectTo: location.origin + location.pathname },
    });
    if (error) {
      btn.disabled = false; btn.innerHTML = ARROW_ICON;
      hint.textContent = error.message; hint.classList.add("bad");
      return;
    }
    $("panel-watch").innerHTML = `<div class="signin fade-in">
      <span class="signin-ico">${MAIL_ICON}</span>
      <h3>Check your inbox</h3>
      <p>We sent a link to <b>${esc(email)}</b>. Open it on this device and you'll be signed in.</p>
      <button class="btn link" id="signin-again">Use a different email</button>
    </div>`;
    $("signin-again").onclick = () => renderSignIn(email);
  };
}

async function onSession(session) {
  signedIn = Boolean(session?.user);
  userEmail = session?.user?.email ?? null;
  renderFoot();
  if (signedIn) {
    renderWatchForm();
    await loadWatchlist();
  } else {
    watchRules = [];
    countryVersion++;
    syncCountryPlanes();
    renderSignIn();
    scheduleRender();
  }
}

const KINDS = {
  callsign_prefix: { label: "Airline", field: "Pick an airline" },
  icao24: { label: "One plane", field: "Pick a plane on the map" },
  country: { label: "Country", field: "Pick a country · planes over it light up" },
};

function renderWatchForm() {
  $("panel-watch").innerHTML = `
    <div id="watch-form">
      <fieldset class="segmented" id="kind-picker">
        <legend class="sr-only">What to watch</legend>
        <span class="seg-thumb" aria-hidden="true"></span>
        ${Object.entries(KINDS).map(([k, v], i) => `
          <input type="radio" name="kind" id="kind-${k}" value="${k}"${i === 0 ? " checked" : ""} />
          <label for="kind-${k}">${v.label}</label>`).join("")}
      </fieldset>
      <div class="field" id="watch-label"></div>
      <ul class="pick-list" id="pick-list" role="listbox" aria-labelledby="watch-label"></ul>
    </div>
    <h2>Your watchlist</h2>
    <ul class="list" id="watch-list"></ul>
    <h2>In the air now</h2>
    <ul class="list" id="watched-now"></ul>`;
  const updateKind = () => {
    const kind = currentKind();
    $("kind-picker").style.setProperty("--seg-i", Object.keys(KINDS).indexOf(kind));
    $("watch-label").textContent = KINDS[kind].field;
    $("pick-list").scrollTop = 0;
    renderPickList();
  };
  document.querySelectorAll('input[name="kind"]').forEach((r) => r.onchange = updateKind);
  updateKind();
}
const currentKind = () => document.querySelector('input[name="kind"]:checked')?.value ?? "callsign_prefix";

function pickItems(kind) {
  if (kind === "callsign_prefix") {
    const opt = (code) => ({ value: code, tag: code, label: AIRLINES[code] });
    const rest = Object.keys(AIRLINES).filter((c) => !QUICK_PICKS.includes(c))
      .sort((a, b) => AIRLINES[a].localeCompare(AIRLINES[b]));
    return [{ head: "Popular" }, ...QUICK_PICKS.map(opt), ...groupByLetter(rest.map(opt))];
  }
  if (kind === "icao24") {
    const planes = [...aircraft.values()].sort((a, b) => titleOf(a).localeCompare(titleOf(b)));
    if (!planes.length) return [{ note: "No planes on the map here yet." }];
    return [{ head: `On the map · ${planes.length}` }, ...planes.map((a) => ({
      value: a.icao24, tag: titleOf(a),
      label: [airlineName(a), typeName(a)].filter(Boolean).join(" · ") || a.origin_country || "Unknown plane",
    }))];
  }
  if (!countryDB) return null;
  return groupByLetter([...countryDB.values()].map((c) => c.name).sort((a, b) => a.localeCompare(b))
    .map((name) => ({ value: name, label: name })));
}
function groupByLetter(items) {
  let letter = "";
  return items.flatMap((it) => {
    const first = (it.label ?? it.value)[0].toUpperCase();
    if (first === letter) return [it];
    letter = first;
    return [{ head: first }, it];
  });
}

function renderPickList() {
  const list = $("pick-list");
  if (!list) return;
  const kind = currentKind();
  const items = pickItems(kind);
  if (!items) {
    list.innerHTML = `<li class="cl-note">Loading countries…</li>`;
    loadCountries().then(renderPickList).catch(() => { list.innerHTML = `<li class="cl-note">Couldn't load the country list.</li>`; });
    return;
  }
  const watched = new Set(watchRules.filter((w) => w.kind === kind).map((w) => w.value.toLowerCase()));
  // The plane list follows the map, so this runs on every refresh: skip the
  // redraw when nothing in it changed, and keep the scroll position.
  const sig = `${kind}|${[...watched].join(",")}|${items.map((it) => it.head ?? it.note ?? `${it.value}${it.tag}${it.label}`).join("|")}`;
  if (list.dataset.sig === sig) return;
  list.dataset.sig = sig;
  const top = list.scrollTop;
  list.innerHTML = items.map((it) => {
    if (it.head) return `<li class="cl-letter" aria-hidden="true">${esc(it.head)}</li>`;
    if (it.note) return `<li class="cl-note">${esc(it.note)}</li>`;
    const on = watched.has(it.value.toLowerCase());
    return `<li><button type="button" class="cl-opt${on ? " on" : ""}" data-value="${esc(it.value)}" role="option" aria-selected="${on}"${on ? " disabled" : ""}>
      <span>${it.tag ? `<b>${esc(it.tag)}</b>` : ""}${esc(it.label ?? "")}</span><i>${on ? "Watching" : "+ Watch"}</i></button></li>`;
  }).join("");
  list.scrollTop = top;
  list.querySelectorAll("button[data-value]:not([disabled])").forEach((b) => b.onclick = async () => {
    const ok = await addRule(kind, b.dataset.value);
    if (ok && kind === "country") flyToCountry(b.dataset.value);
    if (ok && kind === "icao24") select(b.dataset.value, true);
  });
}

async function addRule(kind, raw) {
  let value = String(raw ?? "").trim();
  if (!value) return false;
  if (kind === "icao24") {
    value = value.toLowerCase();
    if (!aircraft.has(value)) { toast("That plane isn't on the map right now", "error"); return false; }
  }
  if (kind === "callsign_prefix") {
    value = value.toUpperCase();
    if (!AIRLINES[value]) { toast(`${value} isn't an airline we know`, "error"); return false; }
  }
  if (kind === "country") {
    const db = await loadCountries().catch(() => null);
    const c = db?.get(value.toLowerCase());
    if (!c) { toast(`${value} isn't a country we know`, "error"); return false; }
    value = c.name;
  }
  const label = kind === "callsign_prefix" ? (AIRLINES[value] ?? value) : value;

  if (watchRules.some((w) => w.kind === kind && w.value.toLowerCase() === value.toLowerCase())) { toast("Already on your watchlist"); return false; }

  // show it now, then swap in the row the insert returns
  const temp = { id: `pending-${Date.now()}`, kind, value, pending: true };
  watchRules = [...watchRules, temp];
  renderWatchlist();
  const { data, error } = await supabase.from("watchlist").insert({ kind, value }).select("id,kind,value").single();
  if (error) {
    watchRules = watchRules.filter((w) => w !== temp);
    renderWatchlist();
    toast(error.code === "23505" ? "Already on your watchlist" : error.message, error.code === "23505" ? "" : "error");
    return false;
  }
  watchRules = watchRules.map((w) => (w === temp ? data : w));
  renderWatchlist();
  toast(`Added ${label} to your watchlist`);
  return true;
}

async function loadWatchlist() {
  const { data, error } = await supabase.from("watchlist").select("id,kind,value").order("created_at");
  if (error) { toast(`Couldn't load your watchlist: ${error.message}`, "error"); return; }
  watchRules = data;
  renderWatchlist();
}

const removing = new Set();
const X_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>`;
function renderWatchlist() {
  const list = $("watch-list");
  if (list) {
    list.innerHTML = watchRules.length
      ? watchRules.map((w) => {
          const busy = w.pending || removing.has(w.id);
          return `<li class="rule">
          <span><span class="kind">${KINDS[w.kind].label}</span>${w.kind === "country"
            ? `<button type="button" class="rule-go" data-go="${esc(w.value)}" title="Show on the map">${esc(w.value)}</button>`
            : `<b class="rule-val">${esc(w.value)}</b>`}${
            w.kind === "callsign_prefix" && AIRLINES[w.value] ? `<span class="rule-sub">${esc(AIRLINES[w.value])}</span>` : ""}</span>
          <button class="x${busy ? " busy" : ""}" data-id="${esc(w.id)}" aria-label="Remove ${esc(w.value)}" title="Remove"${busy ? " disabled aria-busy=\"true\"" : ""}>${busy ? `<span class="spinner" aria-hidden="true"></span>` : X_ICON}</button></li>`;
        }).join("")
      : `<li class="empty">Nothing yet. Pick something above, or click any plane on the map.</li>`;
    list.querySelectorAll("button[data-id]:not([disabled])").forEach((b) => b.onclick = () => removeRule(b.dataset.id));
    list.querySelectorAll("button[data-go]").forEach((b) => b.onclick = () => loadCountries().then(() => flyToCountry(b.dataset.go)));
  }
  countryVersion++;
  syncCountryPlanes();
  renderPickList();
  scheduleRender();
}

async function removeRule(id) {
  if (removing.has(id)) return;
  removing.add(id);
  renderWatchlist();
  const { error } = await supabase.from("watchlist").delete().eq("id", id);
  removing.delete(id);
  if (!error) watchRules = watchRules.filter((w) => w.id !== id);
  renderWatchlist();
  if (error) toast(error.message, "error");
}

function renderWatchedNow() {
  const list = $("watched-now");
  if (!list) return;
  const rows = [...aircraft.values()].filter(isWatched).sort((a, b) => titleOf(a).localeCompare(titleOf(b)));
  list.innerHTML = rows.length ? rows.map((a) => flightRow(a)).join("")
    : `<li class="empty">${watchRules.length ? "None of them are in view right now." : "Add something above and it shows up here when it's flying."}</li>`;
  wireRows(list);
}

supabase.auth.onAuthStateChange((_event, session) => {
  // calling supabase from inside this callback can deadlock, so defer it
  setTimeout(() => onSession(session), 0);
});

$("radius").oninput = () => { $("radius-out").textContent = `${$("radius").value} km`; };
const nearLabel = "Use my location";

function circle(lon, lat, km) {
  const pts = [];
  for (let i = 0; i <= 64; i++) {
    const t = (i / 64) * 2 * Math.PI;
    pts.push([lon + (km / (111.32 * Math.cos(lat * Math.PI / 180))) * Math.cos(t), lat + (km / 110.57) * Math.sin(t)]);
  }
  return { type: "Feature", geometry: { type: "Polygon", coordinates: [pts] }, properties: {} };
}

function distanceKm(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const h = Math.sin(((lat2 - lat1) * r) / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

// In the recorded area the database does the search; elsewhere we fetch the area
// and measure distances here.
async function nearby(lat, lon, radius) {
  if (lat >= HOME.lamin && lat <= HOME.lamax && lon >= HOME.lomin && lon <= HOME.lomax) {
    return await supabase.rpc("aircraft_near", { p_lat: lat, p_lon: lon, p_radius_km: radius });
  }
  try {
    const planes = await planesNear(lat, lon);
    const data = planes.map((a) => ({ ...a, distance_km: distanceKm(lat, lon, a.lat, a.lon) }))
      .filter((a) => a.distance_km <= radius).sort((a, b) => a.distance_km - b.distance_km);
    return { data, error: null };
  } catch (err) {
    return { data: null, error: err };
  }
}

async function showNear(lat, lon) {
  const radius = Number($("radius").value);
  const { data, error } = await nearby(lat, lon, radius);
  $("near-btn").disabled = false;
  $("near-btn").textContent = "Search again";
  if (error) { toast(error.message, "error"); return; }

  const area = circle(lon, lat, radius);
  map.getSource("near")?.setData(area);
  const ring = area.geometry.coordinates[0];
  const lons = ring.map((p) => p[0]), lats = ring.map((p) => p[1]);
  map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
    { padding: padding(), duration: reducedMotion ? 0 : 600 });

  $("near-title").hidden = !data.length;
  const list = $("near-list");
  list.innerHTML = data.length
    ? data.map((a) => flightRow(aircraft.get(a.icao24) ?? a, `${a.distance_km.toFixed(0)} km`)).join("")
    : `<li class="empty">No planes within ${radius} km right now. Try a bigger distance.</li>`;
  wireRows(list);
}

$("near-btn").onclick = () => {
  if (!navigator.geolocation) return toast("Your browser can't share its location.", "error");
  $("near-btn").disabled = true;
  $("near-btn").textContent = "Finding you…";
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => showNear(coords.latitude, coords.longitude),
    (err) => {
      $("near-btn").disabled = false;
      $("near-btn").textContent = nearLabel;
      toast(err.code === 1 ? "Location is blocked. Allow it in your browser's address bar, then try again." : err.message, "error");
    });
};

// Cities: a few one-tap picks, plus search as you type (Photon, built on OpenStreetMap).
const POPULAR = [
  ["New York", -74.0, 40.71], ["London", -0.13, 51.51], ["Paris", 2.35, 48.86], ["Dubai", 55.27, 25.20],
  ["Istanbul", 28.98, 41.01], ["Tokyo", 139.69, 35.69], ["Los Angeles", -118.24, 34.05], ["Tbilisi", 44.79, 41.72],
];
let cityResults = [];
let cityActive = -1;
let citySearching = false;
let cityAbort = null;
let cityTimer = null;

function goToCity(name, lon, lat) {
  $("city").value = name;
  syncSearchButtons();
  closeCities();
  $("city").blur();
  map.flyTo({ center: [lon, lat], zoom: 8, padding: padding(), duration: reducedMotion ? 0 : 1800, essential: true });
}
function openCities() { $("city-pop").hidden = false; $("city").setAttribute("aria-expanded", "true"); }
function closeCities() { $("city-pop").hidden = true; $("city").setAttribute("aria-expanded", "false"); cityActive = -1; }

const PIN = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.1-7-11.5a7 7 0 0 1 14 0C19 14.9 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>';
function highlight(name, q) {
  const i = name.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0 || !q) return esc(name);
  return esc(name.slice(0, i)) + `<mark>${esc(name.slice(i, i + q.length))}</mark>` + esc(name.slice(i + q.length));
}
function syncSearchButtons() {
  const has = $("city").value.length > 0;
  $("city-clear").hidden = !has;
  $("city-key").hidden = has;
}
function renderCities() {
  const q = $("city").value.trim();
  const typing = q.length >= 2;
  syncSearchButtons();
  $("city-label").textContent = typing ? "Cities" : "Popular";
  $("city-chips").innerHTML = typing ? "" : POPULAR.map(([n], i) => `<button type="button" class="chip" data-i="${i}">${n}</button>`).join("");
  $("city-chips").querySelectorAll("[data-i]").forEach((b) => b.onmousedown = (e) => {
    e.preventDefault();
    const [n, lon, lat] = POPULAR[b.dataset.i];
    goToCity(n, lon, lat);
  });
  const list = $("city-results");
  list.innerHTML = !typing ? ""
    : cityResults.length
      ? cityResults.map((c, i) => `<li role="option" data-i="${i}" aria-selected="${i === cityActive}"><i class="pin">${PIN}</i><b>${highlight(c.name, q)}</b><span>${esc(c.where)}</span></li>`).join("")
      : `<li class="muted">${citySearching ? "Searching…" : "No cities found"}</li>`;
  list.querySelectorAll("li[data-i]").forEach((li) => li.onmousedown = (e) => {
    e.preventDefault();
    const c = cityResults[li.dataset.i];
    goToCity(c.name, c.lon, c.lat);
  });
}

$("city").addEventListener("input", () => {
  const q = $("city").value.trim();
  openCities();
  clearTimeout(cityTimer);
  cityAbort?.abort();
  cityResults = [];
  cityActive = -1;
  citySearching = q.length >= 2;
  renderCities();
  if (!citySearching) return;
  cityAbort = new AbortController();
  const { signal } = cityAbort;
  cityTimer = setTimeout(async () => {
    try {
      const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=8&lang=en&osm_tag=place:city&osm_tag=place:town`;
      const { features } = await (await fetch(url, { signal, referrerPolicy: "no-referrer" })).json();
      const seen = new Set();
      cityResults = (Array.isArray(features) ? features : []).map((f) => ({
        name: String(f?.properties?.name ?? ""),
        where: [f?.properties?.state, f?.properties?.country].filter(Boolean).join(", "),
        lon: Number(f?.geometry?.coordinates?.[0]), lat: Number(f?.geometry?.coordinates?.[1]),
      })).filter((c) => {
        // outside data: keep only well-formed places, once each
        if (!c.name || !Number.isFinite(c.lon) || !Number.isFinite(c.lat) || Math.abs(c.lat) > 90 || Math.abs(c.lon) > 180) return false;
        const k = `${c.name}|${c.where}`;
        return !seen.has(k) && seen.add(k);
      }).slice(0, 6);
    } catch (err) {
      if (err.name === "AbortError") return;
    }
    citySearching = false;
    renderCities();
  }, 250);
});
$("city").addEventListener("focus", () => { $("city").select(); openCities(); renderCities(); });
$("city").addEventListener("blur", () => setTimeout(closeCities, 100));
$("city-clear").addEventListener("mousedown", (e) => {
  e.preventDefault();
  $("city").value = "";
  $("city").dispatchEvent(new Event("input"));
  $("city").focus();
});
// "/" focuses the search bar
document.addEventListener("keydown", (e) => {
  if (e.key !== "/" || e.metaKey || e.ctrlKey || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return;
  e.preventDefault();
  $("city").focus();
});
$("city").addEventListener("keydown", (e) => {
  if (e.key === "Escape") { closeCities(); $("city").blur(); setTimeout(syncSearchButtons); return; }
  if (!cityResults.length) return;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    cityActive = (cityActive + (e.key === "ArrowDown" ? 1 : -1) + cityResults.length) % cityResults.length;
    $("city-results").querySelectorAll("li[data-i]").forEach((li) => li.setAttribute("aria-selected", String(Number(li.dataset.i) === cityActive)));
  } else if (e.key === "Enter") {
    const c = cityResults[Math.max(cityActive, 0)];
    goToCity(c.name, c.lon, c.lat);
  }
});

renderFlights();
renderStatus();
