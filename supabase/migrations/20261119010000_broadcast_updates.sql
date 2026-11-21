-- The map now gets one Realtime broadcast per ingest run (sent by the
-- ingest-flights function) instead of a message for every changed row.
alter publication supabase_realtime drop table public.live_aircraft;
