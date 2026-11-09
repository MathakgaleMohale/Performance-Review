'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { supabase } from '@/lib/supabase'
import {
  STAGES, STAGE_META, STAGE_STATUSES, fmtDate, fmtShort, fmtSize, safeName, isOverdue, uiStyles, statusColor,
} from './projectConfig'
import { WorkItemsCard, ToolView, WORK_KINDS, newItemData, nextTitle, bumpTitle, EmbedBar, DesignPackView } from './ProjectWork'
const TemplatesTool = dynamic(() => import('./TemplatesTool'), { ssr: false, loading: () => <div style={{ padding: 40, textAlign: 'center', fontSize: 13, color: '#8698ad' }}>Loading templates…</div> })
const DocumentLibrary = dynamic(() => import('./DocumentLibrary'), { ssr: false, loading: () => <div style={{ padding: 40, textAlign: 'center', fontSize: 13, color: '#8698ad' }}>Loading library…</div> })

// Same rich-text editor as Engineering Templates, loaded only when a project is opened
const DocEditor = dynamic(() => import('./DocEditor'), { ssr: false, loading: () => <div style={{ padding: 30, textAlign: 'center', fontSize: 13, color: '#8698ad' }}>Loading editor…</div> })

const FILES = 'project-files'
const IMAGES = 'project-images'
const MAX_MB = 100
const isImage = f => /^image\//.test(f.file_type || '') || /\.(png|jpe?g|gif|webp)$/i.test(f.file_name || '')
const fileIcon = name => (/\.pdf$/i.test(name) ? ['ti-file-type-pdf', '#D93A3A'] : /\.(xlsx?|csv)$/i.test(name) ? ['ti-file-spreadsheet', '#3F8F2A'] : /\.docx?$/i.test(name) ? ['ti-file-text', '#0B74D7'] : /\.(dwg|dxf)$/i.test(name) ? ['ti-ruler-2', '#505050'] : /\.(png|jpe?g|gif|webp)$/i.test(name) ? ['ti-photo', '#579FE4'] : ['ti-file', '#505050'])

