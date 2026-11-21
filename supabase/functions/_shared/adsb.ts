// Turns ADS-B aircraft into database rows. No I/O in here so it can be
// tested without a server.
//
// Both sources serve readsb's aircraft.json format, with two differences:
// adsb.fi calls the list `aircraft` and sends `now` in seconds, adsb.lol
// calls it `ac` and sends milliseconds.

import { countryFromIcao24 } from "./countries.ts";

// The recorded area: New York, from Philadelphia to Hartford. Anything
// outside this box is dropped.
export type Box = { lamin: number; lomin: number; lamax: number; lomax: number };
export const BBOX: Box = { lamin: 39.5, lomin: -76.0, lamax: 42.5, lomax: -71.5 };
export const WORLD: Box = { lamin: -90, lomin: -180, lamax: 90, lomax: 180 };

// The APIs only do circles, so ask for one around the middle of the box
// that's big enough to cover its corners (~140 nm), then filter.
export const QUERY = { lat: 41.0, lon: -73.75, radiusNm: 160 } as const;

// All queried at once and merged; each one's receivers see different planes.
// adsb.fi allows 1 request/second with no daily cap. adsb.lol caps each IP
// at 500 a day, and Supabase's functions share IPs, so it often says 429.
export const SOURCES = [
  { name: "adsb.fi", url: `https://opendata.adsb.fi/api/v2/lat/${QUERY.lat}/lon/${QUERY.lon}/dist/${QUERY.radiusNm}` },
  { name: "adsb.lol", url: `https://api.adsb.lol/v2/point/${QUERY.lat}/${QUERY.lon}/${QUERY.radiusNm}` },
] as const;

const FT = 0.3048;
const KNOT = 0.514444;
const FT_PER_MIN = 0.00508;

export interface Aircraft {
  hex: string;
  flight?: string;
  r?: string; // registration
  t?: string; // ICAO type code, e.g. B738
  desc?: string; // adsb.fi only, e.g. BOEING 737-800
  lat?: number;
  lon?: number;
  alt_baro?: number | "ground";
  gs?: number; // knots
  track?: number; // degrees
  true_heading?: number;
  baro_rate?: number; // ft/min
  seen_pos?: number; // seconds since the last position
  seen?: number;
}

export interface AdsbResponse {
  ac?: Aircraft[] | null; // adsb.lol
  aircraft?: Aircraft[] | null; // adsb.fi
  now: number; // unix ms (adsb.lol) or seconds (adsb.fi)
}

export interface AircraftRow {
  icao24: string;
  callsign: string | null;
  origin_country: string | null;
  lat: number;
  lon: number;
  baro_altitude_m: number | null;
  velocity_ms: number | null;
  heading_deg: number | null;
  vertical_rate_ms: number | null;
  on_ground: boolean;
  observed_at: string;
  registration: string | null;
  aircraft_type: string | null;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const round = (v: number | null, places = 1) => (v == null ? null : Number(v.toFixed(places)));

/** One aircraft to a row, or null if it has no usable position or address. */
export function toRow(a: Aircraft, nowMs: number, box: Box = BBOX): AircraftRow | null {
  const lat = num(a.lat);
  const lon = num(a.lon);
  if (lat == null || lon == null) return null;
  if (lat < box.lamin || lat > box.lamax || lon < box.lomin || lon > box.lomax) return null;

  // "~abc123" means a non-ICAO address (TIS-B etc), not a real airframe id
  const icao24 = (a.hex ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{6}$/.test(icao24)) return null;

  const onGround = a.alt_baro === "ground";
  const alt = onGround ? 0 : num(a.alt_baro);
  const gs = num(a.gs);
  const rate = num(a.baro_rate);
  const age = num(a.seen_pos) ?? num(a.seen) ?? 0;

  return {
    icao24,
    callsign: a.flight?.trim() || null,
    origin_country: countryFromIcao24(icao24),
    lat,
    lon,
    baro_altitude_m: round(alt == null ? null : alt * FT),
    velocity_ms: round(gs == null ? null : gs * KNOT),
    heading_deg: num(a.track) ?? num(a.true_heading),
    vertical_rate_ms: round(rate == null ? null : rate * FT_PER_MIN, 2),
    on_ground: onGround,
    observed_at: new Date(Math.round(nowMs - age * 1000)).toISOString(),
    registration: a.r?.trim() || null,
    aircraft_type: a.desc?.trim() || a.t?.trim() || null,
  };
}

/** Whole response to rows, one per aircraft (the upsert fails on duplicates). */
export function toRows(body: AdsbResponse, box: Box = BBOX): AircraftRow[] {
  // anything below 1e12 can't be milliseconds (that's 2001), so it's seconds
  const nowMs = body.now < 1e12 ? body.now * 1000 : body.now;
  const latest = new Map<string, AircraftRow>();
  for (const a of body.ac ?? body.aircraft ?? []) {
    const row = toRow(a, nowMs, box);
    if (!row) continue;
    const prev = latest.get(row.icao24);
    if (!prev || prev.observed_at < row.observed_at) latest.set(row.icao24, row);
  }
  return [...latest.values()];
}

/**
 * Combine rows from several sources into one per aircraft. The newest
 * position wins; fields it's missing (callsign, type...) are filled in from
 * the other reports of the same aircraft.
 */
export function mergeRows(lists: AircraftRow[][]): AircraftRow[] {
  const byId = new Map<string, AircraftRow>();
  for (const row of lists.flat()) {
    const prev = byId.get(row.icao24);
    if (!prev) { byId.set(row.icao24, { ...row }); continue; }
    const [newer, older] = row.observed_at > prev.observed_at ? [row, prev] : [prev, row];
    const merged = { ...newer } as Record<string, unknown>;
    for (const [k, v] of Object.entries(older)) if (merged[k] == null) merged[k] = v;
    byId.set(row.icao24, merged as unknown as AircraftRow);
  }
  return [...byId.values()];
}
