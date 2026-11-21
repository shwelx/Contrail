-- The "live" update channel is private: anyone may listen, but only the
-- ingest function (service role, which bypasses RLS) may send. Without this,
-- any visitor could broadcast fake updates and make every open map reload.
create policy "Anyone can listen to live updates"
  on realtime.messages for select
  to anon, authenticated
  using (realtime.topic() = 'live' and realtime.messages.extension = 'broadcast');
