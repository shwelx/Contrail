// Pulls aircraft over New York from adsb.fi, adsb.lol and OpenSky at the same
// time, merges them, and writes them to the database. Each network has its
// own receivers, so together they see more planes than any one alone.
// pg_cron calls this every minute (supabase/setup/schedule.sql).
//
// verify_jwt is off for this function (supabase/config.toml). Access is
// checked with the x-cron-secret header instead.

import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { type AircraftRow, mergeRows, SOURCES, toRows } from "../_shared/adsb.ts";
import { fromOpenSky, OPENSKY_TOKEN_URL, OPENSKY_URL } from "./opensky.ts";

const STALE_AFTER_MINUTES = 10; // drop planes from the map after this
// ~500 planes a minute is a lot of rows: history keeps one position every
// 3 minutes (about 80 MB a day) while the live table updates every minute.
const HISTORY_EVERY_MINUTES = 3;
const FETCH_TIMEOUT_MS = 8_000; // sources run in parallel; pg_net gives up after 15s

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function getJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const res = await fetch(url, {
    headers: { "User-Agent": "contrail-flight-map", ...headers },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    await res.body?.cancel();
    throw new HttpError(res.status, `HTTP ${res.status}`);
  }
  return await res.json();
}

// OpenSky needs OPENSKY_CLIENT_ID and OPENSKY_CLIENT_SECRET (an API client
// from your opensky-network.org account page).
let openskyToken: { value: string; expiresAt: number } | null = null;
async function openskyHeaders(): Promise<Record<string, string>> {
  const id = Deno.env.get("OPENSKY_CLIENT_ID");
  const secret = Deno.env.get("OPENSKY_CLIENT_SECRET");
  if (!id || !secret) return {};
  if (!openskyToken || openskyToken.expiresAt < Date.now() + 60_000) {
    const res = await fetch(OPENSKY_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: id, client_secret: secret }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new HttpError(res.status, `token HTTP ${res.status}`);
    const body = await res.json();
    openskyToken = { value: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 1800) * 1000 };
  }
  return { Authorization: `Bearer ${openskyToken.value}` };
}

const FETCHERS: { name: string; run: () => Promise<AircraftRow[]> }[] = [
  ...SOURCES.map(({ name, url }) => ({
    name,
    run: async () => toRows(await getJson(url) as Parameters<typeof toRows>[0]),
  })),
  // Anonymous requests from Supabase just time out, so only with an account.
  ...(Deno.env.get("OPENSKY_CLIENT_ID") ? [{
    name: "opensky",
    run: async () => fromOpenSky(await getJson(OPENSKY_URL, await openskyHeaders()) as Parameters<typeof fromOpenSky>[0]),
  }] : []),
];

// One Realtime broadcast per run tells open maps to reload, instead of one
// message per changed row (hundreds a minute here). Failing to announce
// isn't fatal: pages fall back to polling.
async function announce(count: number) {
  try {
    await fetch(`${Deno.env.get("SUPABASE_URL")}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify({ messages: [{ topic: "live", event: "update", payload: { count }, private: true }] }),
      signal: AbortSignal.timeout(3_000),
    });
  } catch (err) {
    console.error("announce failed", describe(err));
  }
}

function describe(err: unknown): string {
  if (err instanceof DOMException && err.name === "TimeoutError") return "timed out";
  return err instanceof Error ? err.message : String(err);
}

// Ask every source at once. Returns the merged rows plus, per source, either
// how many planes it saw or why it failed. Only throws if all of them failed.
async function fetchAircraft() {
  const results = await Promise.allSettled(FETCHERS.map((f) => f.run()));
  const sources: Record<string, number | string> = {};
  const lists: AircraftRow[][] = [];
  results.forEach((r, i) => {
    const name = FETCHERS[i].name;
    if (r.status === "fulfilled") { sources[name] = r.value.length; lists.push(r.value); }
    else sources[name] = describe(r.reason);
  });
  if (lists.length === 0) {
    const allRateLimited = results.every((r) => r.status === "rejected" && r.reason instanceof HttpError && r.reason.status === 429);
    const why = Object.entries(sources).map(([k, v]) => `${k}: ${v}`).join("; ");
    throw new HttpError(allRateLimited ? 429 : 502, `all sources failed (${why})`);
  }
  return { rows: mergeRows(lists), sources };
}

// constant-time compare
function sameSecret(given: string | null, expected: string): boolean {
  const a = new TextEncoder().encode(given ?? "");
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) diff |= (a[i] ?? 0) ^ b[i];
  return diff === 0;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret) return json({ error: "CRON_SECRET is not set" }, 500);
  if (!sameSecret(req.headers.get("x-cron-secret"), secret)) return json({ error: "Forbidden" }, 403);

  try {
    // Runs first so planes still expire when every source is down.
    const cutoff = new Date(Date.now() - STALE_AFTER_MINUTES * 60_000).toISOString();
    const { count: removed, error: staleError } = await supabase
      .from("live_aircraft")
      .delete({ count: "exact" })
      .lt("last_seen", cutoff);
    if (staleError) throw new Error(`stale cleanup: ${staleError.message}`);

    const { rows, sources } = await fetchAircraft();

    const keepHistory = new Date().getUTCMinutes() % HISTORY_EVERY_MINUTES === 0;
    if (rows.length > 0 && keepHistory) {
      const { error: historyError } = await supabase
        .from("aircraft_positions")
        .upsert(rows, { onConflict: "icao24,observed_at", ignoreDuplicates: true });
      if (historyError) throw new Error(`aircraft_positions: ${historyError.message}`);
    }

    if (rows.length > 0) {
      const now = new Date().toISOString();
      const { error: liveError } = await supabase
        .from("live_aircraft")
        .upsert(rows.map((r) => ({ ...r, last_seen: now })), { onConflict: "icao24" });
      if (liveError) throw new Error(`live_aircraft: ${liveError.message}`);
    }

    await announce(rows.length);

    const result = { stored: rows.length, removed: removed ?? 0, history: keepHistory, sources };
    console.log("ingest ok", result);
    return json(result);
  } catch (err) {
    let status = 500;
    if (err instanceof HttpError) status = err.status;
    const message = err instanceof Error ? err.message : String(err);
    console.error("ingest failed", message);
    return json({ error: message }, status);
  }
});
