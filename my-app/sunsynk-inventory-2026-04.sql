-- Sunsynk price list (effective 2026/04/01) -> Equipment Inventory
-- Run once in Supabase: Dashboard > SQL Editor > New query > paste > Run.
-- Prices are ex VAT, in ZAR. Items whose name already exists in the inventory are skipped,
-- so running it twice will not create duplicates.

insert into equipment_inventory (category, name, description, technical_spec, cost, currency)
select v.category, v.name, v.description, v.technical_spec, v.cost, 'ZAR'
from (values
  -- LV Inverters
  ('Inverters', 'Sunsynk 3.6kW 1P Hybrid PV Inverter 48V C/W WiFi Dongle IP65',  'Inventory ID: SS-1P-03K-H-LV · Sunsynk LV Inverters · Price ex VAT, effective 2026/04/01', '3.6 kW, single-phase, hybrid, 48 V battery, IP65, WiFi dongle', 12000.00),
  ('Inverters', 'Sunsynk 10kW 1P Hybrid PV Inverter 48V C/W WiFi Dongle IP65',   'Inventory ID: SS-1P-10K-H-LV · Sunsynk LV Inverters · Price ex VAT, effective 2026/04/01', '10 kW, single-phase, hybrid, 48 V battery, IP65, WiFi dongle', 20000.00),
  ('Inverters', 'Sunsynk 16kW 1P Hybrid PV Inverter 48V C/W WiFi Dongle IP65',   'Inventory ID: SS-1P-16K-H-LV · Sunsynk LV Inverters · Price ex VAT, effective 2026/04/01', '16 kW, single-phase, hybrid, 48 V battery, IP65, WiFi dongle', 30000.00),
  ('Inverters', 'Sunsynk 7.6kW 1P Hybrid PV Inverter 48V Rack Mount',            'Inventory ID: SS-1P-RM-7.6K-H-LV · Sunsynk LV Inverters · Price ex VAT, effective 2026/04/01', '7.6 kW, single-phase, hybrid, 48 V battery, rack mount', 8000.00),
  ('Inverters', 'Sunsynk 12kW 3P Hybrid PV Inverter 48V C/W WiFi Dongle IP65',   'Inventory ID: SS-3P-12K-H-LV · Sunsynk LV Inverters · Price ex VAT, effective 2026/04/01', '12 kW, three-phase, hybrid, 48 V battery, IP65, WiFi dongle', 33000.00),
  -- HV Inverters
  ('Inverters', 'Sunsynk 25kW 3P Hybrid PV Inverter HV C/W WiFi Dongle IP65',    'Inventory ID: SS-3P-25K-H-HV · Sunsynk HV Inverters · Price ex VAT, effective 2026/04/01', '25 kW, three-phase, hybrid, HV battery, IP65, WiFi dongle', 25000.00),
  -- All-In-One Units
  ('Inverters', 'Sunsynk Powerlynk X 3.6kW Inverter / 3.84kWh Battery Pack',     'Inventory ID: SS-POW-X · Sunsynk All-In-One Units · Price ex VAT, effective 2026/04/01', '3.6 kW inverter + 3.84 kWh battery, all-in-one', 12000.00),
  ('Inverters', 'Sunsynk 3kW Solar Power Converter',                             'Inventory ID: SS-SPC-3KW · Sunsynk All-In-One Units · Price ex VAT, effective 2026/04/01', '3 kW solar power converter', 3000.00),
  -- LV Batteries
  ('Batteries', 'Sunsynk Battery LFP Wall Mount 5.32kWh 51.2V',                  'Inventory ID: SS-BAT-05K-WM-LFP · Sunsynk LV Batteries · Price ex VAT, effective 2026/04/01', 'LFP, wall mount, 5.32 kWh, 51.2 V', 115000.00),
  ('Batteries', 'Sunsynk Battery LFP Wall Mount 10.24kWh 51.2V',                 'Inventory ID: SS-BAT-10K-WM-LFP-10.24 · Sunsynk LV Batteries · Price ex VAT, effective 2026/04/01', 'LFP, wall mount, 10.24 kWh, 51.2 V', 36000.00),
  -- Powerhub
  ('Batteries', 'Sunsynk Powerhub 50kW & 60kWh Storage System incl AC & FS',     'Inventory ID: SS-PH-GE-F60 · Sunsynk Powerhub · Price ex VAT, effective 2026/04/01', '50 kW / 60 kWh storage system, incl. AC & fire suppression', 180000.00),
  ('Batteries', 'Sunsynk Powerhub 50kW & 120kWh Storage System incl AC & FS',    'Inventory ID: SS-PH-GE-F120 · Sunsynk Powerhub · Price ex VAT, effective 2026/04/01', '50 kW / 120 kWh storage system, incl. AC & fire suppression', 360000.00),
  -- Sunsynk Contour
  ('Batteries', 'Sunsynk Contour 1kW, 1kWh',                                     'Inventory ID: SS-CONTOUR-1K · Sunsynk Contour · Price ex VAT, effective 2026/04/01', '1 kW / 1 kWh', 6000.00),
  ('Batteries', 'Sunsynk Contour 1kW, 2kWh',                                     'Inventory ID: SS-CONTOUR-2K · Sunsynk Contour · Price ex VAT, effective 2026/04/01', '1 kW / 2 kWh', 9000.00)
) as v(category, name, description, technical_spec, cost)
where not exists (select 1 from equipment_inventory e where e.name = v.name);
