'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { supabase } from '@/lib/supabase'

// Editor + exporters are loaded only when a document is opened (keeps the dashboard fast)
const DocEditor = dynamic(() => import('./DocEditor'), { ssr: false, loading: () => <div style={{ padding: 40, textAlign: 'center', fontSize: 13, color: '#8698ad' }}>Loading editor…</div> })
const exporters = () => import('@/lib/templateExport')

// ─────────────────────────────────────────────────────────────────────────────
// Engineering Templates library
//  • Template library: uploaded files (Storage bucket "engineering-templates") and
//    editable document templates (HTML in engineering_templates.content_html)
//  • Reports: filled-in copies saved per site (table template_reports)
//  • Edit on the website; download as Word, PDF or Excel
// SQL: supabase/engineering_templates.sql, then supabase/template_documents.sql
// ─────────────────────────────────────────────────────────────────────────────

const BUCKET = 'engineering-templates'
const IMG_BUCKET = 'template-images'
const TABLE = 'engineering_templates'
const REPORTS = 'template_reports'
export const TEMPLATE_CATEGORIES = ['Commissioning & Testing', 'Site & O&M', 'Handover & Guides', 'Other']
const CATEGORY_ICONS = { 'Commissioning & Testing': 'ti-clipboard-check', 'Site & O&M': 'ti-tool', 'Handover & Guides': 'ti-book', Other: 'ti-folder' }
const STATUSES = ['Draft', 'In progress', 'Complete']
const MAX_MB = 50

