// OpenSky "state vectors" to database rows. OpenSky sometimes sees planes
// the other sources miss, but it often refuses requests from
// cloud servers, so the function treats it as a bonus, not a requirement.
// https://openskynetwork.github.io/opensky-api/rest.html#all-state-vectors

import { type AircraftRow, BBOX } from "../_shared/adsb.ts";
import { countryFromIcao24 } from "../_shared/countries.ts";

export const OPENSKY_URL = `https://opensky-network.org/api/states/all?lamin=${BBOX.lamin}&lomin=${BBOX.lomin}&lamax=${BBOX.lamax}&lomax=${BBOX.lomax}`;
export const OPENSKY_TOKEN_URL =
  "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";

// One aircraft is a positional array, not an object.
export type StateVector = [
  string, //         0  icao24
  string | null, //  1  callsign (padded with spaces)
  string, //         2  origin_country
  number | null, //  3  time_position (unix seconds)
  number, //         4  last_contact (unix seconds)
  number | null, //  5  longitude
  number | null, //  6  latitude
  number | null, //  7  baro_altitude (m)
  boolean, //        8  on_ground
  number | null, //  9  velocity (m/s)
  number | null, //  10 true_track (degrees)
  number | null, //  11 vertical_rate (m/s)
  ...unknown[],
];

export interface OpenSkyResponse {
  time: number; // unix seconds
  states: StateVector[] | null;
}

export function fromOpenSky(body: OpenSkyResponse): AircraftRow[] {
  const rows: AircraftRow[] = [];
  for (const s of body.states ?? []) {
    const [hex, callsign, country, timePos, lastContact, lon, lat, alt, onGround, speed, track, rate] = s;
    if (lat == null || lon == null) continue;
    if (lat < BBOX.lamin || lat > BBOX.lamax || lon < BBOX.lomin || lon > BBOX.lomax) continue;
    const icao24 = (hex ?? "").trim().toLowerCase();
    if (!/^[0-9a-f]{6}$/.test(icao24)) continue;
    rows.push({
      icao24,
      callsign: callsign?.trim() || null,
      origin_country: countryFromIcao24(icao24) ?? (country?.trim() || null),
      lat,
      lon,
      baro_altitude_m: onGround ? 0 : alt,
      velocity_ms: speed,
      heading_deg: track,
      vertical_rate_ms: rate,
      on_ground: Boolean(onGround),
      observed_at: new Date((timePos ?? lastContact ?? body.time) * 1000).toISOString(),
      registration: null,
      aircraft_type: null,
    });
  }
  return rows;
}