export default function ProjectPage({ project: p, T, cardStyle, selectStyle, userName, sites = [], onBack, onEdit, onDelete, onMoveStage, onChanged }) {
  const S = uiStyles(T, selectStyle)
  const [stage, setStage] = useState(STAGES.includes(p.stage) ? p.stage : STAGES[0])
  const [stages, setStages] = useState({}) // stage -> row
  const [tasks, setTasks] = useState([])
  const [files, setFiles] = useState([])
  const [links, setLinks] = useState([])
  const [reports, setReports] = useState(null) // null = Templates not set up
  const [docs, setDocs] = useState(null)       // null = Document Library not set up
  const [thumbs, setThumbs] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saveState, setSaveState] = useState('') // '', 'saving', 'saved', 'error'
  const [newTask, setNewTask] = useState('')
  const [uploading, setUploading] = useState('')
  const [picker, setPicker] = useState(null) // { type: 'template_report'|'library_doc', search }
  const [confirmFile, setConfirmFile] = useState(null)
  const [items, setItems] = useState([])          // BOQs & cable schedules (without data)
  const [itemsReady, setItemsReady] = useState(true)
  const [openItem, setOpenItem] = useState(null)
  const [archive, setArchive] = useState(null) // { zip, pdf, save, busy, progress, result, error }
  const [embed, setEmbed] = useState(null) // { kind: 'design' | 'templates' | 'library', openReportId?, stage }
  const [confirmItem, setConfirmItem] = useState(null)
  const NOTES_KEY = 'sos-project-notes-open'
  const [notesOpen, setNotesOpen] = useState(true)
  const [toast, setToast] = useState('')
  const pending = useRef(null) // { stage, html }
  const timer = useRef(null)
  const fileRef = useRef(null)

  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 3500); return () => clearTimeout(t) }, [toast])
  useEffect(() => { try { if (localStorage.getItem(NOTES_KEY) === '0') setNotesOpen(false) } catch (e) { /* ignore */ } }, [])
  async function toggleNotes() {
    if (notesOpen) await flushNotes()
    setNotesOpen(o => { try { localStorage.setItem(NOTES_KEY, o ? '0' : '1') } catch (e) { /* ignore */ } return !o })
  }

  async function load() {
    const [st, tk, fl, lk, rp, dc, it] = await Promise.all([
      supabase.from('project_stages').select('*').eq('project_id', p.id),
      supabase.from('project_tasks').select('*').eq('project_id', p.id).order('sort').order('created_at'),
      supabase.from('project_files').select('*').eq('project_id', p.id).order('created_at', { ascending: false }),
      supabase.from('project_links').select('*').eq('project_id', p.id).order('created_at'),
      supabase.from('template_reports').select('id, title, site_name, template_name, status, report_date, updated_at').order('updated_at', { ascending: false }),
      supabase.from('engineering_documents').select('id, title, doc_type, brand, category, file_path, file_url, file_name').order('title'),
      supabase.from('project_items').select('id, project_id, stage, kind, title, created_by, updated_by, created_at, updated_at').eq('project_id', p.id).order('created_at'),
    ])
    const err = st.error || tk.error || fl.error || lk.error
    if (err) { setError(err.message); setLoading(false); return }
    setStages(Object.fromEntries((st.data || []).map(r => [r.stage, r])))
    setTasks(tk.data || [])
    setFiles(fl.data || [])
    setLinks(lk.data || [])
    setReports(rp.error ? null : rp.data || [])
    setDocs(dc.error ? null : dc.data || [])
    setItemsReady(!it.error)
    setItems(it.error ? [] : it.data || [])
    setLoading(false)
    const imgs = (fl.data || []).filter(isImage).map(f => f.file_path)
    if (imgs.length) {
      const { data } = await supabase.storage.from(FILES).createSignedUrls(imgs, 3600)
      if (data) setThumbs(Object.fromEntries(data.filter(x => x.signedUrl).map(x => [x.path, x.signedUrl])))
    }
  }
  useEffect(() => { load() }, [p.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── stage row helpers ──
  async function upsertStage(s, fields) {
    const row = { project_id: p.id, stage: s, ...fields, updated_by: userName || null }
    const { data, error: e } = await supabase.from('project_stages').upsert([row], { onConflict: 'project_id,stage' }).select().single()
    if (e) throw e
    setStages(m => ({ ...m, [s]: data }))
    return data
  }
  const stageStatus = s => stages[s]?.status || 'Not started'
  async function setStageStatus(s, status) {
    try {
      await upsertStage(s, { status, completed_at: status === 'Done' ? new Date().toISOString() : null })
    } catch (e) { setToast(`Could not update: ${e.message}`) }
  }
  async function completeAndAdvance() {
    const idx = STAGES.indexOf(stage)
    await setStageStatus(stage, 'Done')
    const next = STAGES[idx + 1]
    if (next) {
      await onMoveStage(next)
      if (stageStatus(next) === 'Not started') await setStageStatus(next, 'In progress')
      setStage(next)
    } else {
      await supabase.from('projects').update({ status: 'Complete', updated_by: userName || null }).eq('id', p.id)
      setToast('Handover complete — project marked as Complete')
      onChanged && onChanged()
    }
  }

  // ── notes autosave ──
  async function flushNotes() {
    clearTimeout(timer.current)
    const job = pending.current
    if (!job) return
    pending.current = null
    setSaveState('saving')
    try {
      await upsertStage(job.stage, { notes_html: job.html, ...(stageStatus(job.stage) === 'Not started' ? { status: 'In progress' } : {}) })
      setSaveState('saved')
    } catch (e) { setSaveState('error'); setToast(`Notes not saved: ${e.message}`) }
  }
  function onNotesChange(ed) {
    pending.current = { stage, html: ed.isEmpty ? '' : ed.getHTML() }
    setSaveState('saving')
    clearTimeout(timer.current)
    timer.current = setTimeout(flushNotes, 1200)
  }
  useEffect(() => () => { flushNotes() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  async function switchStage(s) { await flushNotes(); setSaveState(''); setStage(s) }

  async function uploadNoteImage(file) {
    if (file.size > 10 * 1024 * 1024) { setToast('Photos in notes must be under 10 MB (attach bigger files under Files & photos)'); return null }
    const path = `${p.id}/${Date.now()}-${safeName(file.name)}`
    const { error: e } = await supabase.storage.from(IMAGES).upload(path, file, { upsert: false, contentType: file.type || undefined })
    if (e) { setToast(`Photo upload failed: ${e.message}`); return null }
    return supabase.storage.from(IMAGES).getPublicUrl(path).data.publicUrl
  }

  // ── tasks ──
  const stageTasks = useMemo(() => tasks.filter(t => t.stage === stage).sort((a, b) => (a.done - b.done) || (a.sort - b.sort)), [tasks, stage])
  const countFor = s => { const l = tasks.filter(t => t.stage === s); return { done: l.filter(t => t.done).length, total: l.length } }
  async function addTask() {
    const title = newTask.trim()
    if (!title) return
    const sort = Math.max(0, ...tasks.filter(t => t.stage === stage).map(t => t.sort || 0)) + 1
    const { data, error: e } = await supabase.from('project_tasks').insert([{ project_id: p.id, stage, title, sort, created_by: userName || null }]).select().single()
    if (e) { setToast(`Could not add task: ${e.message}`); return }
    setTasks(l => [...l, data]); setNewTask('')
    if (stageStatus(stage) === 'Not started') setStageStatus(stage, 'In progress')
  }
  async function updateTask(t, fields) {
    setTasks(l => l.map(x => (x.id === t.id ? { ...x, ...fields } : x)))
    const { error: e } = await supabase.from('project_tasks').update(fields).eq('id', t.id)
    if (e) { setToast(`Could not save task: ${e.message}`); load() }
  }
  const toggleTask = t => {
    updateTask(t, { done: !t.done, done_at: !t.done ? new Date().toISOString() : null })
    if (!t.done && stageStatus(stage) === 'Not started') setStageStatus(stage, 'In progress')
  }
  async function removeTask(t) {
    setTasks(l => l.filter(x => x.id !== t.id))
    const { error: e } = await supabase.from('project_tasks').delete().eq('id', t.id)
    if (e) { setToast(`Could not delete task: ${e.message}`); load() }
  }

  // ── files ──
  const stageFiles = files.filter(f => f.stage === stage)
  async function uploadFiles(list) {
    const arr = Array.from(list || [])
    if (!arr.length) return
    const big = arr.filter(f => f.size > MAX_MB * 1024 * 1024)
    const ok = arr.filter(f => f.size <= MAX_MB * 1024 * 1024)
    if (big.length) setToast(`${big.map(f => f.name).join(', ')} skipped (over ${MAX_MB} MB)`)
    let n = 0
    for (const file of ok) {
      setUploading(`Uploading ${n + 1} of ${ok.length}…`)
      const path = `${p.id}/${safeName(stage)}/${Date.now()}-${safeName(file.name)}`
      const { error: upErr } = await supabase.storage.from(FILES).upload(path, file, { upsert: false, contentType: file.type || undefined })
      if (upErr) { setToast(`Upload of ${file.name} failed: ${upErr.message}`); continue }
      const { error: e } = await supabase.from('project_files').insert([{ project_id: p.id, stage, file_path: path, file_name: file.name, file_size: file.size, file_type: file.type || null, uploaded_by: userName || null }])
      if (e) { await supabase.storage.from(FILES).remove([path]); setToast(`Could not save ${file.name}: ${e.message}`); continue }
      n++
    }
    setUploading('')
    if (n) { setToast(n > 1 ? `${n} files added` : 'File added'); if (stageStatus(stage) === 'Not started') setStageStatus(stage, 'In progress') }
    load()
  }
  async function openFile(f, download) {
    const win = download ? null : window.open('', '_blank')
    const { data, error: e } = await supabase.storage.from(FILES).createSignedUrl(f.file_path, 300, download ? { download: f.file_name || true } : undefined)
    if (e) { if (win) win.close(); setToast(`Could not open: ${e.message}`); return }
    if (download) { const a = document.createElement('a'); a.href = data.signedUrl; document.body.appendChild(a); a.click(); a.remove() }
    else if (win) win.location.href = data.signedUrl; else window.location.href = data.signedUrl
  }
  async function removeFile(f) {
    const { error: e } = await supabase.from('project_files').delete().eq('id', f.id)
    if (!e) await supabase.storage.from(FILES).remove([f.file_path])
    setConfirmFile(null)
    if (e) setToast(`Delete failed: ${e.message}`); else { setFiles(l => l.filter(x => x.id !== f.id)); setToast('File deleted') }
  }

  // ── links ──
  const stageLinks = links.filter(l => l.stage === stage)
  const resolve = l => (l.link_type === 'template_report' ? (reports || []).find(r => r.id === l.ref_id) : (docs || []).find(d => d.id === l.ref_id))
  async function addLink(type, rec) {
    const label = rec.title
    const { data, error: e } = await supabase.from('project_links').insert([{ project_id: p.id, stage, link_type: type, ref_id: rec.id, label, created_by: userName || null }]).select().single()
    if (e) { setToast(/duplicate|unique/i.test(e.message) ? 'Already linked to this stage' : `Could not link: ${e.message}`); return }
    setLinks(l => [...l, data]); setToast('Linked')
  }
  async function removeLink(l) {
    setLinks(x => x.filter(y => y.id !== l.id))
    await supabase.from('project_links').delete().eq('id', l.id)
  }
  async function openLibraryDoc(d) {
    if (!d) return
    if (d.file_url) { window.open(d.file_url, '_blank'); return }
    const win = window.open('', '_blank')
    const { data, error: e } = await supabase.storage.from('engineering-documents').createSignedUrl(d.file_path, 300)
    if (e) { if (win) win.close(); setToast(`Could not open: ${e.message}`); return }
    if (win) win.location.href = data.signedUrl
  }
  const siteKey = (p.site_name || '').trim().toLowerCase()
  const suggestedReports = useMemo(() => (reports || []).filter(r => siteKey && (r.site_name || '').trim().toLowerCase() === siteKey && !links.some(l => l.link_type === 'template_report' && l.ref_id === r.id)), [reports, links, siteKey])

  // ── engineering work (BOQs & cable schedules) ──
  async function createItem(kind) {
    const row = { project_id: p.id, stage, kind, title: nextTitle(kind, items), data: newItemData(kind, p, userName), created_by: userName || null, updated_by: userName || null }
    const { data, error: e } = await supabase.from('project_items').insert([row]).select('id, project_id, stage, kind, title, created_by, updated_by, created_at, updated_at').single()
    if (e) { setToast(`Could not create: ${e.message}`); return }
    setItems(l => [...l, data]); await flushNotes(); setOpenItem(data)
  }
  async function duplicateItem(i) {
    const { data: src, error: e1 } = await supabase.from('project_items').select('data').eq('id', i.id).single()
    if (e1) { setToast(`Could not copy: ${e1.message}`); return }
    const d = JSON.parse(JSON.stringify(src.data || {}))
    if (d.project && typeof d.project.revision === 'string' && /^\d+$/.test(d.project.revision)) d.project.revision = String(Number(d.project.revision) + 1).padStart(d.project.revision.length, '0')
    const { data, error: e } = await supabase.from('project_items').insert([{ project_id: p.id, stage: i.stage, kind: i.kind, title: bumpTitle(i.title, items), data: d, created_by: userName || null, updated_by: userName || null }])
      .select('id, project_id, stage, kind, title, created_by, updated_by, created_at, updated_at').single()
    if (e) { setToast(`Could not copy: ${e.message}`); return }
    setItems(l => [...l, data]); setToast(`${data.title} created`)
  }
  async function deleteItem(i) {
    const { error: e } = await supabase.from('project_items').delete().eq('id', i.id)
    setConfirmItem(null)
    if (e) setToast(`Delete failed: ${e.message}`); else { setItems(l => l.filter(x => x.id !== i.id)); setToast(`${i.title} deleted`) }
  }

  // ── compiled archive (ZIP + merged PDF) ──
  const saveBlobAs = (blob, name) => { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000) }
  async function buildArchive() {
    const opt = archive
    if (!opt.zip && !opt.pdf) { setArchive(a => ({ ...a, error: 'Choose the ZIP, the PDF or both.' })); return }
    await flushNotes()
    setArchive(a => ({ ...a, busy: true, error: '', result: null, progress: 'Starting…' }))
    try {
      const { buildProjectArchive } = await import('./projectArchive')
      const res = await buildProjectArchive(p, { zip: opt.zip, pdf: opt.pdf, userName, onProgress: m => setArchive(a => (a ? { ...a, progress: m } : a)) })
      if (opt.zip && !res.zipBlob) throw new Error(res.problems.join('; ') || 'The ZIP could not be built')
      if (opt.pdf && !res.pdfBlob) throw new Error(res.problems.join('; ') || 'The PDF could not be built')
      if (res.zipBlob) saveBlobAs(res.zipBlob, res.zipName)
      if (res.pdfBlob) setTimeout(() => saveBlobAs(res.pdfBlob, res.pdfName), 600)
      if (opt.save) {
        setArchive(a => ({ ...a, progress: 'Saving a copy to the project (Handover → Files)…' }))
        for (const [blob, name, type] of [[res.zipBlob, res.zipName, 'application/zip'], [res.pdfBlob, res.pdfName, 'application/pdf']]) {
          if (!blob) continue
          const path = `${p.id}/Handover/${Date.now()}-${safeName(name)}`
          const { error: upErr } = await supabase.storage.from(FILES).upload(path, blob, { upsert: false, contentType: type })
          if (upErr) { res.problems.push(`Saving ${name} to the project: ${upErr.message}`); continue }
          await supabase.from('project_files').insert([{ project_id: p.id, stage: 'Handover', file_path: path, file_name: name, file_size: blob.size, file_type: type, caption: 'Project archive', uploaded_by: userName || null }])
        }
        load()
      }
      setArchive(a => ({ ...a, busy: false, progress: '', result: res }))
    } catch (e) {
      setArchive(a => ({ ...a, busy: false, progress: '', error: e.message || String(e) }))
    }
  }

  // ── tools opened from the project ──
  async function openEmbed(e) { await flushNotes(); setEmbed({ stage, ...e }) }
  function closeEmbed() { setEmbed(null); load() }
  async function saveDesignPack(filename, blob) {
    const st = 'Design'
    const path = `${p.id}/${safeName(st)}/${Date.now()}-${safeName(filename)}`
    const { error: upErr } = await supabase.storage.from(FILES).upload(path, blob, { upsert: false, contentType: 'application/pdf' })
    if (upErr) return false
    const { error: e } = await supabase.from('project_files').insert([{ project_id: p.id, stage: st, file_path: path, file_name: filename, file_size: blob.size, file_type: 'application/pdf', caption: 'Design pack', uploaded_by: userName || null }])
    if (e) { await supabase.storage.from(FILES).remove([path]); return false }
    return true
  }
  async function linkRecord(type, rec, st) {
    const { error: e } = await supabase.from('project_links').insert([{ project_id: p.id, stage: st || stage, link_type: type, ref_id: rec.id, label: rec.title, created_by: userName || null }])
    if (e && !/duplicate|unique/i.test(e.message)) { setToast(`Could not link: ${e.message}`); return false }
    return true
  }

  // ── render helpers ──
  const meta = STAGE_META[stage]
  const idx = STAGES.indexOf(stage)
  const isCurrent = p.stage === stage
  const sectionTitle = (icon, text, extra) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '12px' }}>
      <i className={`ti ${icon}`} style={{ color: T.blue, fontSize: '15px' }} />
      <span style={{ fontSize: '13px', fontWeight: 800, color: T.textPrimary }}>{text}</span>
      {extra}
    </div>
  )
  const stepColor = s => (stageStatus(s) === 'Done' ? T.green : stageStatus(s) === 'In progress' ? STAGE_META[s].color : T.textMuted)

  if (loading) return <div style={{ ...cardStyle, padding: '50px', textAlign: 'center', color: T.textSecondary, fontSize: '13px' }}>Loading project…</div>

  if (embed?.kind === 'design') {
    return <DesignPackView project={p} T={T} cardStyle={cardStyle} selectStyle={selectStyle} onBack={closeEmbed} onCompiled={saveDesignPack} />
  }
  if (embed?.kind === 'templates') {
    return (
      <div>
        <EmbedBar project={p} icon="ti-folders" color={T.green} title="Checklists & reports (Engineering Templates)" note={`New reports are linked to ${embed.stage}`} T={T} cardStyle={cardStyle} selectStyle={selectStyle} onBack={closeEmbed} />
        <TemplatesTool T={T} cardStyle={cardStyle} selectStyle={selectStyle} userName={userName} sites={sites} project={p}
          openReportId={embed.openReportId} onExit={closeEmbed}
          onReportCreated={r => linkRecord('template_report', r, embed.stage)} />
      </div>
    )
  }
  if (embed?.kind === 'library') {
    const linkedIds = links.filter(l => l.link_type === 'library_doc' && l.stage === embed.stage).map(l => l.ref_id)
    return (
      <div>
        <EmbedBar project={p} icon="ti-books" color={T.blue} title="Document Library" note={`Documents are added to ${embed.stage}`} T={T} cardStyle={cardStyle} selectStyle={selectStyle} onBack={closeEmbed} />
        <DocumentLibrary T={T} cardStyle={cardStyle} selectStyle={selectStyle} userName={userName} project={p} linkedIds={linkedIds}
          onAddToProject={async d => {
            if (await linkRecord('library_doc', d, embed.stage)) {
              setLinks(l => [...l, { id: `tmp-${d.id}`, project_id: p.id, stage: embed.stage, link_type: 'library_doc', ref_id: d.id, label: d.title }])
            }
          }} />
      </div>
    )
  }

  if (openItem) {
    return (
      <ToolView key={openItem.id} item={openItem} project={p} T={T} cardStyle={cardStyle} selectStyle={selectStyle} S={S} userName={userName}
        onRenamed={t => setItems(l => l.map(x => (x.id === openItem.id ? { ...x, title: t } : x)))}
        onClose={() => { setOpenItem(null); load() }} />
    )
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap', marginBottom: '14px' }}>
        <button onClick={async () => { await flushNotes(); onBack() }} style={{ ...selectStyle, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}><i className="ti ti-arrow-left" />All projects</button>
        <div style={{ flex: '1 1 300px', minWidth: 0 }}>
          <div style={{ fontSize: '20px', fontWeight: 800, color: T.textPrimary, lineHeight: 1.2 }}>{p.name}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', fontSize: '12px', color: T.textSecondary, marginTop: '6px' }}>
            <span style={S.badge(statusColor(T, p.status))}>{p.status}</span>
            {p.client && <span><i className="ti ti-building" /> {p.client}</span>}
            {p.site_name && <span><i className="ti ti-map-pin" /> {p.site_name}</span>}
            {p.location && <span><i className="ti ti-map" /> {p.location}</span>}
            {(p.capacity_kwp || p.battery_kwh) && <span><i className="ti ti-bolt" /> {[p.capacity_kwp ? `${Number(p.capacity_kwp).toLocaleString()} kWp` : null, p.battery_kwh ? `${Number(p.battery_kwh).toLocaleString()} kWh BESS` : null].filter(Boolean).join(' + ')}</span>}
            {p.system_type && <span><i className="ti ti-file-certificate" /> {p.system_type}</span>}
            {p.owner && <span><i className="ti ti-user" /> {p.owner}</span>}
            {(p.start_date || p.target_date) && <span><i className="ti ti-calendar" /> {fmtDate(p.start_date) || '—'} → {fmtDate(p.target_date) || 'no target'}</span>}
          </div>
          {p.description && <div style={{ fontSize: '12px', color: T.textMuted, marginTop: '6px' }}>{p.description}</div>}
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button onClick={() => setArchive({ zip: true, pdf: true, save: false, busy: false, progress: '', result: null, error: '' })} style={S.btn(T.blue)} title="Compile everything in this project into a ZIP and a merged PDF"><i className="ti ti-file-zip" />Download archive</button>
          <button onClick={onEdit} style={S.ghost}><i className="ti ti-pencil" />Edit details</button>
          <button onClick={onDelete} style={S.iconBtn(T.red)} title="Delete project"><i className="ti ti-trash" /></button>
        </div>
      </div>

      {error && <div style={{ ...cardStyle, padding: '12px 16px', marginBottom: '14px', color: T.red, fontSize: '12px' }}>{error}</div>}

      {/* Stage tracker */}
      <div style={{ ...cardStyle, padding: '10px', marginBottom: '16px', display: 'flex', gap: '4px', overflowX: 'auto' }}>
        {STAGES.map((s, i) => {
          const c = countFor(s)
          const active = s === stage
          const st = stageStatus(s)
          return (
            <button key={s} onClick={() => switchStage(s)}
              style={{ flex: '1 0 112px', padding: '9px 8px', borderRadius: '8px', cursor: 'pointer', textAlign: 'left', border: `1px solid ${active ? STAGE_META[s].color : 'transparent'}`, background: active ? `${STAGE_META[s].color}14` : 'transparent', position: 'relative' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ width: '22px', height: '22px', borderRadius: '50%', flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 800, color: st === 'Not started' ? T.textMuted : '#fff', background: st === 'Done' ? T.green : st === 'In progress' ? STAGE_META[s].color : 'transparent', border: `1.5px solid ${stepColor(s)}` }}>
                  {st === 'Done' ? <i className="ti ti-check" /> : i + 1}
                </span>
                <span style={{ fontSize: '12px', fontWeight: 700, color: active ? T.textPrimary : T.textSecondary, whiteSpace: 'nowrap' }}>{s}</span>
              </div>
              <div style={{ fontSize: '10px', color: T.textMuted, marginTop: '4px', paddingLeft: '28px', whiteSpace: 'nowrap' }}>
                {p.stage === s ? <b style={{ color: STAGE_META[s].color }}>Current · </b> : null}{c.total ? `${c.done}/${c.total} tasks` : st}
              </div>
            </button>
          )
        })}
      </div>

      {/* Stage header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '14px' }}>
        <div style={{ width: '36px', height: '36px', borderRadius: '9px', background: `${meta.color}1a`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <i className={`ti ${meta.icon}`} style={{ fontSize: '20px', color: meta.color }} />
        </div>
        <div style={{ fontSize: '17px', fontWeight: 800, color: T.textPrimary }}>{stage}</div>
        <select value={stageStatus(stage)} onChange={e => setStageStatus(stage, e.target.value)} style={{ ...selectStyle, color: stepColor(stage), fontWeight: 700 }}>
          {STAGE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        {stages[stage]?.completed_at && stageStatus(stage) === 'Done' && <span style={{ fontSize: '11px', color: T.textMuted }}>Completed {fmtDate(stages[stage].completed_at)}</span>}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '6px' }}>
          {!isCurrent && <button onClick={async () => { await onMoveStage(stage); load() }} style={S.ghost}><i className="ti ti-target-arrow" />Make current stage</button>}
          {isCurrent && p.status !== 'Complete' && (
            <button onClick={completeAndAdvance} style={S.btn(T.green)}>
              <i className="ti ti-circle-check" />{STAGES[idx + 1] ? `Complete & move to ${STAGES[idx + 1]}` : 'Complete handover'}
            </button>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: '14px', alignItems: 'start' }}>
        {/* Notes */}
        <div style={{ ...cardStyle, padding: '16px', gridColumn: '1 / -1', minWidth: 0 }}>
          <div onClick={toggleNotes} style={{ display: 'flex', alignItems: 'center', gap: '7px', cursor: 'pointer', marginBottom: notesOpen ? '12px' : 0, userSelect: 'none' }} title={notesOpen ? 'Hide notes' : 'Show notes'}>
            <i className={`ti ${notesOpen ? 'ti-chevron-down' : 'ti-chevron-right'}`} style={{ color: T.textMuted, fontSize: '15px' }} />
            <i className="ti ti-notes" style={{ color: T.blue, fontSize: '15px' }} />
            <span style={{ fontSize: '13px', fontWeight: 800, color: T.textPrimary }}>Notes</span>
            {!notesOpen && (() => {
              const txt = (stages[stage]?.notes_html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
              return <span style={{ fontSize: '12px', color: T.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>{txt ? `— ${txt}` : '— no notes yet'}</span>
            })()}
            <span style={{ marginLeft: 'auto', fontSize: '11px', color: saveState === 'error' ? T.red : T.textMuted, whiteSpace: 'nowrap' }}>
              {notesOpen ? (saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? <><i className="ti ti-check" /> Saved</> : saveState === 'error' ? 'Not saved' : 'Saved automatically') : 'Show'}
            </span>
          </div>
          {notesOpen && <DocEditor key={stage} T={T} content={stages[stage]?.notes_html || ''} onChange={onNotesChange} onImageUpload={uploadNoteImage} />}
        </div>

        {/* Checklist */}
        <div style={{ ...cardStyle, padding: '16px', minWidth: 0 }}>
          {(() => { const c = countFor(stage); return sectionTitle('ti-checklist', 'Checklist', c.total ? <span style={{ fontSize: '11px', color: T.textMuted }}>{c.done}/{c.total}</span> : null) })()}
          {stageTasks.length === 0 && <div style={{ fontSize: '12px', color: T.textMuted, marginBottom: '10px' }}>No tasks yet for this stage.</div>}
          {stageTasks.map(t => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '7px 0', borderBottom: `1px solid ${T.border}` }}>
              <input type="checkbox" checked={!!t.done} onChange={() => toggleTask(t)} style={{ marginTop: '2px', width: '15px', height: '15px', cursor: 'pointer', accentColor: T.green }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <input defaultValue={t.title} onBlur={e => { const v = e.target.value.trim(); if (v && v !== t.title) updateTask(t, { title: v }); else e.target.value = t.title }}
                  onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
                  style={{ width: '100%', border: 'none', background: 'transparent', fontSize: '12px', fontWeight: 600, color: t.done ? T.textMuted : T.textPrimary, textDecoration: t.done ? 'line-through' : 'none', padding: 0, outline: 'none', fontFamily: 'inherit' }} />
                <div style={{ display: 'flex', gap: '6px', marginTop: '4px', alignItems: 'center' }}>
                  <input defaultValue={t.assignee || ''} placeholder="Assignee" onBlur={e => { const v = e.target.value.trim(); if (v !== (t.assignee || '')) updateTask(t, { assignee: v || null }) }}
                    style={{ width: '100px', border: `1px solid ${T.border}`, borderRadius: '4px', background: 'transparent', fontSize: '10px', color: T.textSecondary, padding: '2px 5px', fontFamily: 'inherit' }} />
                  <input type="date" value={t.due_date || ''} onChange={e => updateTask(t, { due_date: e.target.value || null })}
                    style={{ border: `1px solid ${isOverdue(t.due_date, t.done) ? T.red : T.border}`, borderRadius: '4px', background: 'transparent', fontSize: '10px', color: isOverdue(t.due_date, t.done) ? T.red : T.textSecondary, padding: '1px 4px', fontFamily: 'inherit' }} />
                </div>
              </div>
              <button onClick={() => removeTask(t)} title="Delete task" style={{ background: 'transparent', border: 'none', color: T.textMuted, cursor: 'pointer', padding: '2px' }}><i className="ti ti-x" /></button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: '6px', marginTop: '10px' }}>
            <input value={newTask} onChange={e => setNewTask(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addTask() }} placeholder="Add a task and press Enter" style={S.inp} />
            <button onClick={addTask} style={S.iconBtn(T.blue)} title="Add task"><i className="ti ti-plus" /></button>
          </div>
        </div>

        {/* Engineering work: BOQs & cable schedules */}
        <WorkItemsCard items={items} stage={stage} ready={itemsReady} T={T} cardStyle={cardStyle} S={S}
          onOpen={async i => { await flushNotes(); setOpenItem(i) }} onCreate={createItem} onDuplicate={duplicateItem} onDelete={i => setConfirmItem(i)}
          designPacks={files.filter(f => f.caption === 'Design pack')} onDesignPack={() => openEmbed({ kind: 'design' })} onOpenFile={openFile} />

        {/* Files & photos */}
        <div style={{ ...cardStyle, padding: '16px', minWidth: 0 }}
          onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); uploadFiles(e.dataTransfer.files) }}>
          {sectionTitle('ti-photo', 'Files & photos', (
            <button onClick={() => fileRef.current?.click()} disabled={!!uploading} style={{ ...S.iconBtn(T.blue), marginLeft: 'auto' }}><i className="ti ti-upload" />{uploading || 'Upload'}</button>
          ))}
          <input ref={fileRef} type="file" multiple style={{ display: 'none' }} onChange={e => { uploadFiles(e.target.files); e.target.value = '' }} />
          {stageFiles.length === 0 ? (
            <div onClick={() => fileRef.current?.click()} style={{ border: `2px dashed ${T.border}`, borderRadius: '8px', padding: '22px', textAlign: 'center', fontSize: '12px', color: T.textMuted, cursor: 'pointer' }}>
              <i className="ti ti-cloud-upload" style={{ fontSize: '24px', color: T.blue, display: 'block', marginBottom: '4px' }} />
              Drop site photos, drawings or signed sheets here, or click to choose (up to {MAX_MB} MB each)
            </div>
          ) : (
            <>
              {stageFiles.some(isImage) && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(88px, 1fr))', gap: '6px', marginBottom: '10px' }}>
                  {stageFiles.filter(isImage).map(f => (
                    <div key={f.id} onClick={() => openFile(f)} title={f.file_name} style={{ aspectRatio: '1 / 1', borderRadius: '6px', overflow: 'hidden', cursor: 'pointer', background: T.bgMuted, border: `1px solid ${T.border}` }}>
                      {thumbs[f.file_path] ? <img src={thumbs[f.file_path]} alt={f.file_name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /> : <i className="ti ti-photo" style={{ fontSize: '22px', color: T.textMuted, display: 'block', textAlign: 'center', marginTop: '30px' }} />}
                    </div>
                  ))}
                </div>
              )}
              {stageFiles.map(f => {
                const [icon, color] = fileIcon(f.file_name || '')
                return (
                  <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 0', borderBottom: `1px solid ${T.border}` }}>
                    <i className={`ti ${icon}`} style={{ color, fontSize: '18px' }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div onClick={() => openFile(f)} style={{ fontSize: '12px', fontWeight: 600, color: T.textPrimary, cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.file_name}</div>
                      <div style={{ fontSize: '10px', color: T.textMuted }}>{[fmtSize(f.file_size), fmtShort(f.created_at), f.uploaded_by].filter(Boolean).join(' · ')}</div>
                    </div>
                    <button onClick={() => openFile(f, true)} style={S.iconBtn(T.green)} title="Download"><i className="ti ti-download" /></button>
                    <button onClick={() => setConfirmFile(f)} style={S.iconBtn(T.red)} title="Delete"><i className="ti ti-trash" /></button>
                  </div>
                )
              })}
            </>
          )}
        </div>

        {/* Checklists & reports (Engineering Templates) */}
        <div style={{ ...cardStyle, padding: '16px', minWidth: 0 }}>
          {sectionTitle('ti-file-check', 'Checklists & reports', (
            <div style={{ marginLeft: 'auto', display: 'flex', gap: '5px' }}>
              <button onClick={() => openEmbed({ kind: 'templates' })} disabled={reports === null} style={{ ...S.iconBtn(T.blue), opacity: reports === null ? 0.5 : 1 }} title="Fill in a template (QC, commissioning, site visit…) for this project"><i className="ti ti-plus" />Fill in checklist</button>
              <button onClick={() => setPicker({ type: 'template_report', search: '' })} disabled={reports === null} style={{ ...S.iconBtn(T.textSecondary), opacity: reports === null ? 0.5 : 1 }} title="Link a report that already exists"><i className="ti ti-link" /></button>
            </div>
          ))}
          {reports === null && <div style={{ fontSize: '12px', color: T.textSecondary, borderLeft: `3px solid ${T.orange}`, paddingLeft: '10px' }}>Engineering Templates is not set up yet (supabase/engineering_templates.sql and template_documents.sql).</div>}
          {reports !== null && stageLinks.filter(l => l.link_type === 'template_report').length === 0 && (
            <div style={{ fontSize: '12px', color: T.textMuted, marginBottom: '8px' }}>Fill in QC, commissioning or site-visit checklists from your Engineering Templates. They open here, save to the project and download as Word or PDF.</div>
          )}
          {stageLinks.filter(l => l.link_type === 'template_report').map(l => {
            const rec = resolve(l)
            return (
              <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 0', borderBottom: `1px solid ${T.border}` }}>
                <i className="ti ti-file-check" style={{ color: T.green, fontSize: '17px' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div onClick={() => rec && openEmbed({ kind: 'templates', openReportId: rec.id })} style={{ fontSize: '12px', fontWeight: 600, color: rec ? T.textPrimary : T.textMuted, cursor: rec ? 'pointer' : 'default', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {rec?.title || l.label || 'Report'}{!rec && ' (deleted)'}
                  </div>
                  <div style={{ fontSize: '10px', color: T.textMuted }}>{[rec?.template_name, rec?.status, rec?.report_date ? fmtShort(rec.report_date) : null].filter(Boolean).join(' · ')}</div>
                </div>
                {rec && <button onClick={() => openEmbed({ kind: 'templates', openReportId: rec.id })} style={S.iconBtn(T.blue)} title="Open, edit & download (Word / PDF)"><i className="ti ti-external-link" /></button>}
                <button onClick={() => removeLink(l)} title="Unlink from project (the report itself is kept)" style={{ background: 'transparent', border: 'none', color: T.textMuted, cursor: 'pointer' }}><i className="ti ti-unlink" /></button>
              </div>
            )
          })}
          {suggestedReports.length > 0 && (
            <div style={{ marginTop: '12px' }}>
              <div style={S.labelStyle}>Other reports for {p.site_name}</div>
              {suggestedReports.slice(0, 5).map(r => (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0' }}>
                  <span style={{ flex: 1, fontSize: '11px', color: T.textSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</span>
                  <button onClick={() => addLink('template_report', r)} style={{ ...S.iconBtn(T.blue), padding: '2px 7px', fontSize: '11px' }}><i className="ti ti-link" />Link</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Documents (Document Library) */}
        <div style={{ ...cardStyle, padding: '16px', minWidth: 0 }}>
          {sectionTitle('ti-books', 'Documents', (
            <div style={{ marginLeft: 'auto', display: 'flex', gap: '5px' }}>
              <button onClick={() => openEmbed({ kind: 'library' })} disabled={docs === null} style={{ ...S.iconBtn(T.blue), opacity: docs === null ? 0.5 : 1 }} title="Open the Document Library and add documents to this project"><i className="ti ti-books" />Browse library</button>
              <button onClick={() => setPicker({ type: 'library_doc', search: '' })} disabled={docs === null} style={{ ...S.iconBtn(T.textSecondary), opacity: docs === null ? 0.5 : 1 }} title="Quick search & link"><i className="ti ti-search" /></button>
            </div>
          ))}
          {docs === null && <div style={{ fontSize: '12px', color: T.textSecondary, borderLeft: `3px solid ${T.orange}`, paddingLeft: '10px' }}>The Document Library is not set up yet (supabase/engineering_documents.sql).</div>}
          {docs !== null && stageLinks.filter(l => l.link_type === 'library_doc').length === 0 && (
            <div style={{ fontSize: '12px', color: T.textMuted }}>Add the datasheets, certificates, manuals and warranties for the equipment used on this project. They are included in the compiled project archive.</div>
          )}
          {stageLinks.filter(l => l.link_type === 'library_doc').map(l => {
            const rec = resolve(l)
            return (
              <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 0', borderBottom: `1px solid ${T.border}` }}>
                <i className="ti ti-file-description" style={{ color: T.blue, fontSize: '17px' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div onClick={() => openLibraryDoc(rec)} style={{ fontSize: '12px', fontWeight: 600, color: rec ? T.textPrimary : T.textMuted, cursor: rec ? 'pointer' : 'default', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {rec?.title || l.label || 'Document'}{!rec && ' (deleted)'}
                  </div>
                  <div style={{ fontSize: '10px', color: T.textMuted }}>{[rec?.doc_type, rec?.category, rec?.brand].filter(Boolean).join(' · ')}</div>
                </div>
                {rec && <button onClick={() => openLibraryDoc(rec)} style={S.iconBtn(T.blue)} title="Open"><i className="ti ti-eye" /></button>}
                <button onClick={() => removeLink(l)} title="Remove from project (the library document is kept)" style={{ background: 'transparent', border: 'none', color: T.textMuted, cursor: 'pointer' }}><i className="ti ti-unlink" /></button>
              </div>
            )
          })}
        </div>
      </div>

      {/* Link picker */}
      {picker && (() => {
        const q = picker.search.trim().toLowerCase()
        const list = picker.type === 'template_report'
          ? (reports || []).filter(r => !q || `${r.title} ${r.site_name || ''} ${r.template_name || ''}`.toLowerCase().includes(q))
          : (docs || []).filter(d => !q || `${d.title} ${d.brand || ''} ${d.doc_type} ${d.category}`.toLowerCase().includes(q))
        const linked = new Set(stageLinks.filter(l => l.link_type === picker.type).map(l => l.ref_id))
        return (
          <div style={S.overlay} onClick={e => { if (e.target === e.currentTarget) setPicker(null) }}>
            <div style={{ ...cardStyle, width: '100%', maxWidth: '560px', maxHeight: '80vh', display: 'flex', flexDirection: 'column', padding: '20px' }}>
              <div style={{ fontSize: '16px', fontWeight: 800, color: T.textPrimary, marginBottom: '12px' }}>
                Link {picker.type === 'template_report' ? 'a template report' : 'a library document'} to {stage}
              </div>
              <input autoFocus value={picker.search} onChange={e => setPicker(x => ({ ...x, search: e.target.value }))} placeholder="Search…" style={{ ...S.inp, marginBottom: '10px' }} />
              <div style={{ overflowY: 'auto', flex: 1 }}>
                {list.length === 0 && <div style={{ fontSize: '12px', color: T.textMuted, padding: '20px', textAlign: 'center' }}>Nothing found.</div>}
                {list.slice(0, 200).map(r => (
                  <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 4px', borderBottom: `1px solid ${T.border}` }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '12px', fontWeight: 600, color: T.textPrimary }}>{r.title}</div>
                      <div style={{ fontSize: '10px', color: T.textMuted }}>
                        {picker.type === 'template_report' ? [r.site_name, r.template_name, r.status].filter(Boolean).join(' · ') : [r.doc_type, r.category, r.brand].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                    {linked.has(r.id)
                      ? <span style={{ fontSize: '11px', color: T.green, fontWeight: 700 }}><i className="ti ti-check" /> Linked</span>
                      : <button onClick={() => addLink(picker.type, r)} style={{ ...S.iconBtn(T.blue), fontSize: '11px' }}><i className="ti ti-link" />Link</button>}
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '12px' }}><button onClick={() => setPicker(null)} style={S.ghost}>Done</button></div>
            </div>
          </div>
        )
      })()}

      {archive && (
        <div style={S.overlay} onClick={e => { if (e.target === e.currentTarget && !archive.busy) setArchive(null) }}>
          <div style={{ ...cardStyle, width: '100%', maxWidth: '520px', padding: '22px' }}>
            <div style={{ fontSize: '16px', fontWeight: 800, color: T.textPrimary, marginBottom: '6px' }}><i className="ti ti-file-zip" style={{ color: T.blue }} /> Download project archive</div>
            <div style={{ fontSize: '12px', color: T.textSecondary, marginBottom: '14px' }}>Compiles everything in <b>{p.name}</b>, across all 8 stages: notes, checklists, BOQs, cable schedules, design packs, checklist reports, library documents and uploaded files.</div>
            {[
              ['zip', 'ZIP archive', 'A cover/summary PDF and checklist Excel, plus a folder per stage (01 Site Visit … 08 Handover) with every file in its original format: Word, Excel, PDF, photos, CAD.'],
              ['pdf', 'Merged PDF', 'One PDF: cover, contents, stage summary, then each stage\'s checklist, notes, reports, BOQ quotes, cable schedules, design packs, PDFs and photos. Files that can\'t be shown in a PDF are listed at the end.'],
              ['save', 'Also save a copy in this project', 'Stores the archive under Handover → Files & photos, so it stays with the project.'],
            ].map(([k, label, desc]) => (
              <label key={k} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '9px 0', borderTop: `1px solid ${T.border}`, cursor: archive.busy ? 'default' : 'pointer' }}>
                <input type="checkbox" checked={!!archive[k]} disabled={archive.busy} onChange={e => setArchive(a => ({ ...a, [k]: e.target.checked }))} style={{ marginTop: '2px', accentColor: T.blue }} />
                <span><span style={{ fontSize: '13px', fontWeight: 700, color: T.textPrimary }}>{label}</span><br /><span style={{ fontSize: '11px', color: T.textMuted }}>{desc}</span></span>
              </label>
            ))}
            {archive.busy && (
              <div style={{ marginTop: '12px', fontSize: '12px', color: T.textSecondary, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <i className="ti ti-loader-2" style={{ color: T.blue }} />{archive.progress || 'Working…'}
              </div>
            )}
            {archive.error && <div style={{ marginTop: '12px', fontSize: '12px', color: T.red }}>{archive.error}</div>}
            {archive.result && (
              <div style={{ marginTop: '12px', fontSize: '12px', color: T.textSecondary, background: T.bgMuted, borderRadius: '8px', padding: '10px 12px' }}>
                <div style={{ color: T.green, fontWeight: 700, marginBottom: '6px' }}><i className="ti ti-circle-check" /> Archive ready, your download has started.</div>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {archive.result.zipBlob && <button onClick={() => saveBlobAs(archive.result.zipBlob, archive.result.zipName)} style={S.iconBtn(T.blue)}><i className="ti ti-download" />ZIP ({fmtSize(archive.result.zipBlob.size)})</button>}
                  {archive.result.pdfBlob && <button onClick={() => saveBlobAs(archive.result.pdfBlob, archive.result.pdfName)} style={S.iconBtn(T.blue)}><i className="ti ti-download" />PDF ({fmtSize(archive.result.pdfBlob.size)})</button>}
                </div>
                {archive.result.problems.length > 0 && (
                  <div style={{ marginTop: '8px', color: T.orange }}>
                    <b>{archive.result.problems.length} item{archive.result.problems.length === 1 ? '' : 's'} could not be included:</b>
                    <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>{archive.result.problems.slice(0, 8).map((m, i) => <li key={i}>{m}</li>)}</ul>
                  </div>
                )}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
              <button onClick={() => setArchive(null)} disabled={archive.busy} style={S.ghost}>{archive.result ? 'Close' : 'Cancel'}</button>
              <button onClick={buildArchive} disabled={archive.busy} style={{ ...S.btn(T.blue), opacity: archive.busy ? 0.6 : 1 }}><i className="ti ti-file-zip" />{archive.busy ? 'Compiling…' : archive.result ? 'Compile again' : 'Compile & download'}</button>
            </div>
          </div>
        </div>
      )}

      {confirmItem && (
        <div style={S.overlay} onClick={e => { if (e.target === e.currentTarget) setConfirmItem(null) }}>
          <div style={{ ...cardStyle, width: '100%', maxWidth: '400px', padding: '22px' }}>
            <div style={{ fontSize: '15px', fontWeight: 800, color: T.textPrimary, marginBottom: '8px' }}>Delete {(WORK_KINDS[confirmItem.kind] || WORK_KINDS.boq).label}?</div>
            <div style={{ fontSize: '12px', color: T.textSecondary, marginBottom: '16px' }}><b>{confirmItem.title}</b> will be permanently deleted from this project. Download it first if you need a copy.</div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button onClick={() => setConfirmItem(null)} style={S.ghost}>Cancel</button>
              <button onClick={() => deleteItem(confirmItem)} style={S.btn(T.red)}><i className="ti ti-trash" />Delete</button>
            </div>
          </div>
        </div>
      )}

      {confirmFile && (
        <div style={S.overlay} onClick={e => { if (e.target === e.currentTarget) setConfirmFile(null) }}>
          <div style={{ ...cardStyle, width: '100%', maxWidth: '400px', padding: '22px' }}>
            <div style={{ fontSize: '15px', fontWeight: 800, color: T.textPrimary, marginBottom: '8px' }}>Delete file?</div>
            <div style={{ fontSize: '12px', color: T.textSecondary, marginBottom: '16px' }}><b>{confirmFile.file_name}</b> will be permanently deleted from this project.</div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button onClick={() => setConfirmFile(null)} style={S.ghost}>Cancel</button>
              <button onClick={() => removeFile(confirmFile)} style={S.btn(T.red)}><i className="ti ti-trash" />Delete</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div style={{ position: 'fixed', bottom: '24px', right: '24px', background: T.isDark ? '#1f2d42' : '#1a2a4a', color: '#fff', padding: '10px 16px', borderRadius: '8px', fontSize: '12px', fontWeight: 600, zIndex: 1100, boxShadow: '0 6px 20px rgba(0,0,0,0.25)' }}>{toast}</div>}
    </div>
  )
}