const FILE_TYPES = [
  [/\.(xlsx|xlsm|xls|csv)$/i, 'ti-file-spreadsheet', '#3F8F2A', 'Excel'],
  [/\.(docx|doc|dotx)$/i, 'ti-file-text', '#0B74D7', 'Word'],
  [/\.pdf$/i, 'ti-file-type-pdf', '#D93A3A', 'PDF'],
  [/\.(pptx|ppt)$/i, 'ti-presentation', '#F66524', 'PowerPoint'],
  [/\.(dwg|dxf)$/i, 'ti-ruler-2', '#505050', 'CAD'],
  [/\.(png|jpe?g|svg)$/i, 'ti-photo', '#579FE4', 'Image'],
  [/\.zip$/i, 'ti-file-zip', '#505050', 'ZIP'],
]
const fileType = name => {
  const hit = FILE_TYPES.find(([re]) => re.test(name || ''))
  return hit ? { icon: hit[1], color: hit[2], label: hit[3] } : { icon: 'ti-file', color: '#505050', label: (name || '').split('.').pop()?.toUpperCase() || 'File' }
}
const fmtSize = b => (b == null ? '' : b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`)
const fmtDate = d => (d ? new Date(d).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }) : '')
const fmtTime = d => (d ? new Date(d).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }) : '')
const today = () => new Date().toISOString().slice(0, 10)
const safeName = n => n.replace(/[^a-zA-Z0-9.\-_]/g, '_')
const bumpVersion = v => {
  const m = String(v || '').match(/^(.*?)(\d+)$/)
  if (!m) return v ? `${v}.1` : 'Rev 1'
  return `${m[1]}${String(Number(m[2]) + 1).padStart(m[2].length, '0')}`
}
const reportTitle = (site, name, date) => [site, name, fmtDate(date)].filter(Boolean).join(' – ')

// Project mode (opened from Engineering Tools → Projects):
//   project: { name, site_name } pre-fills the site for new reports; onReportCreated(report) lets the project link it;
//   openReportId opens that report straight away; onExit is called when a report is closed, to return to the project.
export default function TemplatesTool({ T, cardStyle, selectStyle, userName, sites = [], project, onReportCreated, openReportId, onExit }) {
  const [view, setView] = useState('library') // library | reports
  const [items, setItems] = useState([])
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [docsReady, setDocsReady] = useState(true)
  const [search, setSearch] = useState('')
  const [cat, setCat] = useState('All')
  const [repSite, setRepSite] = useState('All')
  const [repTpl, setRepTpl] = useState('All')
  const [modal, setModal] = useState(null)
  const [newReport, setNewReport] = useState(null)
  const [confirmDel, setConfirmDel] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [toast, setToast] = useState('')
  const [doc, setDoc] = useState(null) // open document: { kind: 'report'|'template', id, ...meta }
  const fileRef = useRef(null)

  async function load() {
    setLoading(true)
    setLoadError('')
    const { data, error } = await supabase.from(TABLE).select('*').order('category').order('name')
    if (error) {
      setLoadError(/relation|does not exist|schema cache/i.test(error.message)
        ? 'The templates library is not set up yet. Run supabase/engineering_templates.sql once in the Supabase SQL Editor.'
        : `Could not load templates: ${error.message}`)
      setItems([])
    } else setItems(data || [])
    const rep = await supabase.from(REPORTS).select('id, template_id, template_name, title, site_name, report_date, status, created_by, updated_by, created_at, updated_at').order('updated_at', { ascending: false })
    if (rep.error) { setDocsReady(false); setReports([]) } else { setDocsReady(true); setReports(rep.data || []) }
    setLoading(false)
  }
  useEffect(() => { load() }, [])
  useEffect(() => { if (openReportId) openReport({ id: openReportId }) }, [openReportId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 3500); return () => clearTimeout(t) }, [toast])

  const siteNames = useMemo(() => [...new Set((sites || []).map(s => (typeof s === 'string' ? s : s?.name)).filter(Boolean).map(s => s.trim()))].sort((a, b) => a.localeCompare(b)), [sites])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter(x => (cat === 'All' || x.category === cat)
      && (!q || `${x.name} ${x.description || ''} ${x.file_name || ''} ${x.version || ''}`.toLowerCase().includes(q)))
  }, [items, search, cat])
  const groups = useMemo(() => {
    const order = [...TEMPLATE_CATEGORIES, ...new Set(items.map(i => i.category).filter(c => !TEMPLATE_CATEGORIES.includes(c)))]
    return order.map(c => ({ cat: c, list: filtered.filter(x => x.category === c) })).filter(g => g.list.length)
  }, [filtered, items])
  const counts = useMemo(() => items.reduce((a, x) => { a[x.category] = (a[x.category] || 0) + 1; return a }, {}), [items])
  const filteredReports = useMemo(() => {
    const q = search.trim().toLowerCase()
    return reports.filter(r => (repSite === 'All' || r.site_name === repSite) && (repTpl === 'All' || r.template_name === repTpl)
      && (!q || `${r.title} ${r.site_name || ''} ${r.template_name || ''} ${r.status || ''}`.toLowerCase().includes(q)))
  }, [reports, repSite, repTpl, search])

  // ── library actions (files) ──
  function openAdd(editable = false) {
    setModal({ mode: 'add', editable, form: { category: cat !== 'All' ? cat : TEMPLATE_CATEGORIES[0], name: '', description: '', version: 'Rev 00' }, file: null, saving: false, error: '' })
  }
  function openEdit(x) {
    setModal({ mode: 'edit', id: x.id, item: x, form: { category: x.category, name: x.name, description: x.description || '', version: x.version || '' }, file: null, saving: false, error: '' })
  }
  function openReplace(x) {
    setModal({ mode: 'replace', id: x.id, item: x, form: { category: x.category, name: x.name, description: x.description || '', version: bumpVersion(x.version) }, file: null, saving: false, error: '' })
  }
  const setForm = (k, v) => setModal(m => ({ ...m, form: { ...m.form, [k]: v } }))
  function pickFile(f) {
    if (!f) return
    if (f.size > MAX_MB * 1024 * 1024) { setModal(m => ({ ...m, error: `That file is ${fmtSize(f.size)}. The limit is ${MAX_MB} MB.` })); return }
    setModal(m => ({ ...m, file: f, error: '', form: { ...m.form, name: m.form.name || f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() } }))
  }

  async function save() {
    const m = modal
    const f = m.form
    if (!f.name.trim()) { setModal(x => ({ ...x, error: 'Please give the template a name.' })); return }
    if (!m.editable && (m.mode === 'add' || m.mode === 'replace') && !m.file) { setModal(x => ({ ...x, error: 'Please choose a file to upload.' })); return }
    setModal(x => ({ ...x, saving: true, error: '' }))
    try {
      let fileFields = {}
      if (m.file) {
        const path = `${safeName(f.category)}/${Date.now()}-${safeName(m.file.name)}`
        const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, m.file, { upsert: false, contentType: m.file.type || undefined })
        if (upErr) throw new Error(`Upload failed: ${upErr.message}`)
        fileFields = { file_path: path, file_name: m.file.name, file_size: m.file.size, file_type: m.file.type || null }
      }
      const payload = { category: f.category, name: f.name.trim(), description: f.description.trim() || null, version: f.version.trim() || null, updated_by: userName || null, ...fileFields }
      if (m.mode === 'add') {
        if (m.editable) payload.content_html = `<h1>${f.name.trim().replace(/[<>&]/g, '')}</h1><p></p>`
        const { data, error } = await supabase.from(TABLE).insert([{ ...payload, created_by: userName || null }]).select().single()
        if (error) { if (fileFields.file_path) await supabase.storage.from(BUCKET).remove([fileFields.file_path]); throw error }
        setModal(null)
        if (m.editable && data) { openTemplateDoc(data); return }
      } else {
        const { error } = await supabase.from(TABLE).update(payload).eq('id', m.id)
        if (error) { if (fileFields.file_path) await supabase.storage.from(BUCKET).remove([fileFields.file_path]); throw error }
        if (fileFields.file_path && m.item?.file_path) await supabase.storage.from(BUCKET).remove([m.item.file_path])
        setModal(null)
      }
      setToast(m.mode === 'add' ? 'Template added' : m.mode === 'replace' ? 'New version uploaded' : 'Details saved')
      load()
    } catch (e) {
      setModal(x => ({ ...x, saving: false, error: e.message || String(e) }))
    }
  }

  async function downloadFile(x) {
    setBusyId(x.id)
    try {
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(x.file_path, 120, { download: x.file_name || true })
      if (error) throw error
      const a = document.createElement('a')
      a.href = data.signedUrl; a.rel = 'noopener'
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
    } catch (e) { setToast(`Download failed: ${e.message || e}`) } finally { setBusyId(null) }
  }

  // Deleting needs the user's own portal password (re-checked with Supabase sign-in)
  const [delPw, setDelPw] = useState('')
  const [delErr, setDelErr] = useState('')
  const [delChecking, setDelChecking] = useState(false)
  const openDelete = d => { setDelPw(''); setDelErr(''); setConfirmDel(d) }
  async function confirmDelete() {
    if (!delPw) { setDelErr('Enter your password to delete.'); return }
    setDelChecking(true); setDelErr('')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user?.email) throw new Error('You are not signed in. Please sign in again.')
      const { error } = await supabase.auth.signInWithPassword({ email: user.email, password: delPw })
      if (error) { setDelErr('Incorrect password. Nothing was deleted.'); return }
      setDelPw('')
      if (confirmDel.type === 'report') await removeReport(confirmDel.item)
      else await removeTemplate(confirmDel.item)
    } catch (e) {
      setDelErr(e.message || String(e))
    } finally { setDelChecking(false) }
  }

  async function removeTemplate(x) {
    setBusyId(x.id)
    const { error } = await supabase.from(TABLE).delete().eq('id', x.id)
    if (!error && x.file_path) await supabase.storage.from(BUCKET).remove([x.file_path])
    setBusyId(null); setConfirmDel(null)
    if (error) setToast(`Delete failed: ${error.message}`)
    else { setToast('Template deleted'); load() }
  }
  async function removeReport(r) {
    setBusyId(r.id)
    const { error } = await supabase.from(REPORTS).delete().eq('id', r.id)
    setBusyId(null); setConfirmDel(null)
    if (error) setToast(`Delete failed: ${error.message}`)
    else { setToast('Report deleted'); load() }
  }

  // ── documents ──
  function openTemplateDoc(x) {
    setDoc({ kind: 'template', id: x.id, title: x.name, version: x.version || '', category: x.category, html: x.content_html || '', updatedAt: x.updated_at })
  }
  function startReport(x) {
    if (!docsReady) { setToast('Run supabase/template_documents.sql in Supabase first to save reports.'); return }
    setNewReport({ template: x, site: (project?.site_name || project?.name || '').trim(), date: today(), saving: false, error: '' })
  }
  async function createReport() {
    const nr = newReport
    if (!nr.site.trim()) { setNewReport(v => ({ ...v, error: 'Please choose or type the site.' })); return }
    setNewReport(v => ({ ...v, saving: true, error: '' }))
    const { data: tpl, error: tErr } = await supabase.from(TABLE).select('content_html').eq('id', nr.template.id).single()
    if (tErr) { setNewReport(v => ({ ...v, saving: false, error: tErr.message })); return }
    const row = {
      template_id: nr.template.id, template_name: nr.template.name, site_name: nr.site.trim(), report_date: nr.date || null,
      title: reportTitle(nr.site.trim(), nr.template.name, nr.date), status: 'Draft', content_html: tpl.content_html || '',
      created_by: userName || null, updated_by: userName || null,
    }
    const { data, error } = await supabase.from(REPORTS).insert([row]).select().single()
    if (error) { setNewReport(v => ({ ...v, saving: false, error: error.message })); return }
    setNewReport(null)
    if (onReportCreated) { try { await onReportCreated(data) } catch (e) { /* ignore */ } }
    setDoc({ kind: 'report', id: data.id, title: data.title, site: data.site_name, date: data.report_date || '', status: data.status, templateName: data.template_name, html: data.content_html, updatedAt: data.updated_at })
    load()
  }
  async function openReport(r) {
    setBusyId(r.id)
    const { data, error } = await supabase.from(REPORTS).select('*').eq('id', r.id).single()
    setBusyId(null)
    if (error) { setToast(`Could not open: ${error.message}`); return }
    setDoc({ kind: 'report', id: data.id, title: data.title, site: data.site_name, date: data.report_date || '', status: data.status, templateName: data.template_name, html: data.content_html, updatedAt: data.updated_at })
  }
  async function duplicateReport(r) {
    setBusyId(r.id)
    const { data, error } = await supabase.from(REPORTS).select('*').eq('id', r.id).single()
    if (!error) {
      const { id, created_at, updated_at, ...rest } = data
      const ins = await supabase.from(REPORTS).insert([{ ...rest, title: `${data.title} (copy)`, status: 'Draft', created_by: userName || null, updated_by: userName || null }])
      if (ins.error) setToast(`Copy failed: ${ins.error.message}`); else setToast('Copy created')
    }
    setBusyId(null)
    load()
  }
  async function quickDownload(r, fmt) {
    setBusyId(r.id)
    try {
      const { data, error } = await supabase.from(REPORTS).select('*').eq('id', r.id).single()
      if (error) throw error
      await exportDoc(fmt, data.content_html, { title: data.title, subtitle: [data.site_name, fmtDate(data.report_date), data.status].filter(Boolean).join(' · ') })
    } catch (e) { setToast(`Download failed: ${e.message || e}`) } finally { setBusyId(null) }
  }

  // ── Install the Sosimple template library (15 ready-made templates, public/templates/library.json) ──
  const [installing, setInstalling] = useState(false)
  const editableCount = items.filter(x => x.content_html != null).length
  async function installLibrary() {
    setInstalling(true)
    try {
      const res = await fetch('/templates/library.json', { cache: 'no-store' })
      if (!res.ok) throw new Error(`library file not found (${res.status})`)
      const lib = await res.json()
      const have = new Set(items.filter(x => x.content_html != null).map(x => x.name.trim().toLowerCase()))
      const rows = lib.filter(t => !have.has(t.name.trim().toLowerCase()))
        .map(t => ({ ...t, created_by: 'Template library', updated_by: userName || 'Template library' }))
      if (!rows.length) { setToast('All library templates are already installed'); return }
      for (let i = 0; i < rows.length; i += 5) {
        const { error } = await supabase.from(TABLE).insert(rows.slice(i, i + 5))
        if (error) throw error
      }
      setToast(`${rows.length} templates added`)
      load()
    } catch (e) {
      setToast(`Install failed: ${e.message || e}`)
    } finally { setInstalling(false) }
  }

  async function uploadImage(file) {
    if (file.size > 10 * 1024 * 1024) { setToast('Photos must be under 10 MB'); return null }
    const path = `${new Date().toISOString().slice(0, 7)}/${Date.now()}-${safeName(file.name)}`
    const { error } = await supabase.storage.from(IMG_BUCKET).upload(path, file, { upsert: false, contentType: file.type || undefined })
    if (error) { setToast(`Photo upload failed: ${error.message}`); return null }
    return supabase.storage.from(IMG_BUCKET).getPublicUrl(path).data.publicUrl
  }

  // ── styles ──
  const btn = (bg, fg = '#fff', border = 'none') => ({ padding: '8px 14px', background: bg, color: fg, border, borderRadius: '7px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px' })
  const ghost = btn('transparent', T.textSecondary, `1px solid ${T.border}`)
  const iconBtn = color => ({ background: 'transparent', border: `1px solid ${T.border}`, color, borderRadius: '6px', padding: '5px 8px', cursor: 'pointer', fontSize: '13px', display: 'inline-flex', alignItems: 'center', gap: '4px' })
  const labelStyle = { fontSize: '10px', fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '4px' }
  const inp = { ...selectStyle, cursor: 'text', width: '100%', boxSizing: 'border-box' }
  const chip = active => ({
    padding: '7px 13px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', borderRadius: '999px',
    border: `1px solid ${active ? T.blue : T.border}`, background: active ? T.blue : T.bgPanel, color: active ? '#fff' : T.textSecondary,
    display: 'inline-flex', alignItems: 'center', gap: '6px',
  })
  const tabBtn = active => ({ padding: '9px 16px', fontSize: '13px', fontWeight: 800, cursor: 'pointer', border: 'none', borderBottom: `3px solid ${active ? T.blue : 'transparent'}`, background: 'transparent', color: active ? T.textPrimary : T.textMuted, display: 'inline-flex', alignItems: 'center', gap: '7px' })
  const statusColor = s => (s === 'Complete' ? T.green : s === 'In progress' ? T.orange : T.textMuted)

  if (doc) {
    return (
      <DocumentView key={doc.id} doc={doc} T={T} cardStyle={cardStyle} selectStyle={selectStyle} userName={userName} siteNames={siteNames}
        uploadImage={uploadImage} onClose={() => { setDoc(null); load(); if (project && onExit) onExit() }} btn={btn} ghost={ghost} labelStyle={labelStyle} inp={inp} />
    )
  }

  return (
    <div>
      {project && (
        <div style={{ ...cardStyle, padding: '10px 14px', marginBottom: '12px', borderLeft: `3px solid ${T.blue}`, fontSize: '12px', color: T.textSecondary }}>
          <i className="ti ti-briefcase" style={{ color: T.blue }} /> Working in project <b>{project.name}</b>. Pick a template and click <b>Fill in for a site</b>: the site is filled in for you and the report is linked to the project.
        </div>
      )}
      <div style={{ display: 'flex', gap: '4px', borderBottom: `1px solid ${T.border}`, marginBottom: '14px' }}>
        <button onClick={() => setView('library')} style={tabBtn(view === 'library')}><i className="ti ti-folders" />Templates <span style={{ fontWeight: 600, color: T.textMuted }}>{items.length}</span></button>
        <button onClick={() => setView('reports')} style={tabBtn(view === 'reports')}><i className="ti ti-file-check" />Completed reports <span style={{ fontWeight: 600, color: T.textMuted }}>{reports.length}</span></button>
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
        {view === 'library' ? (
          <>
            <button onClick={() => setCat('All')} style={chip(cat === 'All')}>All <span style={{ opacity: 0.8 }}>{items.length}</span></button>
            {TEMPLATE_CATEGORIES.map(c => (
              <button key={c} onClick={() => setCat(c)} style={chip(cat === c)}><i className={`ti ${CATEGORY_ICONS[c] || 'ti-folder'}`} />{c} <span style={{ opacity: 0.8 }}>{counts[c] || 0}</span></button>
            ))}
          </>
        ) : (
          <>
            <select value={repSite} onChange={e => setRepSite(e.target.value)} style={selectStyle}>
              <option value="All">All sites</option>
              {[...new Set(reports.map(r => r.site_name).filter(Boolean))].sort().map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={repTpl} onChange={e => setRepTpl(e.target.value)} style={selectStyle}>
              <option value="All">All templates</option>
              {[...new Set(reports.map(r => r.template_name).filter(Boolean))].sort().map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </>
        )}
        <div style={{ flex: 1 }} />
        <div style={{ position: 'relative' }}>
          <i className="ti ti-search" style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: T.textMuted, fontSize: '13px' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder={view === 'library' ? 'Search templates…' : 'Search reports…'} style={{ ...inp, width: '220px', paddingLeft: '30px' }} />
        </div>
        {view === 'library' && (
          <>
            <button onClick={() => openAdd(true)} disabled={!!loadError || !docsReady} style={btn(T.green)} title={docsReady ? 'Create a template that can be edited on the website' : 'Run supabase/template_documents.sql first'}><i className="ti ti-file-plus" />New editable template</button>
            <button onClick={() => openAdd(false)} disabled={!!loadError && !items.length} style={btn(T.blue)}><i className="ti ti-upload" />Upload file</button>
          </>
        )}
      </div>

      {toast && <div style={{ ...cardStyle, padding: '9px 14px', marginBottom: '12px', borderLeft: `3px solid ${/failed|Run /.test(toast) ? T.red : T.green}`, fontSize: '12px', fontWeight: 600, color: T.textPrimary }}>{toast}</div>}
      {loadError && <div style={{ ...cardStyle, padding: '12px 14px', marginBottom: '12px', borderLeft: `3px solid ${T.orange}`, fontSize: '12px', color: T.textSecondary }}><i className="ti ti-alert-triangle" style={{ color: T.orange, marginRight: '6px' }} />{loadError}</div>}
      {!loadError && !docsReady && !loading && (
        <div style={{ ...cardStyle, padding: '12px 14px', marginBottom: '12px', borderLeft: `3px solid ${T.orange}`, fontSize: '12px', color: T.textSecondary }}>
          <i className="ti ti-alert-triangle" style={{ color: T.orange, marginRight: '6px' }} />Editing on the website is not switched on yet. Run <b>supabase/template_documents.sql</b> once in the Supabase SQL Editor.
        </div>
      )}

      {!loading && !loadError && docsReady && view === 'library' && editableCount < 15 && (
        <div style={{ ...cardStyle, padding: '14px 16px', marginBottom: '12px', borderLeft: `3px solid ${T.blue}`, display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <i className="ti ti-books" style={{ fontSize: '22px', color: T.blue }} />
          <div style={{ flex: 1, minWidth: '240px' }}>
            <div style={{ fontSize: '13px', fontWeight: 800, color: T.textPrimary }}>{editableCount === 0 ? 'Add the Sosimple template library' : 'Some library templates are missing'}</div>
            <div style={{ fontSize: '12px', color: T.textSecondary }}>15 ready-made templates built from your documents (site inspection, O&amp;M checklist, incident report, test certificates, punch list and handover guides) with all wording in place and editable.</div>
          </div>
          <button onClick={installLibrary} disabled={installing} style={btn(T.blue)}><i className="ti ti-download" />{installing ? 'Adding…' : editableCount === 0 ? 'Add 15 templates' : 'Add missing templates'}</button>
        </div>
      )}

      {loading ? (
        <div style={{ ...cardStyle, padding: '40px', textAlign: 'center', color: T.textMuted, fontSize: '13px' }}>Loading…</div>
      ) : view === 'library' ? (
        groups.length === 0 ? (!loadError && (
          <div style={{ ...cardStyle, padding: '44px 20px', textAlign: 'center', color: T.textMuted, fontSize: '13px' }}>
            <i className="ti ti-folders" style={{ fontSize: '34px', display: 'block', marginBottom: '10px', color: T.blue }} />
            {items.length ? 'No templates match your search.' : <>No templates yet. Click <b>Upload file</b> or <b>New editable template</b>.</>}
          </div>
        )) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
            {groups.map(g => (
              <div key={g.cat}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                  <i className={`ti ${CATEGORY_ICONS[g.cat] || 'ti-folder'}`} style={{ color: T.blue }} />
                  <span style={{ fontSize: '14px', fontWeight: 800, color: T.textPrimary }}>{g.cat}</span>
                  <span style={{ fontSize: '11px', color: T.textMuted }}>{g.list.length} template{g.list.length === 1 ? '' : 's'}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '12px' }}>
                  {g.list.map(x => {
                    const editable = x.content_html != null
                    const ft = editable ? { icon: 'ti-file-pencil', color: '#0B74D7', label: 'Editable document' } : fileType(x.file_name)
                    const nRep = reports.filter(r => r.template_id === x.id).length
                    return (
                      <div key={x.id} style={{ ...cardStyle, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '10px', borderTop: `3px solid ${ft.color}` }}>
                        <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                          <div style={{ width: '40px', height: '40px', borderRadius: '8px', background: `${ft.color}18`, color: ft.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px', flexShrink: 0 }}><i className={`ti ${ft.icon}`} /></div>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontSize: '13px', fontWeight: 800, color: T.textPrimary, lineHeight: 1.3 }}>{x.name}</div>
                            <div style={{ fontSize: '11px', color: T.textMuted, marginTop: '3px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                              {x.version && <span style={{ fontWeight: 700, color: T.blue }}>{x.version}</span>}
                              <span>{ft.label}{!editable && x.file_size ? ` · ${fmtSize(x.file_size)}` : ''}</span>
                              {editable && nRep > 0 && <span>· {nRep} report{nRep === 1 ? '' : 's'}</span>}
                            </div>
                          </div>
                        </div>
                        {x.description && <div style={{ fontSize: '12px', color: T.textSecondary, lineHeight: 1.5 }}>{x.description}</div>}
                        <div style={{ fontSize: '11px', color: T.textMuted }}>Updated {fmtDate(x.updated_at || x.created_at)}{x.updated_by ? ` by ${x.updated_by}` : ''}</div>
                        <div style={{ display: 'flex', gap: '6px', marginTop: 'auto', flexWrap: 'wrap' }}>
                          {editable ? (
                            <>
                              <button onClick={() => startReport(x)} style={{ ...btn(T.blue), padding: '6px 12px' }}><i className="ti ti-pencil-plus" />Fill in for a site</button>
                              <button onClick={() => openTemplateDoc(x)} style={{ ...ghost, padding: '6px 10px' }} title="Edit the master template"><i className="ti ti-edit" />Edit template</button>
                            </>
                          ) : (
                            <button onClick={() => downloadFile(x)} disabled={busyId === x.id || !x.file_path} style={{ ...btn(T.green), padding: '6px 12px' }}><i className="ti ti-download" />{busyId === x.id ? 'Preparing…' : 'Download'}</button>
                          )}
                          {editable && x.file_path && <button title="Download original file" onClick={() => downloadFile(x)} style={iconBtn(T.textSecondary)}><i className="ti ti-paperclip" /></button>}
                          <div style={{ flex: 1 }} />
                          {!editable && <button title="Upload a new version" onClick={() => openReplace(x)} style={iconBtn(T.textSecondary)}><i className="ti ti-refresh" /></button>}
                          <button title="Edit details" onClick={() => openEdit(x)} style={iconBtn(T.textSecondary)}><i className="ti ti-settings" /></button>
                          <button title="Delete" onClick={() => openDelete({ type: 'template', item: x })} style={iconBtn(T.red)}><i className="ti ti-trash" /></button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )
      ) : (
        // Reports list
        filteredReports.length === 0 ? (
          <div style={{ ...cardStyle, padding: '44px 20px', textAlign: 'center', color: T.textMuted, fontSize: '13px' }}>
            <i className="ti ti-file-check" style={{ fontSize: '34px', display: 'block', marginBottom: '10px', color: T.blue }} />
            {reports.length ? 'No reports match your filters.' : <>No reports yet. Open the <b>Templates</b> tab and click <b>Fill in for a site</b>.</>}
          </div>
        ) : (
          <div style={{ ...cardStyle, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '860px' }}>
                <thead><tr>
                  {['Report', 'Site', 'Template', 'Date', 'Status', 'Last updated', ''].map(h => (
                    <th key={h} style={{ padding: '10px 12px', fontSize: '10px', fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: 'left', borderBottom: `1px solid ${T.border}`, background: T.bgMuted }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {filteredReports.map(r => (
                    <tr key={r.id} style={{ borderBottom: `1px solid ${T.border}` }}>
                      <td style={{ padding: '9px 12px', fontSize: '12px', fontWeight: 700, color: T.textPrimary }}>
                        <button onClick={() => openReport(r)} style={{ background: 'none', border: 'none', padding: 0, color: T.blue, fontWeight: 700, cursor: 'pointer', fontSize: '12px', textAlign: 'left' }}>{r.title}</button>
                      </td>
                      <td style={{ padding: '9px 12px', fontSize: '12px', color: T.textSecondary }}>{r.site_name}</td>
                      <td style={{ padding: '9px 12px', fontSize: '12px', color: T.textSecondary }}>{r.template_name}</td>
                      <td style={{ padding: '9px 12px', fontSize: '12px', color: T.textSecondary, whiteSpace: 'nowrap' }}>{fmtDate(r.report_date)}</td>
                      <td style={{ padding: '9px 12px' }}><span style={{ fontSize: '11px', fontWeight: 700, color: statusColor(r.status), border: `1px solid ${statusColor(r.status)}55`, borderRadius: '999px', padding: '2px 9px', whiteSpace: 'nowrap' }}>{r.status}</span></td>
                      <td style={{ padding: '9px 12px', fontSize: '11px', color: T.textMuted, whiteSpace: 'nowrap' }}>{fmtDate(r.updated_at)}{r.updated_by ? ` · ${r.updated_by}` : ''}</td>
                      <td style={{ padding: '9px 12px' }}>
                        <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end' }}>
                          <button title="Open / edit" onClick={() => openReport(r)} style={iconBtn(T.blue)}><i className="ti ti-edit" /></button>
                          <button title="Download Word" onClick={() => quickDownload(r, 'docx')} disabled={busyId === r.id} style={iconBtn(T.textSecondary)}><i className="ti ti-file-type-docx" /></button>
                          <button title="Print / save PDF" onClick={() => quickDownload(r, 'pdf')} disabled={busyId === r.id} style={iconBtn(T.textSecondary)}><i className="ti ti-file-type-pdf" /></button>
                          <button title="Download Excel" onClick={() => quickDownload(r, 'xlsx')} disabled={busyId === r.id} style={iconBtn(T.textSecondary)}><i className="ti ti-file-spreadsheet" /></button>
                          <button title="Make a copy" onClick={() => duplicateReport(r)} disabled={busyId === r.id} style={iconBtn(T.textSecondary)}><i className="ti ti-copy" /></button>
                          <button title="Delete" onClick={() => openDelete({ type: 'report', item: r })} style={iconBtn(T.red)}><i className="ti ti-trash" /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}

      {/* New report dialog */}
      {newReport && (
        <div onClick={() => !newReport.saving && setNewReport(null)} style={overlay}>
          <div onClick={e => e.stopPropagation()} style={{ ...cardStyle, background: T.bgPanel, width: 'min(480px, 100%)', padding: '20px 22px' }}>
            <div style={{ fontSize: '15px', fontWeight: 800, color: T.textPrimary, marginBottom: '4px' }}>Fill in: {newReport.template.name}</div>
            <div style={{ fontSize: '12px', color: T.textMuted, marginBottom: '14px' }}>A new copy of the template is saved against the site, so the original stays clean.</div>
            <label style={{ display: 'block', marginBottom: '12px' }}>
              <div style={labelStyle}>Site</div>
              <input list="tpl-site-list" value={newReport.site} onChange={e => setNewReport(v => ({ ...v, site: e.target.value }))} placeholder="Choose or type a site name" style={inp} autoFocus />
              <datalist id="tpl-site-list">{siteNames.map(s => <option key={s} value={s} />)}</datalist>
            </label>
            <label style={{ display: 'block' }}>
              <div style={labelStyle}>Date</div>
              <input type="date" value={newReport.date} onChange={e => setNewReport(v => ({ ...v, date: e.target.value }))} style={inp} />
            </label>
            {newReport.error && <div style={{ marginTop: '12px', fontSize: '12px', color: T.red, fontWeight: 600 }}>{newReport.error}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '18px' }}>
              <button onClick={() => setNewReport(null)} disabled={newReport.saving} style={ghost}>Cancel</button>
              <button onClick={createReport} disabled={newReport.saving} style={btn(T.blue)}><i className="ti ti-arrow-right" />{newReport.saving ? 'Creating…' : 'Start'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Add / edit / replace modal */}
      {modal && (
        <div onClick={() => !modal.saving && setModal(null)} style={overlay}>
          <div onClick={e => e.stopPropagation()} style={{ ...cardStyle, background: T.bgPanel, width: 'min(560px, 100%)', maxHeight: '90vh', overflowY: 'auto', padding: '20px 22px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
              <i className={`ti ${modal.mode === 'replace' ? 'ti-refresh' : modal.mode === 'edit' ? 'ti-settings' : modal.editable ? 'ti-file-plus' : 'ti-upload'}`} style={{ color: T.blue }} />
              <span style={{ fontSize: '15px', fontWeight: 800, color: T.textPrimary }}>
                {modal.mode === 'add' ? (modal.editable ? 'New editable template' : 'Upload template file') : modal.mode === 'replace' ? 'Upload new version' : 'Template details'}
              </span>
            </div>
            {!modal.editable && (modal.mode === 'add' || modal.mode === 'replace') && (
              <div onClick={() => fileRef.current?.click()} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); pickFile(e.dataTransfer.files?.[0]) }}
                style={{ border: `2px dashed ${modal.file ? T.green : T.border}`, borderRadius: '10px', padding: '20px', textAlign: 'center', cursor: 'pointer', marginBottom: '14px', background: modal.file ? `${T.green}10` : 'transparent' }}>
                <input ref={fileRef} type="file" style={{ display: 'none' }} onChange={e => { pickFile(e.target.files?.[0]); e.target.value = '' }} />
                {modal.file ? (
                  <div style={{ fontSize: '13px', color: T.textPrimary }}>
                    <i className={`ti ${fileType(modal.file.name).icon}`} style={{ color: fileType(modal.file.name).color, marginRight: '6px' }} /><b>{modal.file.name}</b> <span style={{ color: T.textMuted }}>({fmtSize(modal.file.size)})</span>
                    <div style={{ fontSize: '11px', color: T.textMuted, marginTop: '4px' }}>Click to choose a different file</div>
                  </div>
                ) : (
                  <div style={{ fontSize: '13px', color: T.textSecondary }}>
                    <i className="ti ti-cloud-upload" style={{ fontSize: '26px', display: 'block', color: T.blue, marginBottom: '6px' }} />Drag a file here or <b style={{ color: T.blue }}>click to browse</b>
                    <div style={{ fontSize: '11px', color: T.textMuted, marginTop: '4px' }}>Excel, Word, PDF, CAD or any file, up to {MAX_MB} MB</div>
                  </div>
                )}
              </div>
            )}
            {modal.editable && <div style={{ fontSize: '12px', color: T.textMuted, marginBottom: '12px' }}>Creates a blank document you can write and format on the website. Your team can then fill it in for each site.</div>}
            {modal.mode === 'replace' && <div style={{ fontSize: '11px', color: T.textMuted, marginTop: '-6px', marginBottom: '12px' }}>Replaces <b>{modal.item?.file_name}</b> ({modal.item?.version || 'no revision'}).</div>}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <label style={{ gridColumn: '1 / -1' }}><div style={labelStyle}>Template name</div><input value={modal.form.name} onChange={e => setForm('name', e.target.value)} placeholder="e.g. PV Commissioning Test Sheet" style={inp} /></label>
              <label><div style={labelStyle}>Category</div>
                <select value={modal.form.category} onChange={e => setForm('category', e.target.value)} style={{ ...selectStyle, width: '100%' }}>{TEMPLATE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}</select>
              </label>
              <label><div style={labelStyle}>Revision / version</div><input value={modal.form.version} onChange={e => setForm('version', e.target.value)} placeholder="Rev 00" style={inp} /></label>
              <label style={{ gridColumn: '1 / -1' }}><div style={labelStyle}>Description (optional)</div>
                <textarea value={modal.form.description} onChange={e => setForm('description', e.target.value)} rows={3} placeholder="What it is used for, when to use it…" style={{ ...inp, resize: 'vertical', fontFamily: 'inherit' }} />
              </label>
            </div>
            {modal.error && <div style={{ marginTop: '12px', fontSize: '12px', color: T.red, fontWeight: 600 }}>{modal.error}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '18px' }}>
              <button onClick={() => setModal(null)} disabled={modal.saving} style={ghost}>Cancel</button>
              <button onClick={save} disabled={modal.saving} style={{ ...btn(T.blue), opacity: modal.saving ? 0.6 : 1 }}>
                <i className="ti ti-check" />{modal.saving ? 'Saving…' : modal.mode === 'add' ? (modal.editable ? 'Create & open' : 'Upload') : modal.mode === 'replace' ? 'Upload new version' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDel && (
        <div onClick={() => !delChecking && setConfirmDel(null)} style={overlay}>
          <div onClick={e => e.stopPropagation()} style={{ ...cardStyle, background: T.bgPanel, width: 'min(420px, 100%)', padding: '20px 22px' }}>
            <div style={{ fontSize: '15px', fontWeight: 800, color: T.textPrimary, marginBottom: '8px' }}>Delete {confirmDel.type === 'report' ? 'report' : 'template'}?</div>
            <div style={{ fontSize: '13px', color: T.textSecondary, lineHeight: 1.5 }}>
              <b>{confirmDel.item.title || confirmDel.item.name}</b> will be removed for everyone. This cannot be undone.
              {confirmDel.type === 'template' && confirmDel.item.content_html != null && ' Reports already filled in from it are kept.'}
            </div>
            <label style={{ display: 'block', marginTop: '14px' }}>
              <div style={labelStyle}>Your portal password</div>
              <input type="password" autoFocus autoComplete="current-password" value={delPw}
                onChange={e => { setDelPw(e.target.value); setDelErr('') }}
                onKeyDown={e => { if (e.key === 'Enter') confirmDelete() }}
                placeholder="Enter your password to confirm" style={inp} />
            </label>
            {delErr && <div style={{ marginTop: '8px', fontSize: '12px', color: T.red, fontWeight: 600 }}>{delErr}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '18px' }}>
              <button onClick={() => setConfirmDel(null)} style={ghost}>Cancel</button>
              <button onClick={confirmDelete} disabled={delChecking || busyId === confirmDel.item.id || !delPw} style={{ ...btn(T.red), opacity: delChecking || !delPw ? 0.6 : 1 }}>
                <i className="ti ti-lock" />{delChecking ? 'Checking…' : busyId === confirmDel.item.id ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const overlay = { position: 'fixed', inset: 0, background: 'rgba(10,20,40,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }

async function exportDoc(fmt, html, meta) {
  const ex = await exporters()
  if (fmt === 'pdf') return ex.printPdf(html || '', meta)
  const { generateJSON } = await import('@tiptap/core')
  const { EDITOR_EXTENSIONS } = await import('./DocEditor')
  const json = generateJSON(html || '<p></p>', EDITOR_EXTENSIONS)
  if (fmt === 'docx') return ex.exportDocx(json, meta)
  return ex.exportXlsx(json, meta)
}

// ── Document editor screen (report or master template) ─────────────────────
function DocumentView({ doc, T, cardStyle, selectStyle, userName, siteNames, uploadImage, onClose, btn, ghost, labelStyle, inp }) {
  const [meta, setMeta] = useState({ title: doc.title, site: doc.site || '', date: doc.date || '', status: doc.status || 'Draft', version: doc.version || '' })
  const [state, setState] = useState({ saving: false, dirty: false, savedAt: doc.updatedAt, error: '' })
  const [busy, setBusy] = useState('')
  const editorRef = useRef(null)
  const htmlRef = useRef(doc.html || '')
  const timer = useRef(null)
  const baseline = useRef(undefined)
  const isReport = doc.kind === 'report'

  const subtitle = isReport ? [meta.site, fmtDate(meta.date), meta.status].filter(Boolean).join(' · ') : [meta.version, 'Template'].filter(Boolean).join(' · ')

  async function saveNow() {
    clearTimeout(timer.current)
    setState(s => ({ ...s, saving: true, error: '' }))
    const html = editorRef.current ? editorRef.current.getHTML() : htmlRef.current
    const payload = isReport
      ? { content_html: html, title: meta.title.trim() || 'Untitled report', site_name: meta.site.trim() || null, report_date: meta.date || null, status: meta.status, updated_by: userName || null }
      : { content_html: html, name: meta.title.trim() || 'Untitled template', version: meta.version.trim() || null, updated_by: userName || null }
    const { error } = await supabase.from(isReport ? REPORTS : TABLE).update(payload).eq('id', doc.id)
    if (error) setState(s => ({ ...s, saving: false, error: `Not saved: ${error.message}` }))
    else setState({ saving: false, dirty: false, savedAt: new Date().toISOString(), error: '' })
  }
  const scheduleSave = () => {
    setState(s => ({ ...s, dirty: true }))
    clearTimeout(timer.current)
    timer.current = setTimeout(saveNow, 2500)
  }
  useEffect(() => () => clearTimeout(timer.current), [])
  useEffect(() => {
    const warn = e => { if (state.dirty) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [state.dirty])
  const setM = (k, v) => { setMeta(m => ({ ...m, [k]: v })); scheduleSave() }

  async function close() {
    if (state.dirty) await saveNow()
    onClose()
  }
  async function download(fmt) {
    setBusy(fmt)
    try {
      const html = editorRef.current ? editorRef.current.getHTML() : htmlRef.current
      await exportDoc(fmt, html, { title: meta.title, subtitle, fileName: meta.title })
    } catch (e) { setState(s => ({ ...s, error: `Download failed: ${e.message || e}` })) } finally { setBusy('') }
  }

  return (
    <div>
      <div style={{ ...cardStyle, padding: '12px 16px', marginBottom: '12px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px' }}>
          <button onClick={close} style={ghost}><i className="ti ti-arrow-left" />Back</button>
          <span style={{ fontSize: '11px', fontWeight: 700, color: isReport ? T.blue : T.orange, border: `1px solid ${isReport ? T.blue : T.orange}55`, borderRadius: '999px', padding: '3px 10px' }}>
            {isReport ? `Report · ${doc.templateName || ''}` : 'Editing master template'}
          </span>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: '11px', color: state.error ? T.red : T.textMuted }}>
            {state.error || (state.saving ? 'Saving…' : state.dirty ? 'Unsaved changes' : state.savedAt ? `Saved ${fmtTime(state.savedAt)}` : '')}
          </span>
          <button onClick={saveNow} disabled={state.saving} style={btn(T.blue)}><i className="ti ti-device-floppy" />Save</button>
          <button onClick={() => download('docx')} disabled={!!busy} style={ghost}><i className="ti ti-file-type-docx" style={{ color: '#0B74D7' }} />{busy === 'docx' ? 'Preparing…' : 'Word'}</button>
          <button onClick={() => download('pdf')} disabled={!!busy} style={ghost}><i className="ti ti-file-type-pdf" style={{ color: '#D93A3A' }} />PDF</button>
          <button onClick={() => download('xlsx')} disabled={!!busy} style={ghost}><i className="ti ti-file-spreadsheet" style={{ color: '#3F8F2A' }} />{busy === 'xlsx' ? 'Preparing…' : 'Excel'}</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: isReport ? '2fr 1.3fr 0.9fr 0.9fr' : '3fr 1fr', gap: '10px', marginTop: '12px' }}>
          <label><div style={labelStyle}>{isReport ? 'Report title' : 'Template name'}</div><input value={meta.title} onChange={e => setM('title', e.target.value)} style={inp} /></label>
          {isReport ? (
            <>
              <label><div style={labelStyle}>Site</div>
                <input list="doc-site-list" value={meta.site} onChange={e => setM('site', e.target.value)} style={inp} />
                <datalist id="doc-site-list">{siteNames.map(s => <option key={s} value={s} />)}</datalist>
              </label>
              <label><div style={labelStyle}>Date</div><input type="date" value={meta.date || ''} onChange={e => setM('date', e.target.value)} style={inp} /></label>
              <label><div style={labelStyle}>Status</div>
                <select value={meta.status} onChange={e => setM('status', e.target.value)} style={{ ...selectStyle, width: '100%' }}>{STATUSES.map(s => <option key={s} value={s}>{s}</option>)}</select>
              </label>
            </>
          ) : (
            <label><div style={labelStyle}>Revision</div><input value={meta.version} onChange={e => setM('version', e.target.value)} style={inp} /></label>
          )}
        </div>
        {!isReport && <div style={{ fontSize: '11px', color: T.orange, marginTop: '8px' }}><i className="ti ti-info-circle" /> Changes here apply to new reports. Reports already filled in are not changed.</div>}
      </div>
      <DocEditor T={T} content={doc.html}
        onReady={ed => { editorRef.current = ed; if (baseline.current === undefined) baseline.current = ed.getHTML() }}
        onChange={ed => {
          const h = ed.getHTML()
          htmlRef.current = h
          if (baseline.current === undefined) { baseline.current = h; return } // first render
          if (h === baseline.current) return // opening a document is not an edit
          baseline.current = null
          scheduleSave()
        }}
        onImageUpload={uploadImage} />
    </div>
  )
}
