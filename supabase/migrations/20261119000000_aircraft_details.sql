-- Registration (e.g. TC-JZS) and aircraft type (e.g. BOEING 737-800 or B738),
-- so planes without a callsign still mean something on the map.
alter table public.aircraft_positions
  add column registration  text,
  add column aircraft_type text;

alter table public.live_aircraft
  add column registration  text,
  add column aircraft_type text;
