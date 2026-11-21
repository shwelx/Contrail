
create extension if not exists postgis with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create table public.aircraft_positions (
  id               bigint generated always as identity primary key,
  icao24           text not null,
  callsign         text,
  origin_country   text,
  lat              double precision not null check (lat between -90 and 90),
  lon              double precision not null check (lon between -180 and 180),
  position         extensions.geography(Point, 4326)
                     generated always as (
                       extensions.st_setsrid(extensions.st_makepoint(lon, lat), 4326)::extensions.geography
                     ) stored,
  baro_altitude_m  real,
  velocity_ms      real,
  heading_deg      real,
  vertical_rate_ms real,
  on_ground        boolean not null default false,
  observed_at      timestamptz not null,
  ingested_at      timestamptz not null default now(),
  -- The same report can arrive twice if two ingests overlap; keep one copy.
  -- This unique index also serves "history for one aircraft" queries.
  unique (icao24, observed_at)
);

create index aircraft_positions_observed_at_idx on public.aircraft_positions (observed_at desc);
create index aircraft_positions_position_idx    on public.aircraft_positions using gist (position);

-- One row per aircraft currently in the area
create table public.live_aircraft (
  icao24           text primary key,
  callsign         text,
  origin_country   text,
  lat              double precision not null check (lat between -90 and 90),
  lon              double precision not null check (lon between -180 and 180),
  position         extensions.geography(Point, 4326)
                     generated always as (
                       extensions.st_setsrid(extensions.st_makepoint(lon, lat), 4326)::extensions.geography
                     ) stored,
  baro_altitude_m  real,
  velocity_ms      real,
  heading_deg      real,
  vertical_rate_ms real,
  on_ground        boolean not null default false,
  observed_at      timestamptz not null,
  last_seen        timestamptz not null default now()
);

create index live_aircraft_position_idx  on public.live_aircraft using gist (position);
create index live_aircraft_last_seen_idx on public.live_aircraft (last_seen);

-- Watchlist
create table public.watchlist (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind       text not null check (kind in ('callsign_prefix', 'icao24', 'country')),
  value      text not null check (length(trim(value)) between 1 and 64),
  created_at timestamptz not null default now(),
  unique (user_id, kind, value)
);

create index watchlist_user_id_idx on public.watchlist (user_id);

alter table public.aircraft_positions enable row level security;
alter table public.live_aircraft      enable row level security;
alter table public.watchlist          enable row level security;

-- Flight data is read-only; the ingest function writes with the service role.
create policy "Anyone can read positions"
  on public.aircraft_positions for select
  to anon, authenticated
  using (true);

create policy "Anyone can read live aircraft"
  on public.live_aircraft for select
  to anon, authenticated
  using (true);

revoke insert, update, delete, truncate on public.aircraft_positions from anon, authenticated;
revoke insert, update, delete, truncate on public.live_aircraft      from anon, authenticated;

-- (select auth.uid()) is evaluated once per query instead of once per row.
create policy "Users read their own watchlist"
  on public.watchlist for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "Users add to their own watchlist"
  on public.watchlist for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy "Users delete from their own watchlist"
  on public.watchlist for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- Aircraft within a radius of a point, nearest first
create or replace function public.aircraft_near(
  p_lat double precision,
  p_lon double precision,
  p_radius_km double precision default 50
)
returns table (
  icao24          text,
  callsign        text,
  origin_country  text,
  lat             double precision,
  lon             double precision,
  baro_altitude_m real,
  velocity_ms     real,
  heading_deg     real,
  distance_km     double precision
)
language sql
stable
security invoker
set search_path = ''
as $$
  with here as (
    select extensions.st_setsrid(extensions.st_makepoint(p_lon, p_lat), 4326)::extensions.geography as g
  )
  select a.icao24,
         a.callsign,
         a.origin_country,
         a.lat,
         a.lon,
         a.baro_altitude_m,
         a.velocity_ms,
         a.heading_deg,
         extensions.st_distance(a.position, here.g) / 1000.0 as distance_km
  from public.live_aircraft a, here
  where extensions.st_dwithin(a.position, here.g, least(p_radius_km, 500) * 1000)
  order by distance_km;
$$;

-- Live aircraft matching the signed-in user's watchlist
create or replace function public.my_watched_aircraft()
returns setof public.live_aircraft
language sql
stable
security invoker
set search_path = ''
as $$
  select a.*
  from public.live_aircraft a
  where exists (
    select 1
    from public.watchlist w
    where w.user_id = (select auth.uid())
      and (
           (w.kind = 'icao24'          and a.icao24 = lower(w.value))
        -- starts_with, not ilike: '%' and '_' in a value are literal
        or (w.kind = 'callsign_prefix' and starts_with(upper(a.callsign), upper(w.value)))
        or (w.kind = 'country'         and lower(a.origin_country) = lower(w.value))
      )
  )
  order by a.callsign;
$$;

-- Realtime
alter publication supabase_realtime add table public.live_aircraft;

-- Drop history older than 24h, hourly. The ingest schedule is in supabase/setup/schedule.sql.
select cron.schedule(
  'prune-aircraft-positions',
  '15 * * * *',
  $$ delete from public.aircraft_positions where observed_at < now() - interval '24 hours' $$
);
