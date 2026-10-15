-- Equipment Inventory feature — run this once in the Supabase SQL editor
-- (Dashboard → SQL Editor → New query → paste → Run)

-- 1. Table -------------------------------------------------------------
create table if not exists equipment_inventory (
  id uuid primary key default gen_random_uuid(),
  category text not null default 'Other Accessories',
  name text not null,
  description text,
  technical_spec text,
  cost numeric,
  currency text not null default 'ZAR',
  datasheet_url text,
  datasheet_filename text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists equipment_inventory_category_idx on equipment_inventory (category);

-- keep updated_at current on every edit
create or replace function equipment_inventory_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists equipment_inventory_set_updated_at on equipment_inventory;
create trigger equipment_inventory_set_updated_at
before update on equipment_inventory
for each row execute function equipment_inventory_set_updated_at();

-- NOTE: RLS is left disabled on this table, matching the existing `sites` /
-- `performance` tables, which are also read/written using the anon key from
-- the app. Access to the dashboard itself is already gated by the employee
-- login check in the app.

-- 2. Storage bucket for uploaded datasheet PDFs -------------------------
insert into storage.buckets (id, name, public)
values ('equipment-datasheets', 'equipment-datasheets', true)
on conflict (id) do nothing;

drop policy if exists "Public read equipment datasheets" on storage.objects;
create policy "Public read equipment datasheets"
on storage.objects for select
using (bucket_id = 'equipment-datasheets');

drop policy if exists "Public upload equipment datasheets" on storage.objects;
create policy "Public upload equipment datasheets"
on storage.objects for insert
with check (bucket_id = 'equipment-datasheets');

drop policy if exists "Public update equipment datasheets" on storage.objects;
create policy "Public update equipment datasheets"
on storage.objects for update
using (bucket_id = 'equipment-datasheets');

drop policy if exists "Public delete equipment datasheets" on storage.objects;
create policy "Public delete equipment datasheets"
on storage.objects for delete
using (bucket_id = 'equipment-datasheets');

-- 3. Seed data — the equipment already in the datasheet catalog ---------
-- (names/categories from public/datasheets/manifest.json; cost, description
-- and technical spec are left blank for you to fill in from the new tab.
-- Two items reference datasheet files that don't actually exist in the repo
-- — "Sunsynk 5.12kWh" and "Solar MD HV Range 114.4-243.31 kWh" — so they're
-- seeded with no datasheet; just upload the correct PDF via the Add/Edit form.)
insert into equipment_inventory (category, name, datasheet_url, datasheet_filename) values
  ('Inverters', 'Sunsynk 8/10/12kW Hybrid', '/datasheets/sunsynk-8-10-12-3ph-hybrid.pdf', 'sunsynk-8-10-12-3ph-hybrid.pdf'),
  ('Inverters', 'Sunsynk 30/35/40/50kW 3ph Hybrid', '/datasheets/sunsynk-30-35-40-50-3ph-hybrid.pdf', 'sunsynk-30-35-40-50-3ph-hybrid.pdf'),
  ('Inverters', 'Deye 70/81/100/110kW Grid Tied', '/datasheets/deye-sun-70-80-100-110-go3.pdf', 'deye-sun-70-80-100-110-go3.pdf'),
  ('Inverters', 'Deye 30/35/40/50kW Hybrid', '/datasheets/deye-sun-30-35-40-50-sg01hp3.pdf', 'deye-sun-30-35-40-50-sg01hp3.pdf'),
  ('Inverters', 'Sungrow 125kW Grid Tied', '/datasheets/sg125cx-p2.pdf', 'sg125cx-p2.pdf'),
  ('Inverters', 'Sungrow 110kW Grid Tied', '/datasheets/sg110cx.pdf', 'sg110cx.pdf'),
  ('Inverters', 'Sungrow 150kW Grid Tied', '/datasheets/sg150cx-p2.pdf', 'sg150cx-p2.pdf'),
  ('Inverters', 'Sungrow 25/30/33kW Grid Tied', '/datasheets/sg25-30-33cx-p2.pdf', 'sg25-30-33cx-p2.pdf'),
  ('Inverters', 'Sungrow 36/40/50kW Grid Tied', '/datasheets/sg36-40-50cx-p2.pdf', 'sg36-40-50cx-p2.pdf'),
  ('Inverters', 'Solis 100/110kW Grid Tied', '/datasheets/solis-100-110-5g-sa.pdf', 'solis-100-110-5g-sa.pdf'),
  ('Inverters', 'Solis 100/80kW Grid Tied', '/datasheets/solis-100-80-5g-sa.pdf', 'solis-100-80-5g-sa.pdf'),
  ('Inverters', 'Solis 20/50kW Grid Tied', '/datasheets/solis-25-50-5g-sa.pdf', 'solis-25-50-5g-sa.pdf'),
  ('Inverters', 'Atess PCS 100/250/500/630kW', '/datasheets/atess-pcs100-250-500-630.pdf', 'atess-pcs100-250-500-630.pdf'),
  ('Inverters', 'Atess HPS 30/50/100/120/150kW', '/datasheets/atess-hps-30-50-100-120-150.pdf', 'atess-hps-30-50-100-120-150.pdf'),
  ('Inverters', 'Sigen 50/60/80/100/110/125kW Hybrid', '/datasheets/sigen-50-60-80-100-110-125-hybrid.pdf', 'sigen-50-60-80-100-110-125-hybrid.pdf'),
  ('Inverters', 'Sigen 50/60/80/100/110/125kW Grid Tied', '/datasheets/sigen-50-60-80-100-110-125-grid-tied.pdf', 'sigen-50-60-80-100-110-125-grid-tied.pdf'),
  ('PV Modules', 'JA Solar JAM66D45 LB 595/600/605/610/615/620W', '/datasheets/jam66d45-lb-595-600-605-615-620.pdf', 'jam66d45-lb-595-600-605-615-620.pdf'),
  ('PV Modules', 'Jinko Solar 788HL4-BDV 590/595/600/605/610W', '/datasheets/jkm-590-595-600-605-610.pdf', 'jkm-590-595-600-605-610.pdf'),
  ('Batteries', 'Sunsynk 5.12kWh', null, null),
  ('Batteries', 'Sunsynk HV Series 61.44kWh', '/datasheets/sunsyk-hv-battery-61.44kWh.pdf', 'sunsyk-hv-battery-61.44kWh.pdf'),
  ('Batteries', 'SigenStack 48.24-84.42 kWh', '/datasheets/sigenstack-4-5-6.pdf', 'sigenstack-4-5-6.pdf'),
  ('Batteries', 'Sigen Energy Gateway', '/datasheets/sigen-gateway.pdf', 'sigen-gateway.pdf'),
  ('Batteries', 'Solar MD HV Range 114.4-243.31 kWh', null, null),
  ('Batteries', 'Solar MD HV Range 14.4 kWh', '/datasheets/solar-md-lv-battery-ss4143.pdf', 'solar-md-lv-battery-ss4143.pdf'),
  ('Batteries', 'IES HV 114 kWh', '/datasheets/ies-hv-battery-114kwh.pdf', 'ies-hv-battery-114kwh.pdf'),
  ('Batteries', 'IES HV 129 kWh', '/datasheets/ies-hv-battery-129kwh.pdf', 'ies-hv-battery-129kwh.pdf'),
  ('Batteries', 'IES HV 143 kWh', '/datasheets/ies-hv-battery-143kwh.pdf', 'ies-hv-battery-143kwh.pdf'),
  ('Batteries', 'IES HV 157 kWh', '/datasheets/ies-hv-battery-157kwh.pdf', 'ies-hv-battery-157kwh.pdf'),
  ('Batteries', 'IES HV 200 kWh', '/datasheets/ies-hv-battery-200kwh.pdf', 'ies-hv-battery-200kwh.pdf'),
  ('Batteries', 'IES HV 215 kWh', '/datasheets/ies-hv-battery-215kwh.pdf', 'ies-hv-battery-215kwh.pdf'),
  ('Batteries', 'IES HV 229 kWh', '/datasheets/ies-hv-battery-229kwh.pdf', 'ies-hv-battery-229kwh.pdf'),
  ('Batteries', 'IES HV 500 kWh', '/datasheets/ies-hv-battery-500kwh.pdf', 'ies-hv-battery-500kwh.pdf'),
  ('Meters', 'Eastron SDM630', '/datasheets/eastron-sdm630.pdf', 'eastron-sdm630.pdf'),
  ('Meters', 'Eastron SDM72CT-M', '/datasheets/eastron-sdm721ct-m.pdf', 'eastron-sdm721ct-m.pdf'),
  ('Meters', 'Acrel Meter DTSD1352-C/1 (6)A', '/datasheets/acrel-meter-dtsd1352.pdf', 'acrel-meter-dtsd1352.pdf'),
  ('Other Accessories', 'Solar MD V2 Logger', '/datasheets/solar-md-v2-logger.pdf', 'solar-md-v2-logger.pdf'),
  ('Other Accessories', 'Sungrow EyeM4C', '/datasheets/sungrow-eyem4c.pdf', 'sungrow-eyem4c.pdf'),
  ('Other Accessories', 'Sungrow COM100E', '/datasheets/sungrow-com100e.pdf', 'sungrow-com100e.pdf'),
  ('Other Accessories', 'Nuvo Genset Kit', '/datasheets/ne-gik-100s.pdf', 'ne-gik-100s.pdf');
