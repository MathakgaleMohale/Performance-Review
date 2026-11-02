-- Sungrow price list (effective 2026/04/01) -> Equipment Inventory
-- Run once in Supabase: Dashboard > SQL Editor > New query > paste > Run.
-- Prices are ex VAT, in ZAR. Items whose name already exists in the inventory are skipped,
-- so running it twice will not create duplicates.

insert into equipment_inventory (category, name, description, technical_spec, cost, currency)
select v.category, v.name, v.description, v.technical_spec, v.cost, 'ZAR'
from (values
  -- Residential Batteries – HV LFP (SBH)
  ('Batteries', 'Sungrow HV LFP Battery 10.00kWh 140.8V', 'Inventory ID: SG-SBH100 · Sungrow Residential Batteries · Price ex VAT, effective 2026/04/01', 'HV LFP, 10.00 kWh, 140.8 V', 29460.00),
  ('Batteries', 'Sungrow HV LFP Battery 15.00kWh 211.2V', 'Inventory ID: SG-SBH150 · Sungrow Residential Batteries · Price ex VAT, effective 2026/04/01', 'HV LFP, 15.00 kWh, 211.2 V', 44200.00),
  ('Batteries', 'Sungrow HV LFP Battery 20.00kWh 281.6V', 'Inventory ID: SG-SBH200 · Sungrow Residential Batteries · Price ex VAT, effective 2026/04/01', 'HV LFP, 20.00 kWh, 281.6 V', 58940.00),
  ('Batteries', 'Sungrow HV LFP Battery 25.00kWh 352.0V', 'Inventory ID: SG-SBH250 · Sungrow Residential Batteries · Price ex VAT, effective 2026/04/01', 'HV LFP, 25.00 kWh, 352.0 V', 73680.00),
  ('Batteries', 'Sungrow HV LFP Battery 30.00kWh 422.4V', 'Inventory ID: SG-SBH300 · Sungrow Residential Batteries · Price ex VAT, effective 2026/04/01', 'HV LFP, 30.00 kWh, 422.4 V', 88390.00),
  ('Batteries', 'Sungrow HV LFP Battery 35.00kWh 492.8V', 'Inventory ID: SG-SBH350 · Sungrow Residential Batteries · Price ex VAT, effective 2026/04/01', 'HV LFP, 35.00 kWh, 492.8 V', 103130.00),
  ('Batteries', 'Sungrow HV LFP Battery 40.00kWh 563.2V', 'Inventory ID: SG-SBH400 · Sungrow Residential Batteries · Price ex VAT, effective 2026/04/01', 'HV LFP, 40.00 kWh, 563.2 V', 117870.00),
  -- Residential Batteries – battery packages (SBR)
  ('Batteries', 'Sungrow 9.6kWh Battery Package (Includes Accessories)',  'Inventory ID: SG-SBR096 · Sungrow Residential Batteries · Price ex VAT, effective 2026/04/01', '9.6 kWh battery package, accessories included', 28970.00),
  ('Batteries', 'Sungrow 12.8kWh Battery Package (Includes Accessories)', 'Inventory ID: SG-SBR128 · Sungrow Residential Batteries · Price ex VAT, effective 2026/04/01', '12.8 kWh battery package, accessories included', 38610.00),
  ('Batteries', 'Sungrow 16.0kWh Battery Package (Includes Accessories)', 'Inventory ID: SG-SBR160 · Sungrow Residential Batteries · Price ex VAT, effective 2026/04/01', '16.0 kWh battery package, accessories included', 47250.00),
  ('Batteries', 'Sungrow 19.2kWh Battery Package (Includes Accessories)', 'Inventory ID: SG-SBR192 · Sungrow Residential Batteries · Price ex VAT, effective 2026/04/01', '19.2 kWh battery package, accessories included', 56700.00),
  ('Batteries', 'Sungrow 22.4kWh Battery Package (Includes Accessories)', 'Inventory ID: SG-SBR224 · Sungrow Residential Batteries · Price ex VAT, effective 2026/04/01', '22.4 kWh battery package, accessories included', 66150.00),
  ('Batteries', 'Sungrow 25.6kWh Battery Package (Includes Accessories)', 'Inventory ID: SG-SBR256 · Sungrow Residential Batteries · Price ex VAT, effective 2026/04/01', '25.6 kWh battery package, accessories included', 75600.00),
  -- C&I Inverters
  ('Inverters', 'Sungrow 25kW PV Inverter 1000V 3x MPPT',   'Inventory ID: SG-025CX-P2 · Sungrow C&I Inverters · Price ex VAT, effective 2026/04/01', '25 kW, 1000 V DC, 3 MPPT', 25730.00),
  ('Inverters', 'Sungrow 30kW PV Inverter 1000V 3x MPPT',   'Inventory ID: SG-030CX-P2 · Sungrow C&I Inverters · Price ex VAT, effective 2026/04/01', '30 kW, 1000 V DC, 3 MPPT', 27530.00),
  ('Inverters', 'Sungrow 33kW PV Inverter 1000V 3x MPPT',   'Inventory ID: SG-033CX-P2 · Sungrow C&I Inverters · Price ex VAT, effective 2026/04/01', '33 kW, 1000 V DC, 3 MPPT', 28590.00),
  ('Inverters', 'Sungrow 36kW PV Inverter 1000V 4x MPPT',   'Inventory ID: SG-036CX-P2 · Sungrow C&I Inverters · Price ex VAT, effective 2026/04/01', '36 kW, 1000 V DC, 4 MPPT', 30020.00),
  ('Inverters', 'Sungrow 40kW PV Inverter 1000V 4x MPPT',   'Inventory ID: SG-040CX-P2 · Sungrow C&I Inverters · Price ex VAT, effective 2026/04/01', '40 kW, 1000 V DC, 4 MPPT', 32080.00),
  ('Inverters', 'Sungrow 50kW PV Inverter 1000V 4x MPPT',   'Inventory ID: SG-050CX-P2 · Sungrow C&I Inverters · Price ex VAT, effective 2026/04/01', '50 kW, 1000 V DC, 4 MPPT', 36010.00),
  ('Inverters', 'Sungrow 125kW PV Inverter 1000V 12x MPPT', 'Inventory ID: SG-125CX-P2 · Sungrow C&I Inverters · Price ex VAT, effective 2026/04/01', '125 kW, 1000 V DC, 12 MPPT', 61810.00),
  ('Inverters', 'Sungrow 150kW PV Inverter 1000V 7x MPPT',  'Inventory ID: SG-150CX-P2 · Sungrow C&I Inverters · Price ex VAT, effective 2026/04/01', '150 kW, 1000 V DC, 7 MPPT', 75360.00),
  ('Inverters', 'Sungrow Utility String Inverter 320kW 800V', 'Inventory ID: SG-350HX-20 · Sungrow C&I Inverters · Price ex VAT, effective 2026/04/01', '320 kW utility string inverter, 800 V AC', 115530.00)
) as v(category, name, description, technical_spec, cost)
where not exists (select 1 from equipment_inventory e where e.name = v.name);
