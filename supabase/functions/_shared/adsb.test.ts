// deno test supabase/functions/
import { assertEquals } from "jsr:@std/assert@1";
import { type Aircraft, mergeRows, toRow, toRows } from "./adsb.ts";
import { fromOpenSky, type StateVector } from "../ingest-flights/opensky.ts";
import { countryFromIcao24 } from "./countries.ts";

const NOW = 1_795_007_207_004;

function plane(extra: Partial<Aircraft> = {}): Aircraft {
  return {
    hex: "4BAA8F", flight: "THY7AB  ", r: "TC-JZS", desc: "BOEING 737-800", lat: 40.64, lon: -73.78,
    alt_baro: 35000, gs: 450, track: 87.2, baro_rate: -1000, seen_pos: 2,
    ...extra,
  };
}

Deno.test("maps a normal aircraft and converts units", () => {
  const row = toRow(plane(), NOW)!;
  assertEquals(row.icao24, "4baa8f");
  assertEquals(row.callsign, "THY7AB");
  assertEquals(row.origin_country, "Turkey");
  assertEquals(row.baro_altitude_m, 10668);
  assertEquals(row.velocity_ms, 231.5);
  assertEquals(row.vertical_rate_ms, -5.08);
  assertEquals(row.heading_deg, 87.2);
  assertEquals(row.on_ground, false);
  assertEquals(row.observed_at, new Date(NOW - 2000).toISOString());
});

Deno.test("ground means on_ground with zero altitude", () => {
  const row = toRow(plane({ alt_baro: "ground" }), NOW)!;
  assertEquals(row.on_ground, true);
  assertEquals(row.baro_altitude_m, 0);
});

Deno.test("skips aircraft without a position or outside the box", () => {
  assertEquals(toRow(plane({ lat: undefined }), NOW), null);
  assertEquals(toRow(plane({ lat: 50 }), NOW), null);
  assertEquals(toRow(plane({ lon: -80 }), NOW), null);
});

Deno.test("skips non-ICAO addresses", () => {
  assertEquals(toRow(plane({ hex: "~1a2b3c" }), NOW), null);
});

Deno.test("missing fields become null", () => {
  const row = toRow(plane({ flight: "   ", alt_baro: undefined, gs: undefined, track: undefined }), NOW)!;
  assertEquals(row.callsign, null);
  assertEquals(row.baro_altitude_m, null);
  assertEquals(row.velocity_ms, null);
  assertEquals(row.heading_deg, null);
});

Deno.test("keeps only the newest report per aircraft", () => {
  const rows = toRows({
    now: NOW,
    ac: [plane({ seen_pos: 30, lat: 41.0 }), plane({ seen_pos: 1, lat: 42.0 }), plane({ hex: "514004" })],
  });
  assertEquals(rows.length, 2);
  assertEquals(rows.find((r) => r.icao24 === "4baa8f")!.lat, 42.0);
});

Deno.test("reads adsb.fi's format (aircraft list, now in seconds)", () => {
  const rows = toRows({ now: NOW / 1000, aircraft: [plane({ seen_pos: 2 })] });
  assertEquals(rows.length, 1);
  assertEquals(rows[0].observed_at, new Date(NOW - 2000).toISOString());
});

Deno.test("handles an empty sky", () => {
  assertEquals(toRows({ now: NOW, ac: null }), []);
});

Deno.test("country lookup", () => {
  assertEquals(countryFromIcao24("514004"), "Georgia");
  assertEquals(countryFromIcao24("151fc3"), "Russia");
  assertEquals(countryFromIcao24("789123"), "Hong Kong"); // inside China's block, smaller one wins
  assertEquals(countryFromIcao24("780123"), "China");
  assertEquals(countryFromIcao24("a84e68"), "United States");
  assertEquals(countryFromIcao24("zzzzzz"), null);
});

Deno.test("keeps registration and type, falling back to the type code", () => {
  const row = toRow(plane(), NOW)!;
  assertEquals(row.registration, "TC-JZS");
  assertEquals(row.aircraft_type, "BOEING 737-800");
  assertEquals(toRow(plane({ desc: undefined, t: "B738" }), NOW)!.aircraft_type, "B738");
});

Deno.test("merge keeps the newest position and fills gaps from older reports", () => {
  const older = toRow(plane({ seen_pos: 20, lat: 41.0 }), NOW)!;
  const newer = { ...toRow(plane({ seen_pos: 1, lat: 42.0 }), NOW)!, callsign: null, aircraft_type: null };
  const other = toRow(plane({ hex: "514004" }), NOW)!;
  const rows = mergeRows([[older, other], [newer]]);
  assertEquals(rows.length, 2);
  const m = rows.find((r) => r.icao24 === "4baa8f")!;
  assertEquals(m.lat, 42.0);
  assertEquals(m.callsign, "THY7AB");
  assertEquals(m.aircraft_type, "BOEING 737-800");
});

Deno.test("reads OpenSky state vectors", () => {
  const T = NOW / 1000;
  const s = (o: Partial<Record<number, unknown>>) => {
    const v: unknown[] = ["4BAA8F", "THY7AB  ", "Turkey", T - 5, T - 2, -73.78, 40.64, 10668, false, 230.5, 87.2, 0];
    for (const [i, x] of Object.entries(o)) v[Number(i)] = x;
    return v as StateVector;
  };
  const rows = fromOpenSky({ time: T, states: [s({}), s({ 0: "abc123", 6: null }), s({ 0: "abc124", 6: 50 })] });
  assertEquals(rows.length, 1);
  assertEquals(rows[0].icao24, "4baa8f");
  assertEquals(rows[0].callsign, "THY7AB");
  assertEquals(rows[0].origin_country, "Turkey");
  assertEquals(rows[0].observed_at, new Date((T - 5) * 1000).toISOString());
});
