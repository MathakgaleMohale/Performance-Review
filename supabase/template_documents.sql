-- Editable templates + completed reports – run once in the Supabase SQL Editor
-- (Dashboard → SQL Editor → New query → paste everything → Run)
-- Needs engineering_templates.sql to have been run first.

-- 1. Editable template content ------------------------------------------
alter table engineering_templates add column if not exists content_html text;

-- 2. Completed reports (filled-in copies, saved per site) ----------------
create table if not exists template_reports (
  id uuid primary key default gen_random_uuid(),
  template_id uuid references engineering_templates(id) on delete set null,
  template_name text,
  title text not null,
  site_name text,
  report_date date,
  status text not null default 'Draft',
  content_html text,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists template_reports_site_idx on template_reports (site_name);
create index if not exists template_reports_template_idx on template_reports (template_id);

create or replace function template_reports_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists template_reports_set_updated_at on template_reports;
create trigger template_reports_set_updated_at
before update on template_reports
for each row execute function template_reports_set_updated_at();

alter table template_reports enable row level security;
drop policy if exists "Signed-in users manage reports" on template_reports;
create policy "Signed-in users manage reports"
on template_reports for all to authenticated using (true) with check (true);

-- 3. Photos inserted into documents (public links so Word/PDF can embed them, 10 MB each)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('template-images', 'template-images', true, 10485760, array['image/png','image/jpeg','image/gif','image/webp'])
on conflict (id) do update set public = true, file_size_limit = 10485760;

drop policy if exists "Read template images" on storage.objects;
create policy "Read template images" on storage.objects for select using (bucket_id = 'template-images');
drop policy if exists "Signed-in upload template images" on storage.objects;
create policy "Signed-in upload template images" on storage.objects for insert to authenticated with check (bucket_id = 'template-images');
drop policy if exists "Signed-in delete template images" on storage.objects;
create policy "Signed-in delete template images" on storage.objects for delete to authenticated using (bucket_id = 'template-images');

-- 4. First editable template: Site Inspection (from 250217_Site Visit Template.docx)
insert into engineering_templates (category, name, description, version, content_html, created_by, updated_by)
select 'Site & O&M', 'Site Inspection', 'Pre-design site visit: project details, preparation checklist, AC reticulation, PV installation, communication and construction logistics.', 'Rev 00',
$tpl$<h1>Site Inspection</h1>
<p><strong>Project name:</strong> </p>
<p><strong>Date of inspection:</strong> </p>
<p><strong>Inspected by:</strong> </p>
<h3>Legend</h3><p>SSE – Sosimple Energy</p>
<h2>PROJECT DETAILS</h2>
<table><tbody><tr><th colwidth="514"><p>Items</p></th><th colwidth="316"><p>Details</p></th></tr><tr><td colwidth="514"><p>1. Client / Project Name</p></td><td colwidth="316"><p></p></td></tr><tr><td colwidth="514"><p>2. Project NO</p></td><td colwidth="316"><p></p></td></tr><tr><td colwidth="514"><p>3. Site Address</p></td><td colwidth="316"><p></p></td></tr><tr><td colwidth="514"><p>4. Project Size</p></td><td colwidth="316"><p></p></td></tr><tr><td colwidth="514"><p>5. Municipal or Eskom</p></td><td colwidth="316"><p></p></td></tr><tr><td colwidth="514"><p>6. Meter/Pole number</p></td><td colwidth="316"><p></p></td></tr><tr><td colwidth="514"><p>7. HV/LV connection</p></td><td colwidth="316"><p></p></td></tr><tr><td colwidth="514"><p>8. SSE Representative</p></td><td colwidth="316"><p></p></td></tr><tr><td colwidth="514"><p>9. Installer Representative</p></td><td colwidth="316"><p></p></td></tr><tr><td colwidth="514"><p>10. Customer Representative</p></td><td colwidth="316"><p></p></td></tr></tbody></table>
<h2>PREPARATION CHECKLIST</h2>
<table><tbody><tr><th colwidth="740"><p>Items</p></th><th colwidth="90"><p>Tick</p></th></tr><tr><td colwidth="740"><p>1. Enquire on access requirements.</p></td><td colwidth="90"><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p></p></li></ul></td></tr><tr><td colwidth="740"><p>2. Enquire on PPE requirements.</p></td><td colwidth="90"><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p></p></li></ul></td></tr><tr><td colwidth="740"><p>3. Confirm main breaker size (for CTs to take readings).</p></td><td colwidth="90"><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p></p></li></ul></td></tr><tr><td colwidth="740"><p>4. Arrange access to relevant parts of the facility.</p></td><td colwidth="90"><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p></p></li></ul></td></tr><tr><td colwidth="740"><p>5. Obtain and Print Roof Drawing.</p></td><td colwidth="90"><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p></p></li></ul></td></tr><tr><td colwidth="740"><p>6. Obtain and Print SLD.</p></td><td colwidth="90"><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p></p></li></ul></td></tr><tr><td colwidth="740"><p>7. Print Google Earth Image of Roof.</p></td><td colwidth="90"><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p></p></li></ul></td></tr><tr><td colwidth="740"><p>8. Print Helioscope Design.</p></td><td colwidth="90"><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p></p></li></ul></td></tr><tr><td colwidth="740"><p>9. Print Site Inspection Checklist.</p></td><td colwidth="90"><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p></p></li></ul></td></tr><tr><td colwidth="740"><p>10. Meter to take load readings.</p></td><td colwidth="90"><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p></p></li></ul></td></tr><tr><td colwidth="740"><p>11. Measuring Tape.</p></td><td colwidth="90"><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p></p></li></ul></td></tr><tr><td colwidth="740"><p>12. Drone &amp; Camera.</p></td><td colwidth="90"><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p></p></li></ul></td></tr><tr><td colwidth="740"><p>13. Ladder.</p></td><td colwidth="90"><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p></p></li></ul></td></tr><tr><td colwidth="740"><p>14. PPE.</p></td><td colwidth="90"><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p></p></li></ul></td></tr></tbody></table>
<h2>AC RETICULATION INSPECTION</h2>
<table><tbody><tr><th colwidth="830"><p>Draw a freehand SLD of the existing electrical Reticulation from the council supply to load supply point.</p></th></tr><tr><td colwidth="830"><p></p><p></p><p></p><p></p><p></p><p></p><p></p><p></p><p></p><p></p><p></p><p></p></td></tr></tbody></table>
<table><tbody><tr><th colwidth="415"><p>Items</p></th><th colwidth="207"><p>Reading</p></th><th colwidth="207"><p>Capture Photo</p></th></tr><tr><td colwidth="415"><p>1. Size of the main Breaker Size.</p></td><td colwidth="207"><p></p></td><td colwidth="207"><p></p></td></tr><tr><td colwidth="415"><p>2. ATS input breaker size.</p></td><td colwidth="207"><p></p></td><td colwidth="207"><p></p></td></tr><tr><td colwidth="415"><p>3. ATS output breaker size.</p></td><td colwidth="207"><p></p></td><td colwidth="207"><p></p></td></tr><tr><td colwidth="415"><p>4. Generator size (kVa) and PF.</p></td><td colwidth="207"><p></p></td><td colwidth="207"><p></p></td></tr><tr><td colwidth="415"><p>5. Transformer size (kVa).</p></td><td colwidth="207"><p></p></td><td colwidth="207"><p></p></td></tr><tr><td colwidth="415"><p>6. Indicate the position of the existing meter (s) on the SLD draft.</p></td><td colwidth="207"><p>N/A</p></td><td colwidth="207"><p>N/A</p></td></tr><tr><td colwidth="415"><p>7. Indicate a suitable tie-in point on the SLD draft.</p></td><td colwidth="207"><p>N/A</p></td><td colwidth="207"><p>N/A</p></td></tr><tr><td colwidth="415"><p>8. Clear photo of the Main DB and ATS.</p></td><td colwidth="207"><p></p></td><td colwidth="207"><p></p></td></tr></tbody></table>
<table><tbody><tr><th colwidth="514"><p>Items</p></th><th colwidth="316"><p>Comment</p></th></tr><tr><td colspan="2" colwidth="514,316"><p><strong>Use the printed Google Map to draw and indicate the positions of the following:</strong></p></td></tr><tr><td colwidth="514"><p>1. The Main DB.</p></td><td colwidth="316"><p></p></td></tr><tr><td colwidth="514"><p>2. The ATS DB.</p></td><td colwidth="316"><p></p></td></tr><tr><td colwidth="514"><p>3. The generator.</p></td><td colwidth="316"><p></p></td></tr><tr><td colwidth="514"><p>4. The proposed inverter(S) location (S).</p></td><td colwidth="316"><p></p></td></tr><tr><td colwidth="514"><p>5. The proposed AC &amp; DB location (S).</p></td><td colwidth="316"><p></p></td></tr><tr><td colspan="2" colwidth="514,316"><p><strong>Measure the distance between the following:</strong></p></td></tr><tr><td colwidth="514"><p>6. Proposed tie-in point and AC combiner box.</p></td><td colwidth="316"><p></p></td></tr><tr><td colwidth="514"><p>7. AC combiner box and Inverter.</p></td><td colwidth="316"><p></p></td></tr><tr><td colwidth="514"><p>8. DC combiner box and Inverter.</p></td><td colwidth="316"><p></p></td></tr><tr><td colwidth="514"><p>9. DC combiner box and PV arrays.</p></td><td colwidth="316"><p></p></td></tr><tr><td colspan="2" colwidth="514,316"><p><strong>Proposed method of Installation (Steel tray/Free Air/ PVC trunking/ Trench/etc):</strong></p></td></tr><tr><td colwidth="514"><p>10. From Tie-point and AC combiner Box.</p></td><td colwidth="316"><p></p></td></tr><tr><td colwidth="514"><p>11. From AC combiner to Inverter.</p></td><td colwidth="316"><p></p></td></tr><tr><td colwidth="514"><p>12. From PV Modules to DC Combiner Box.</p></td><td colwidth="316"><p></p></td></tr><tr><td colwidth="514"><p>13. From DC Combiner box to Inverter.</p></td><td colwidth="316"><p></p></td></tr></tbody></table>
<h2>PV INSTALLATION INSPECTION</h2>
<table><tbody><tr><th colwidth="514"><p>Items</p></th><th colwidth="316"><p>Comment</p></th></tr><tr><td colspan="2" colwidth="514,316"><p><strong>Use the printed Google Maps View to highlight the following:</strong></p></td></tr><tr><td colwidth="514"><p>1. Identify all obstructions and their dimensions.</p></td><td colwidth="316"><p></p></td></tr><tr><td colwidth="514"><p>2. Identify all shading areas.</p></td><td colwidth="316"><p></p></td></tr><tr><td colwidth="514"><p>3. Identify and indicate possible cable routes.</p></td><td colwidth="316"><p></p></td></tr><tr><td colwidth="514"><p>4. Confirm the area of panels installation dimensions</p></td><td colwidth="316"><p></p></td></tr><tr><td colwidth="514"><p>5. Identify and take a photo of the Roof profile (s).</p></td><td colwidth="316"><p></p></td></tr><tr><td colwidth="514"><p>6. Identify the method of DC cable installation.</p></td><td colwidth="316"><p></p></td></tr></tbody></table>
<h2>COMMUNICATION</h2>
<table><tbody><tr><th colwidth="514"><p>Item</p></th><th colwidth="316"><p>Comment</p></th></tr><tr><td colwidth="514"><p>Local ethernet network available?</p></td><td colwidth="316"><p></p></td></tr><tr><td colwidth="514"><p>Cellular 4G available?</p></td><td colwidth="316"><p></p></td></tr><tr><td colwidth="514"><p>Preferred supplier? (MTN / Vodacom / Telkom/IOT)</p></td><td colwidth="316"><p></p></td></tr></tbody></table>
<h2>CONSTRUCTION LOGISTICS</h2>
<table><tbody><tr><th colwidth="415"><p>Items</p></th><th colwidth="207"><p>Reading</p></th><th colwidth="207"><p>Capture Photo</p></th></tr><tr><td colwidth="415"><p>1. Ablutions available for team</p></td><td colwidth="207"><p></p></td><td colwidth="207"><p></p></td></tr><tr><td colwidth="415"><p>2. Staff accommodation</p></td><td colwidth="207"><p></p></td><td colwidth="207"><p></p></td></tr><tr><td colwidth="415"><p>3. Fork-lift - requirement (check min access height)</p></td><td colwidth="207"><p></p></td><td colwidth="207"><p></p></td></tr><tr><td colwidth="415"><p>4. Scissor Lift - need and landing area (check min access height)</p></td><td colwidth="207"><p></p></td><td colwidth="207"><p></p></td></tr><tr><td colwidth="415"><p>5. Safe Storage Space</p></td><td colwidth="207"><p></p></td><td colwidth="207"><p></p></td></tr><tr><td colwidth="415"><p>6. Additional security required</p></td><td colwidth="207"><p></p></td><td colwidth="207"><p></p></td></tr><tr><td colwidth="415"><p>7. Off-loading of equipment and access for trucks</p></td><td colwidth="207"><p></p></td><td colwidth="207"><p></p></td></tr><tr><td colwidth="415"><p>8. Assess security during and after the install</p></td><td colwidth="207"><p></p></td><td colwidth="207"><p></p></td></tr><tr><td colwidth="415"><p>9. Demarcation and fencing of off-site area</p></td><td colwidth="207"><p></p></td><td colwidth="207"><p></p></td></tr><tr><td colwidth="415"><p>10. Construction signs warning</p></td><td colwidth="207"><p></p></td><td colwidth="207"><p></p></td></tr></tbody></table>
<h2>Any other items to note?</h2>
<table><tbody><tr><th colwidth="830"><p>Items</p></th></tr></tbody></table>
<h2>Sign-off</h2><table><tbody><tr><th colwidth="230"><p>Role</p></th><th colwidth="230"><p>Name</p></th><th colwidth="220"><p>Signature</p></th><th colwidth="150"><p>Date</p></th></tr><tr><td colwidth="230"><p>SSE Representative</p></td><td colwidth="230"><p></p></td><td colwidth="220"><p></p></td><td colwidth="150"><p></p></td></tr><tr><td colwidth="230"><p>Installer Representative</p></td><td colwidth="230"><p></p></td><td colwidth="220"><p></p></td><td colwidth="150"><p></p></td></tr><tr><td colwidth="230"><p>Customer Representative</p></td><td colwidth="230"><p></p></td><td colwidth="220"><p></p></td><td colwidth="150"><p></p></td></tr></tbody></table>
$tpl$, 'Template import', 'Template import'
where not exists (select 1 from engineering_templates where name = 'Site Inspection' and content_html is not null);

-- Check
select name, category, version, length(content_html) as characters from engineering_templates where content_html is not null;
