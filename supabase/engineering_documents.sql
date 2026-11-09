-- Document Library (Engineering Tools) — run this once in the Supabase SQL editor
-- (Dashboard → SQL Editor → New query → paste → Run). Safe to run again.

-- 1. Table -------------------------------------------------------------
create table if not exists engineering_documents (
  id uuid primary key default gen_random_uuid(),
  doc_type text not null default 'Other',          -- Datasheet, Certificate, Manual, Warranty, Compliance, Other
  category text not null default 'Other Accessories', -- equipment category (same list as Equipment Inventory) or Company
  brand text,
  title text not null,
  description text,
  expiry_date date,                                -- optional: warranty end / certificate expiry
  file_path text,                                  -- path in the "engineering-documents" storage bucket
  file_url text,                                   -- OR a link to a file shipped with the app (/datasheets/..., /certifications/...)
  file_name text,
  file_size bigint,
  file_type text,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists engineering_documents_type_idx on engineering_documents (doc_type);
create index if not exists engineering_documents_category_idx on engineering_documents (category);

create or replace function engineering_documents_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists engineering_documents_set_updated_at on engineering_documents;
create trigger engineering_documents_set_updated_at
before update on engineering_documents
for each row execute function engineering_documents_set_updated_at();

-- Signed-in portal users can read, add, edit and delete documents
alter table engineering_documents enable row level security;
drop policy if exists "Signed-in users manage engineering documents" on engineering_documents;
create policy "Signed-in users manage engineering documents"
on engineering_documents for all to authenticated
using (true) with check (true);

-- 2. Private storage bucket (files are opened with short-lived signed links) --
insert into storage.buckets (id, name, public, file_size_limit)
values ('engineering-documents', 'engineering-documents', false, 52428800)
on conflict (id) do nothing;

drop policy if exists "Signed-in read engineering documents" on storage.objects;
create policy "Signed-in read engineering documents"
on storage.objects for select to authenticated
using (bucket_id = 'engineering-documents');

drop policy if exists "Signed-in upload engineering documents" on storage.objects;
create policy "Signed-in upload engineering documents"
on storage.objects for insert to authenticated
with check (bucket_id = 'engineering-documents');

drop policy if exists "Signed-in update engineering documents" on storage.objects;
create policy "Signed-in update engineering documents"
on storage.objects for update to authenticated
using (bucket_id = 'engineering-documents');

drop policy if exists "Signed-in delete engineering documents" on storage.objects;
create policy "Signed-in delete engineering documents"
on storage.objects for delete to authenticated
using (bucket_id = 'engineering-documents');

-- 3. Import the datasheets and certificates already shipped with the app ----
-- (public/datasheets and public/certifications — only files that exist).
-- Skipped automatically if any of them were imported before.
insert into engineering_documents (doc_type, category, brand, title, file_url, file_name, file_type, created_by)
select * from (values
  ('Datasheet', 'Inverters', 'Sunsynk', 'Sunsynk 8/10/12kW Hybrid', '/datasheets/sunsynk-8-10-12-3ph-hybrid.pdf', 'sunsynk-8-10-12-3ph-hybrid.pdf', 'application/pdf', 'Imported'),
  ('Datasheet', 'Inverters', 'Sunsynk', 'Sunsynk 30/35/40/50kW 3ph Hybrid', '/datasheets/sunsynk-30-35-40-50-3ph-hybrid.pdf', 'sunsynk-30-35-40-50-3ph-hybrid.pdf', 'application/pdf', 'Imported'),
  ('Datasheet', 'Inverters', 'Deye', 'Deye 70/81/100/110kW Grid Tied', '/datasheets/deye-sun-70-80-100-110-go3.pdf', 'deye-sun-70-80-100-110-go3.pdf', 'application/pdf', 'Imported'),
  ('Datasheet', 'Inverters', 'Deye', 'Deye 30/35/40/50kW Hybrid', '/datasheets/deye-sun-30-35-40-50-sg01hp3.pdf', 'deye-sun-30-35-40-50-sg01hp3.pdf', 'application/pdf', 'Imported'),
  ('Datasheet', 'Inverters', 'Sungrow', 'Sungrow 125kW Grid Tied', '/datasheets/sg125cx-p2.pdf', 'sg125cx-p2.pdf', 'application/pdf', 'Imported'),
  ('Datasheet', 'Inverters', 'Sungrow', 'Sungrow 110kW Grid Tied', '/datasheets/sg110cx.pdf', 'sg110cx.pdf', 'application/pdf', 'Imported'),
  ('Datasheet', 'Inverters', 'Sungrow', 'Sungrow 150kW Grid Tied', '/datasheets/sg150cx-p2.pdf', 'sg150cx-p2.pdf', 'application/pdf', 'Imported'),
  ('Datasheet', 'Inverters', 'Sungrow', 'Sungrow 25/30/33kW Grid Tied', '/datasheets/sg25-30-33cx-p2.pdf', 'sg25-30-33cx-p2.pdf', 'application/pdf', 'Imported'),
  ('Datasheet', 'Inverters', 'Sungrow', 'Sungrow 36/40/50kW Grid Tied', '/datasheets/sg36-40-50cx-p2.pdf', 'sg36-40-50cx-p2.pdf', 'application/pdf', 'Imported'),
  ('Datasheet', 'Inverters', 'Solis', 'Solis 100/110kW Grid Tied', '/datasheets/solis-100-110-5g-sa.pdf', 'solis-100-110-5g-sa.pdf', 'application/pdf', 'Imported'),
  ('Datasheet', 'Inverters', 'Solis', 'Solis 100/80kW Grid Tied', '/datasheets/solis-100-80-5g-sa.pdf', 'solis-100-80-5g-sa.pdf', 'application/pdf', 'Imported'),
  ('Datasheet', 'Inverters', 'Solis', 'Solis 20/50kW Grid Tied', '/datasheets/solis-25-50-5g-sa.pdf', 'solis-25-50-5g-sa.pdf', 'application/pdf', 'Imported'),
  ('Datasheet', 'Inverters', 'Atess', 'Atess PCS 100/250/500/630kW', '/datasheets/atess-pcs100-250-500-630.pdf', 'atess-pcs100-250-500-630.pdf', 'application/pdf', 'Imported'),
  ('Datasheet', 'Inverters', 'Atess', 'Atess HPS 30/50/100/120/150kW', '/datasheets/atess-hps-30-50-100-120-150.pdf', 'atess-hps-30-50-100-120-150.pdf', 'application/pdf', 'Imported'),
  ('Datasheet', 'Inverters', 'Sigen', 'Sigen 50/60/80/100/110/125kW Hybrid', '/datasheets/sigen-50-60-80-100-110-125-hybrid.pdf', 'sigen-50-60-80-100-110-125-hybrid.pdf', 'application/pdf', 'Imported'),
  ('Datasheet', 'Inverters', 'Sigen', 'Sigen 50/60/80/100/110/125kW Grid Tied', '/datasheets/sigen-50-60-80-100-110-125-grid-tied.pdf', 'sigen-50-60-80-100-110-125-grid-tied.pdf', 'application/pdf', 'Imported'),
  ('Datasheet', 'PV Modules', 'JA Solar', 'JA Solar JAM66D45 LB 595/600/605/610/615/620W', '/datasheets/jam66d45-lb-595-600-605-615-620.pdf', 'jam66d45-lb-595-600-605-615-620.pdf', 'application/pdf', 'Imported'),
  ('Datasheet', 'PV Modules', 'Jinko Solar', 'Jinko Solar 788HL4-BDV 590/595/600/605/610W', '/datasheets/jkm-590-595-600-605-610.pdf', 'jkm-590-595-600-605-610.pdf', 'application/pdf', 'Imported'),
  ('Datasheet', 'Batteries', 'Sunsynk', 'Sunsynk HV Series 61.44kWh', '/datasheets/sunsyk-hv-battery-61.44kWh.pdf', 'sunsyk-hv-battery-61.44kWh.pdf', 'application/pdf', 'Imported'),
  ('Datasheet', 'Batteries', 'Sigen', 'SigenStack 48.24-84.42 kWh', '/datasheets/sigenstack-4-5-6.pdf', 'sigenstack-4-5-6.pdf', 'application/pdf', 'Imported'),
  ('Datasheet', 'Batteries', 'Sigen', 'Sigen Energy Gateway', '/datasheets/sigen-gateway.pdf', 'sigen-gateway.pdf', 'application/pdf', 'Imported'),
  ('Datasheet', 'Batteries', 'Solar MD', 'Solar MD HV Range 114.4-243.31 kWh', '/datasheets/solar-md-hv-battery-ss7013-ss7024.pdf', 'solar-md-hv-battery-ss7013-ss7024.pdf', 'application/pdf', 'Imported'),
  ('Datasheet', 'Batteries', 'Solar MD', 'Solar MD HV Range 14.4 kWh', '/datasheets/solar-md-lv-battery-ss4143.pdf', 'solar-md-lv-battery-ss4143.pdf', 'application/pdf', 'Imported'),
  ('Datasheet', 'Batteries', 'IES', 'IES HV 114 kWh', '/datasheets/ies-hv-battery-114kwh.pdf', 'ies-hv-battery-114kwh.pdf', 'application/pdf', 'Imported'),
  ('Datasheet', 'Batteries', 'IES', 'IES HV 129 kWh', '/datasheets/ies-hv-battery-129kwh.pdf', 'ies-hv-battery-129kwh.pdf', 'application/pdf', 'Imported'),
  ('Datasheet', 'Batteries', 'IES', 'IES HV 143 kWh', '/datasheets/ies-hv-battery-143kwh.pdf', 'ies-hv-battery-143kwh.pdf', 'application/pdf', 'Imported'),
  ('Datasheet', 'Batteries', 'IES', 'IES HV 157 kWh', '/datasheets/ies-hv-battery-157kwh.pdf', 'ies-hv-battery-157kwh.pdf', 'application/pdf', 'Imported'),
  ('Datasheet', 'Batteries', 'IES', 'IES HV 200 kWh', '/datasheets/ies-hv-battery-200kwh.pdf', 'ies-hv-battery-200kwh.pdf', 'application/pdf', 'Imported'),
  ('Datasheet', 'Batteries', 'IES', 'IES HV 215 kWh', '/datasheets/ies-hv-battery-215kwh.pdf', 'ies-hv-battery-215kwh.pdf', 'application/pdf', 'Imported'),
  ('Datasheet', 'Batteries', 'IES', 'IES HV 229 kWh', '/datasheets/ies-hv-battery-229kwh.pdf', 'ies-hv-battery-229kwh.pdf', 'application/pdf', 'Imported'),
  ('Datasheet', 'Batteries', 'IES', 'IES HV 500 kWh', '/datasheets/ies-hv-battery-500kwh.pdf', 'ies-hv-battery-500kwh.pdf', 'application/pdf', 'Imported'),
  ('Datasheet', 'Meters', 'Eastron', 'Eastron SDM630', '/datasheets/eastron-sdm630.pdf', 'eastron-sdm630.pdf', 'application/pdf', 'Imported'),
  ('Datasheet', 'Meters', 'Eastron', 'Eastron SDM72CT-M', '/datasheets/eastron-sdm721ct-m.pdf', 'eastron-sdm721ct-m.pdf', 'application/pdf', 'Imported'),
  ('Datasheet', 'Meters', 'Acrel', 'Acrel Meter DTSD1352-C/1 (6)A', '/datasheets/acrel-meter-dtsd1352.pdf', 'acrel-meter-dtsd1352.pdf', 'application/pdf', 'Imported'),
  ('Datasheet', 'Other Accessories', 'Solar MD', 'Solar MD V2 Logger', '/datasheets/solar-md-v2-logger.pdf', 'solar-md-v2-logger.pdf', 'application/pdf', 'Imported'),
  ('Datasheet', 'Other Accessories', 'Sungrow', 'Sungrow EyeM4C', '/datasheets/sungrow-eyem4c.pdf', 'sungrow-eyem4c.pdf', 'application/pdf', 'Imported'),
  ('Datasheet', 'Other Accessories', 'Sungrow', 'Sungrow COM100E', '/datasheets/sungrow-com100e.pdf', 'sungrow-com100e.pdf', 'application/pdf', 'Imported'),
  ('Datasheet', 'Other Accessories', 'Nuvo', 'Nuvo Genset Kit', '/datasheets/ne-gik-100s.pdf', 'ne-gik-100s.pdf', 'application/pdf', 'Imported'),
  ('Certificate', 'Inverters', 'Sunsynk', 'Sunsynk 5/6/8/10/12/15/20/25kW NRS 097-2-1', '/certifications/sunsynk-5-8-10-12-15-20-25-nrs097.pdf', 'sunsynk-5-8-10-12-15-20-25-nrs097.pdf', 'application/pdf', 'Imported'),
  ('Certificate', 'Inverters', 'Sunsynk', 'Sunsynk HP3 30/35/40/50kW NRS 097-2-1', '/certifications/sunsynk-30-35-40-50-nrs097.pdf', 'sunsynk-30-35-40-50-nrs097.pdf', 'application/pdf', 'Imported'),
  ('Certificate', 'Inverters', 'Sungrow', 'Sungrow 33/40/50CX NRS 097-2-1', '/certifications/sugrow-cx-33-40-50-nrs097.pdf', 'sugrow-cx-33-40-50-nrs097.pdf', 'application/pdf', 'Imported'),
  ('Certificate', 'Inverters', 'Sungrow', 'Sungrow 125CX-P2 Certificate', '/certifications/sugrow-125cx-p2.pdf', 'sugrow-125cx-p2.pdf', 'application/pdf', 'Imported'),
  ('Certificate', 'Inverters', 'Sungrow', 'Sungrow 150CX Certificate', '/certifications/sugrow-150cx.pdf', 'sugrow-150cx.pdf', 'application/pdf', 'Imported'),
  ('Certificate', 'Inverters', 'Deye', 'Deye HP3 30/50kW — NRS 097-2-1', '/certifications/deye-hp3-30-50-nrs097.pdf', 'deye-hp3-30-50-nrs097.pdf', 'application/pdf', 'Imported'),
  ('Certificate', 'Inverters', 'Atess', 'Atess HPS 30/50kW — NRS 097-2-1', '/certifications/atess-hps-30-50-nrs097.pdf', 'atess-hps-30-50-nrs097.pdf', 'application/pdf', 'Imported'),
  ('Certificate', 'Inverters', 'Atess', 'Atess HPS 150/120/100kW — NRS 097-2-1', '/certifications/atess-hps-150-120-100-nrs097.pdf', 'atess-hps-150-120-100-nrs097.pdf', 'application/pdf', 'Imported'),
  ('Certificate', 'Inverters', 'Atess', 'Atess PCS 100/250/500/630kW — NRS 097-2-1', '/certifications/atess-pcs-100-250-500-630-nrs097.pdf', 'atess-pcs-100-250-500-630-nrs097.pdf', 'application/pdf', 'Imported')
) as v(doc_type, category, brand, title, file_url, file_name, file_type, created_by)
where not exists (select 1 from engineering_documents e where e.file_url = v.file_url);
