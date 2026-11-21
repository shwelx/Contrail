-- Row Level Security tests. Run locally with: supabase test db
-- Everything happens inside a transaction that is rolled back at the end.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@test.dev'),
  ('22222222-2222-2222-2222-222222222222', 'bob@test.dev');

-- Some flight data, written as the table owner (like the ingest function)
insert into public.live_aircraft (icao24, callsign, origin_country, lat, lon, observed_at) values
  ('4baa8f', 'THY7AB', 'Turkey',  41.67, 44.95, now()),   -- near Tbilisi
  ('424321', 'AFL2650', 'Russian Federation', 43.10, 41.20, now()); -- far west

-- anon
set local role anon;
set local "request.jwt.claims" to '{"role":"anon"}';

select is(
  (select count(*)::int from public.live_aircraft), 2,
  'anon can read live aircraft'
);

select throws_ok(
  $$ insert into public.live_aircraft (icao24, lat, lon, observed_at) values ('evil01', 0, 0, now()) $$,
  '42501', null,
  'anon cannot write live aircraft'
);

select is(
  (select count(*)::int from public.watchlist), 0,
  'anon sees no watchlist rows'
);

-- alice
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

insert into public.watchlist (kind, value) values ('callsign_prefix', 'THY');

select is(
  (select count(*)::int from public.watchlist), 1,
  'alice sees her own watchlist row'
);

select is(
  (select array_agg(icao24) from public.my_watched_aircraft()), array['4baa8f'],
  'my_watched_aircraft matches alice''s callsign prefix'
);

select is(
  (select array_agg(icao24) from public.aircraft_near(41.72, 44.79, 50)), array['4baa8f'],
  'aircraft_near finds only the plane within 50 km of Tbilisi'
);

-- bob
set local "request.jwt.claims" to '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

select is(
  (select count(*)::int from public.watchlist), 0,
  'bob cannot see alice''s watchlist'
);

select throws_ok(
  $$ insert into public.watchlist (user_id, kind, value)
     values ('11111111-1111-1111-1111-111111111111', 'icao24', 'abc123') $$,
  '42501', null,
  'bob cannot add rows to alice''s watchlist'
);

delete from public.watchlist;  -- RLS should make this touch nothing
reset role;
select is(
  (select count(*)::int from public.watchlist), 1,
  'bob''s delete did not remove alice''s row'
);

select * from finish();
rollback;
