// Live planes around any point, for when the map is away from New York.
// Nothing is stored. The browser can't call adsb.fi itself (no CORS), so this
// passes the request through.
//
// GET /functions/v1/planes-near?lat=48.85&lon=2.35

import { toRows, WORLD } from "../_shared/adsb.ts";

const RADIUS_NM = 250; // the most the APIs allow, about 460 km across
const CACHE_MS = 15_000;

// Requests are snapped to a 1° grid so everyone looking at roughly the same
// place shares one upstream call; adsb.fi allows one request a second.
const cache = new Map<string, { at: number; body: string }>();

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
};

function reply(body: string, status = 200) {
  return new Response(body, { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

async function fetchFirst(urls: string[]) {
  let last = "";
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "contrail-flight-map" }, signal: AbortSignal.timeout(6_000) });
      if (res.ok) return await res.json();
      last = `HTTP ${res.status}`;
      await res.body?.cancel();
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
  }
  throw new Error(last);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const params = new URL(req.url).searchParams;
  const lat = Number(params.get("lat"));
  const lon = Number(params.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 85 || Math.abs(lon) > 180) {
    return reply(JSON.stringify({ error: "lat and lon are required" }), 400);
  }

  const glat = Math.round(lat);
  const glon = Math.round(lon);
  const key = `${glat},${glon}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return reply(hit.body);

  try {
    const body = await fetchFirst([
      `https://opendata.adsb.fi/api/v2/lat/${glat}/lon/${glon}/dist/${RADIUS_NM}`,
      `https://api.adsb.lol/v2/point/${glat}/${glon}/${RADIUS_NM}`,
    ]);
    const json = JSON.stringify({ planes: toRows(body, WORLD) });
    cache.set(key, { at: Date.now(), body: json });
    if (cache.size > 500) cache.delete(cache.keys().next().value!);
    return reply(json);
  } catch (err) {
    return reply(JSON.stringify({ error: `flight data unavailable (${err instanceof Error ? err.message : err})` }), 502);
  }
});
