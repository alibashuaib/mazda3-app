-- Demo seed of PENDING proposals for the admin review queue.
-- MANUAL owner seed: run in the Supabase SQL editor, or `psql -f`, as the table
-- owner AFTER schema.sql. NOT part of CI (it lives outside supabase/tests).
-- The target is a DRAFT car ('demo:seed'), so approving these rows never
-- changes what the public sees (read_car_models only exposes approved cars).
-- Re-running wipes and recreates the demo rows only. The last statement moves
-- the Cabin Filter live value so its proposal goes stale when approved.
begin;

delete from public.change_log where car_model_id = 'demo:seed';
delete from public.proposals where car_model_id = 'demo:seed';

insert into public.car_models (id, model, generation, engine, status)
values ('demo:seed', 'Demo', 'Seed', '2.0', 'draft')
on conflict (id) do update set status = 'draft';

insert into public.dealer_plan_items (car_model_id, service, interval_km, interval_months) values
  ('demo:seed', 'Engine Oil', 10000, 12),
  ('demo:seed', 'Cabin Filter', 20000, 24),
  ('demo:seed', 'Brake Fluid', 40000, 24)
on conflict (car_model_id, service) do update
  set interval_km = excluded.interval_km, interval_months = excluded.interval_months, note = '', parts = '[]';

-- High: official, two hosts, small change.
select public.submit_proposal('schedule_item', 'demo:seed', 'Engine Oil',
  $j${"interval_km":12000,"interval_months":12,"note":"","parts":[]}$j$::jsonb,
  $j$[{"url":"https://owners.example.com/manual.pdf","tier":"official","fetched_at":"2026-11-01T00:00:00Z","content_hash":"a1","quote":"Replace engine oil every 12000 km or 12 months."},
      {"url":"https://dealer.example.org/plan","tier":"official","fetched_at":"2026-11-01T00:00:00Z","content_hash":"a2","quote":"Engine oil and filter: 12000 km / 12 months."}]$j$::jsonb,
  101, 'Official schedule differs from live value', 'mazda');

-- Medium/low: single secondary source, large change.
select public.submit_proposal('schedule_item', 'demo:seed', 'Cabin Filter',
  $j${"interval_km":30000,"interval_months":24,"note":"","parts":[]}$j$::jsonb,
  $j$[{"url":"https://garage.example.net/guide","tier":"secondary","fetched_at":"2026-11-01T00:00:00Z","content_hash":"b1","quote":"Cabin filter every 30000 km."}]$j$::jsonb,
  101, 'Secondary source suggests a longer interval', 'mazda');

-- Low: community note change.
select public.submit_proposal('schedule_item', 'demo:seed', 'Brake Fluid',
  $j${"interval_km":40000,"interval_months":24,"note":"Use DOT 4 fluid","parts":[]}$j$::jsonb,
  $j$[{"url":"https://forum.example.com/thread/42","tier":"community","fetched_at":"2026-11-01T00:00:00Z","content_hash":"c1","quote":"Everyone here uses DOT 4 and changes it every two years."}]$j$::jsonb,
  102, 'Community note about fluid type', 'mazda');

-- Newer value for the same target (CORE-04): submitting this makes the 40000
-- proposal above 'superseded', so the owner sees only this pending one.
select public.submit_proposal('schedule_item', 'demo:seed', 'Brake Fluid',
  $j${"interval_km":30000,"interval_months":24,"note":"Use DOT 4 fluid","parts":[]}$j$::jsonb,
  $j$[{"url":"https://forum.example.com/thread/42","tier":"community","fetched_at":"2026-11-01T00:00:00Z","content_hash":"c2","quote":"Two years or 30000 km, whichever comes first."}]$j$::jsonb,
  102, 'Newer community figure', 'mazda');

-- Insert of a service that has no live row yet.
select public.submit_proposal('schedule_item', 'demo:seed', 'Spark Plugs',
  $j${"interval_km":60000,"interval_months":48,"note":"Iridium plugs","parts":[{"name":"Spark plug","part_no":"PE5R-18-110","qty":4}]}$j$::jsonb,
  $j$[{"url":"https://owners.example.com/manual.pdf","tier":"official","fetched_at":"2026-11-01T00:00:00Z","content_hash":"d1","quote":"Replace spark plugs every 60000 km or 48 months."}]$j$::jsonb,
  102, 'Official manual lists a spark plug interval', 'mazda');

-- Injection demo: the UI must show this as inert text.
select public.submit_proposal('schedule_item', 'demo:seed', 'Wiper Blades',
  $j${"interval_km":null,"interval_months":12,"note":"<img src=x onerror=\"alert(1)\">","parts":[]}$j$::jsonb,
  $j$[{"url":"https://forum.example.com/thread/99","tier":"community","fetched_at":"2026-11-01T00:00:00Z","content_hash":"e1","quote":"<img src=x onerror=\"alert(1)\">"}]$j$::jsonb,
  102, '<img src=x onerror="alert(1)">', 'mazda');

-- Make the Cabin Filter proposal stale: its live value moves after it was written.
update public.dealer_plan_items set interval_km = 25000
where car_model_id = 'demo:seed' and service = 'Cabin Filter';

commit;
