'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'

// ─────────────────────────────────────────────────────────────────────────────
// Document Library (Engineering Tools)
//  • One place for datasheets, certificates, manuals, warranties & compliance docs
//  • Organised by document type (chips) and equipment category (groups)
//  • Files are uploaded to the private Storage bucket "engineering-documents"
//    and opened with short-lived signed links. Older files shipped with the app
//    (/datasheets, /certifications) are listed via file_url.
// SQL: supabase/engineering_documents.sql (run once)
// ─────────────────────────────────────────────────────────────────────────────

const BUCKET = 'engineering-documents'
const TABLE = 'engineering_documents'
const MAX_MB = 50

export const DOC_TYPES = ['Datasheet', 'Certificate', 'Manual', 'Warranty', 'Compliance', 'Other']
const TYPE_META = {
  Datasheet:   { icon: 'ti-file-description', color: '#0B74D7' },
  Certificate: { icon: 'ti-certificate',      color: '#3F8F2A' },
  Manual:      { icon: 'ti-book',             color: '#5b3fa8' },
  Warranty:    { icon: 'ti-shield-check',     color: '#F66524' },
  Compliance:  { icon: 'ti-gavel',            color: '#a83a3a' },
  Other:       { icon: 'ti-file',             color: '#505050' },
}
const TYPE_LABELS = { Datasheet: 'Datasheets', Certificate: 'Certificates', Manual: 'Manuals', Warranty: 'Warranties', Compliance: 'Compliance', Other: 'Other' }
export const DOC_CATEGORIES = ['Inverters', 'PV Modules', 'Batteries', 'Meters', 'Electrical BOS', 'Structural BOS', 'Civil BOS', 'Containers', 'Other Accessories', 'Company']
const CATEGORY_ICONS = {
  Inverters: 'ti-bolt', 'PV Modules': 'ti-solar-panel', Batteries: 'ti-battery-charging', Meters: 'ti-gauge',
  'Electrical BOS': 'ti-plug', 'Structural BOS': 'ti-building-bridge', 'Civil BOS': 'ti-shovel', Containers: 'ti-container',
  'Other Accessories': 'ti-box', Company: 'ti-building',
}
const EXPIRY_SOON_DAYS = 60

const FILE_TYPES = [
  [/\.pdf$/i, 'ti-file-type-pdf', '#D93A3A', 'PDF'],
  [/\.(xlsx|xlsm|xls|csv)$/i, 'ti-file-spreadsheet', '#3F8F2A', 'Excel'],
  [/\.(docx|doc)$/i, 'ti-file-text', '#0B74D7', 'Word'],
  [/\.(png|jpe?g|svg|webp)$/i, 'ti-photo', '#579FE4', 'Image'],
  [/\.(dwg|dxf)$/i, 'ti-ruler-2', '#505050', 'CAD'],
  [/\.zip$/i, 'ti-file-zip', '#505050', 'ZIP'],
]
const fileType = name => {
  const hit = FILE_TYPES.find(([re]) => re.test(name || ''))
  return hit ? { icon: hit[1], color: hit[2], label: hit[3] } : { icon: 'ti-file', color: '#505050', label: (name || '').split('.').pop()?.toUpperCase() || 'File' }
}
const fmtSize = b => (b == null ? '' : b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`)
const fmtDate = d => (d ? new Date(d).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }) : '')
const safeName = n => n.replace(/[^a-zA-Z0-9.\-_]/g, '_')
const titleFromFile = n => n.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
const daysUntil = d => (d ? Math.ceil((new Date(d + 'T23:59:59') - new Date()) / 86400000) : null)
const expiryState = d => {
  const n = daysUntil(d)
  if (n == null) return null
  if (n < 0) return 'expired'
  if (n <= EXPIRY_SOON_DAYS) return 'soon'
  return 'valid'
}

// Project mode (opened from a project): project, linkedIds (ids already in the project) and onAddToProject(doc)
export default function DocumentLibrary({ T, cardStyle, selectStyle, userName, project, linkedIds = [], onAddToProject }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [type, setType] = useState('All')
  const [category, setCategory] = useState('')
  const [brand, setBrand] = useState('')
  const [expiry, setExpiry] = useState('')
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState(null)
  const [confirmDel, setConfirmDel] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [toast, setToast] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef(null)

  async function load() {
    setLoading(true)
    setLoadError('')
    const { data, error } = await supabase.from(TABLE).select('*').order('category').order('title')
    if (error) {
      setLoadError(/relation|does not exist|schema cache/i.test(error.message)
        ? 'The Document Library is not set up yet. Run supabase/engineering_documents.sql once in the Supabase SQL Editor.'
        : `Could not load documents: ${error.message}`)
      setItems([])
    } else setItems(data || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 3500); return () => clearTimeout(t) }, [toast])

  const brands = useMemo(() => [...new Set(items.map(x => (x.brand || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [items])
  const typeCounts = useMemo(() => items.reduce((a, x) => { a[x.doc_type] = (a[x.doc_type] || 0) + 1; return a }, {}), [items])
  const expiryCounts = useMemo(() => items.reduce((a, x) => { const s = expiryState(x.expiry_date); if (s) a[s] = (a[s] || 0) + 1; return a }, {}), [items])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter(x => (type === 'All' || x.doc_type === type)
      && (!category || x.category === category)
      && (!brand || (x.brand || '').trim() === brand)
      && (!expiry || (expiry === 'attention' ? ['expired', 'soon'].includes(expiryState(x.expiry_date)) : expiryState(x.expiry_date) === expiry))
      && (!q || `${x.title} ${x.brand || ''} ${x.description || ''} ${x.file_name || ''} ${x.doc_type} ${x.category}`.toLowerCase().includes(q)))
  }, [items, type, category, brand, expiry, search])

  const groups = useMemo(() => {
    const order = [...DOC_CATEGORIES, ...new Set(items.map(i => i.category).filter(c => !DOC_CATEGORIES.includes(c)))]
    return order.map(c => ({ cat: c, list: filtered.filter(x => x.category === c) })).filter(g => g.list.length)
  }, [filtered, items])

  const anyFilter = type !== 'All' || category || brand || expiry || search

  // ── add / edit ──
  function openAdd(files = []) {
    const base = { doc_type: type !== 'All' ? type : 'Datasheet', category: category || 'Inverters', brand: brand || '', title: '', description: '', expiry_date: '' }
    setModal({ mode: 'add', form: base, files: [], saving: false, progress: '', error: '' })
    if (files.length) pickFiles(files)
  }
  function openEdit(x) {
    setModal({ mode: 'edit', id: x.id, item: x, form: { doc_type: x.doc_type, category: x.category, brand: x.brand || '', title: x.title, description: x.description || '', expiry_date: x.expiry_date || '' }, files: [], saving: false, progress: '', error: '' })
  }
  function openReplace(x) {
    setModal({ mode: 'replace', id: x.id, item: x, form: { doc_type: x.doc_type, category: x.category, brand: x.brand || '', title: x.title, description: x.description || '', expiry_date: x.expiry_date || '' }, files: [], saving: false, progress: '', error: '' })
  }
  const setForm = (k, v) => setModal(m => ({ ...m, form: { ...m.form, [k]: v } }))
  function pickFiles(list) {
    const arr = Array.from(list || [])
    if (!arr.length) return
    const tooBig = arr.filter(f => f.size > MAX_MB * 1024 * 1024)
    const ok = arr.filter(f => f.size <= MAX_MB * 1024 * 1024)
    setModal(m => {
      const single = m.mode !== 'add'
      const files = single ? ok.slice(0, 1) : [...m.files, ...ok]
      return {
        ...m, files,
        error: tooBig.length ? `${tooBig.map(f => f.name).join(', ')} ${tooBig.length > 1 ? 'are' : 'is'} over the ${MAX_MB} MB limit and was skipped.` : '',
        form: { ...m.form, title: m.form.title || (files.length === 1 ? titleFromFile(files[0].name) : '') },
      }
    })
  }
  const removePicked = i => setModal(m => ({ ...m, files: m.files.filter((_, j) => j !== i) }))

  async function uploadOne(file, f) {
    const path = `${safeName(f.category)}/${safeName(f.doc_type)}/${Date.now()}-${safeName(file.name)}`
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false, contentType: file.type || undefined })
    if (error) throw new Error(`Upload of ${file.name} failed: ${error.message}`)
    return { file_path: path, file_url: null, file_name: file.name, file_size: file.size, file_type: file.type || null }
  }

  async function save() {
    const m = modal
    const f = m.form
    const multi = m.mode === 'add' && m.files.length > 1
    if (!multi && !f.title.trim()) { setModal(x => ({ ...x, error: 'Please give the document a title.' })); return }
    if ((m.mode === 'add' || m.mode === 'replace') && !m.files.length) { setModal(x => ({ ...x, error: 'Please choose a file to upload.' })); return }
    setModal(x => ({ ...x, saving: true, error: '' }))
    const meta = {
      doc_type: f.doc_type, category: f.category, brand: f.brand.trim() || null,
      description: f.description.trim() || null, expiry_date: f.expiry_date || null, updated_by: userName || null,
    }
    try {
      if (m.mode === 'add') {
        let done = 0
        for (const file of m.files) {
          setModal(x => ({ ...x, progress: m.files.length > 1 ? `Uploading ${done + 1} of ${m.files.length}…` : 'Uploading…' }))
          const fileFields = await uploadOne(file, f)
          const title = multi ? titleFromFile(file.name) : f.title.trim()
          const { error } = await supabase.from(TABLE).insert([{ ...meta, ...fileFields, title, created_by: userName || null }])
          if (error) { await supabase.storage.from(BUCKET).remove([fileFields.file_path]); throw error }
          done++
        }
        setToast(done > 1 ? `${done} documents added` : 'Document added')
      } else {
        let fileFields = {}
        if (m.mode === 'replace') { setModal(x => ({ ...x, progress: 'Uploading…' })); fileFields = await uploadOne(m.files[0], f) }
        const { error } = await supabase.from(TABLE).update({ ...meta, title: f.title.trim(), ...fileFields }).eq('id', m.id)
        if (error) { if (fileFields.file_path) await supabase.storage.from(BUCKET).remove([fileFields.file_path]); throw error }
        if (fileFields.file_path && m.item?.file_path) await supabase.storage.from(BUCKET).remove([m.item.file_path])
        setToast(m.mode === 'replace' ? 'File replaced' : 'Details saved')
      }
      setModal(null)
      load()
    } catch (e) {
      setModal(x => ({ ...x, saving: false, progress: '', error: e.message || String(e) }))
      load()
    }
  }

  // ── open / download ──
  async function linkFor(x, download) {
    if (x.file_path) {
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(x.file_path, 300, download ? { download: x.file_name || true } : undefined)
      if (error) throw error
      return data.signedUrl
    }
    return x.file_url
  }
  async function viewDoc(x) {
    const win = window.open('', '_blank') // open first so pop-up blockers allow it
    setBusyId(x.id)
    try {
      const url = await linkFor(x, false)
      if (!url) throw new Error('This document has no file attached.')
      if (win) win.location.href = url; else window.location.href = url
    } catch (e) { if (win) win.close(); setToast(`Could not open: ${e.message || e}`) } finally { setBusyId(null) }
  }
  async function downloadDoc(x) {
    setBusyId(x.id)
    try {
      const url = await linkFor(x, true)
      if (!url) throw new Error('This document has no file attached.')
      const a = document.createElement('a')
      a.href = url; a.rel = 'noopener'
      if (!x.file_path) a.download = x.file_name || ''
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
    } catch (e) { setToast(`Download failed: ${e.message || e}`) } finally { setBusyId(null) }
  }

  // ── delete (re-confirmed with the user's own portal password, like Engineering Templates) ──
  const [delPw, setDelPw] = useState('')
  const [delErr, setDelErr] = useState('')
  const [delChecking, setDelChecking] = useState(false)
  const openDelete = x => { setDelPw(''); setDelErr(''); setConfirmDel(x) }
  async function confirmDelete() {
    if (!delPw) { setDelErr('Enter your password to delete.'); return }
    setDelChecking(true); setDelErr('')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user?.email) throw new Error('You are not signed in. Please sign in again.')
      const { error } = await supabase.auth.signInWithPassword({ email: user.email, password: delPw })
      if (error) { setDelErr('Incorrect password. Nothing was deleted.'); return }
      setDelPw('')
      const x = confirmDel
      setBusyId(x.id)
      const { error: dErr } = await supabase.from(TABLE).delete().eq('id', x.id)
      if (!dErr && x.file_path) await supabase.storage.from(BUCKET).remove([x.file_path])
      setBusyId(null); setConfirmDel(null)
      if (dErr) setToast(`Delete failed: ${dErr.message}`)
      else { setToast('Document deleted'); load() }
    } catch (e) {
      setDelErr(e.message || String(e))
    } finally { setDelChecking(false) }
  }

  // ── styles ──
  const btn = (bg, fg = '#fff', border = 'none') => ({ padding: '8px 14px', background: bg, color: fg, border, borderRadius: '7px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px' })
  const ghost = btn('transparent', T.textSecondary, `1px solid ${T.border}`)
  const iconBtn = color => ({ background: 'transparent', border: `1px solid ${T.border}`, color, borderRadius: '6px', padding: '5px 8px', cursor: 'pointer', fontSize: '13px', display: 'inline-flex', alignItems: 'center', gap: '4px' })
  const labelStyle = { fontSize: '10px', fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '4px' }
  const inp = { ...selectStyle, cursor: 'text', width: '100%', boxSizing: 'border-box' }
  const chip = (active, color = T.blue) => ({
    padding: '7px 13px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', borderRadius: '999px',
    border: `1px solid ${active ? color : T.border}`, background: active ? color : T.bgPanel, color: active ? '#fff' : T.textSecondary,
    display: 'inline-flex', alignItems: 'center', gap: '6px',
  })
  const badge = color => ({ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 700, color, border: `1px solid ${color}55`, background: 'transparent', whiteSpace: 'nowrap' })

  function expiryBadge(x) {
    const s = expiryState(x.expiry_date)
    if (!s) return null
    const n = daysUntil(x.expiry_date)
    if (s === 'expired') return <span style={badge(T.red)} title={`Expired ${fmtDate(x.expiry_date)}`}><i className="ti ti-alert-triangle" />Expired</span>
    if (s === 'soon') return <span style={badge(T.orange)} title={`Expires ${fmtDate(x.expiry_date)}`}><i className="ti ti-clock" />{n === 0 ? 'Expires today' : `Expires in ${n}d`}</span>
    return <span style={badge(T.textMuted)}>Valid to {fmtDate(x.expiry_date)}</span>
  }

  return (
    <div
      onDragOver={e => { if (!modal && !loadError) { e.preventDefault(); setDragOver(true) } }}
      onDragLeave={e => { if (e.currentTarget === e.target) setDragOver(false) }}
      onDrop={e => { if (modal || loadError) return; e.preventDefault(); setDragOver(false); openAdd(e.dataTransfer.files) }}
      style={{ position: 'relative' }}>

      {project && (
        <div style={{ ...cardStyle, padding: '10px 14px', marginBottom: '12px', borderLeft: `3px solid ${T.blue}`, fontSize: '12px', color: T.textSecondary }}>
          <i className="ti ti-briefcase" style={{ color: T.blue }} /> Adding documents to <b>{project.name}</b>. Click <b>Add to project</b> on any datasheet, certificate, manual or warranty; it is included when you compile the project archive.
        </div>
      )}

      {/* Type chips */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
        <button onClick={() => setType('All')} style={chip(type === 'All')}><i className="ti ti-books" />All <span style={{ opacity: 0.8 }}>{items.length}</span></button>
        {DOC_TYPES.map(t => (
          <button key={t} onClick={() => setType(t)} style={chip(type === t, TYPE_META[t].color)}>
            <i className={`ti ${TYPE_META[t].icon}`} />{TYPE_LABELS[t]} <span style={{ opacity: 0.8 }}>{typeCounts[t] || 0}</span>
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <div style={{ ...cardStyle, padding: '12px 16px', marginBottom: '16px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px' }}>
        <div style={{ position: 'relative', flex: '1 1 220px', maxWidth: '320px' }}>
          <i className="ti ti-search" style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: T.textMuted, fontSize: '14px' }} />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search title, brand, file name…" style={{ ...inp, paddingLeft: '30px' }} />
        </div>
        <select value={category} onChange={e => setCategory(e.target.value)} style={selectStyle}>
          <option value="">All categories</option>
          {DOC_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={brand} onChange={e => setBrand(e.target.value)} style={selectStyle}>
          <option value="">All brands</option>
          {brands.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
        <select value={expiry} onChange={e => setExpiry(e.target.value)} style={selectStyle}>
          <option value="">Any expiry</option>
          <option value="attention">Needs attention ({(expiryCounts.expired || 0) + (expiryCounts.soon || 0)})</option>
          <option value="expired">Expired ({expiryCounts.expired || 0})</option>
          <option value="soon">Expiring in {EXPIRY_SOON_DAYS} days ({expiryCounts.soon || 0})</option>
          <option value="valid">Valid ({expiryCounts.valid || 0})</option>
        </select>
        {anyFilter && (
          <button onClick={() => { setType('All'); setCategory(''); setBrand(''); setExpiry(''); setSearch('') }}
            style={{ ...selectStyle, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: T.red, cursor: 'pointer' }}>
            Clear ×
          </button>
        )}
        <span style={{ fontSize: '11px', color: T.textMuted, marginLeft: 'auto' }}>{filtered.length} of {items.length} documents</span>
        <button onClick={() => openAdd()} disabled={!!loadError} style={{ ...btn(T.blue), opacity: loadError ? 0.5 : 1 }}><i className="ti ti-upload" />Add documents</button>
      </div>

      {(expiryCounts.expired || expiryCounts.soon) && expiry === '' ? (
        <div onClick={() => setExpiry('attention')} style={{ ...cardStyle, padding: '10px 14px', marginBottom: '14px', borderLeft: `3px solid ${T.orange}`, fontSize: '12px', color: T.textSecondary, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <i className="ti ti-alert-triangle" style={{ color: T.orange, fontSize: '15px' }} />
          {expiryCounts.expired ? <b style={{ color: T.red }}>{expiryCounts.expired} expired</b> : null}
          {expiryCounts.expired && expiryCounts.soon ? ' · ' : null}
          {expiryCounts.soon ? <b style={{ color: T.orange }}>{expiryCounts.soon} expiring within {EXPIRY_SOON_DAYS} days</b> : null}
          <span style={{ marginLeft: 'auto', color: T.blue, fontWeight: 700 }}>Show them →</span>
        </div>
      ) : null}

      {/* Body */}
      {loading ? (
        <div style={{ ...cardStyle, padding: '50px', textAlign: 'center', color: T.textSecondary, fontSize: '13px' }}>Loading documents…</div>
      ) : loadError ? (
        <div style={{ ...cardStyle, padding: '28px', textAlign: 'center', color: T.textSecondary, fontSize: '13px', borderLeft: `3px solid ${T.orange}` }}>
          <i className="ti ti-database-off" style={{ fontSize: '28px', color: T.orange, display: 'block', marginBottom: '8px' }} />{loadError}
        </div>
      ) : groups.length === 0 ? (
        <div style={{ ...cardStyle, padding: '50px', textAlign: 'center', color: T.textMuted, fontSize: '13px' }}>
          <i className="ti ti-files-off" style={{ fontSize: '30px', display: 'block', marginBottom: '8px' }} />
          {items.length === 0 ? 'No documents yet. Click "Add documents" or drag files onto this page.' : 'No documents match your filters.'}
        </div>
      ) : groups.map(g => (
        <div key={g.cat} style={{ ...cardStyle, marginBottom: '14px', overflow: 'hidden' }}>
          <div style={{ padding: '10px 16px', background: T.bgMuted, borderBottom: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <i className={`ti ${CATEGORY_ICONS[g.cat] || 'ti-folder'}`} style={{ color: T.blue, fontSize: '16px' }} />
            <span style={{ fontSize: '13px', fontWeight: 800, color: T.textPrimary }}>{g.cat}</span>
            <span style={{ fontSize: '11px', color: T.textMuted }}>{g.list.length}</span>
          </div>
          {g.list.map(x => {
            const ft = fileType(x.file_name || x.file_url)
            const tm = TYPE_META[x.doc_type] || TYPE_META.Other
            return (
              <div key={x.id} className="tbl-row" style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 16px', borderBottom: `1px solid ${T.border}`, flexWrap: 'wrap' }}>
                <i className={`ti ${ft.icon}`} style={{ fontSize: '22px', color: ft.color, flexShrink: 0 }} title={ft.label} />
                <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                  <div onClick={() => viewDoc(x)} style={{ fontSize: '13px', fontWeight: 700, color: T.textPrimary, cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis' }} title="Open">{x.title}</div>
                  <div style={{ fontSize: '11px', color: T.textMuted, marginTop: '2px' }}>
                    {[x.brand, x.file_name, fmtSize(x.file_size), x.updated_at ? `Updated ${fmtDate(x.updated_at)}` : ''].filter(Boolean).join(' · ')}
                  </div>
                  {x.description ? <div style={{ fontSize: '11px', color: T.textSecondary, marginTop: '3px' }}>{x.description}</div> : null}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                  <span style={badge(tm.color)}><i className={`ti ${tm.icon}`} />{x.doc_type}</span>
                  {expiryBadge(x)}
                </div>
                <div style={{ display: 'flex', gap: '5px', marginLeft: 'auto' }}>
                  {onAddToProject && (linkedIds.includes(x.id)
                    ? <span style={{ ...badge(T.green), padding: '5px 9px' }}><i className="ti ti-check" />In project</span>
                    : <button onClick={() => onAddToProject(x)} style={{ ...iconBtn(T.blue), fontWeight: 700, fontSize: '11px' }} title="Add to project"><i className="ti ti-briefcase" />Add to project</button>)}
                  <button onClick={() => viewDoc(x)} disabled={busyId === x.id} style={iconBtn(T.blue)} title="Open"><i className="ti ti-eye" /></button>
                  <button onClick={() => downloadDoc(x)} disabled={busyId === x.id} style={iconBtn(T.green)} title="Download"><i className="ti ti-download" /></button>
                  <button onClick={() => openEdit(x)} style={iconBtn(T.textSecondary)} title="Edit details"><i className="ti ti-pencil" /></button>
                  <button onClick={() => openReplace(x)} style={iconBtn(T.orange)} title="Replace file (new version)"><i className="ti ti-replace" /></button>
                  <button onClick={() => openDelete(x)} style={iconBtn(T.red)} title="Delete"><i className="ti ti-trash" /></button>
                </div>
              </div>
            )
          })}
        </div>
      ))}

      {dragOver && (
        <div style={{ position: 'absolute', inset: 0, background: `${T.blue}14`, border: `2px dashed ${T.blue}`, borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', fontSize: '15px', fontWeight: 800, color: T.blue }}>
          <i className="ti ti-upload" style={{ marginRight: '8px' }} />Drop files to add them to the library
        </div>
      )}

      {/* Add / edit / replace modal */}
      {modal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(10,20,35,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}
          onClick={e => { if (e.target === e.currentTarget && !modal.saving) setModal(null) }}>
          <div style={{ ...cardStyle, width: '100%', maxWidth: '560px', maxHeight: '90vh', overflowY: 'auto', padding: '22px' }}>
            <div style={{ fontSize: '16px', fontWeight: 800, color: T.textPrimary, marginBottom: '16px' }}>
              {modal.mode === 'add' ? 'Add documents' : modal.mode === 'replace' ? 'Replace file' : 'Edit details'}
            </div>

            {modal.mode !== 'edit' && (
              <div
                onClick={() => fileRef.current?.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); pickFiles(e.dataTransfer.files) }}
                style={{ border: `2px dashed ${T.border}`, borderRadius: '8px', padding: '18px', textAlign: 'center', cursor: 'pointer', marginBottom: '14px', color: T.textSecondary, fontSize: '12px' }}>
                <i className="ti ti-cloud-upload" style={{ fontSize: '26px', color: T.blue, display: 'block', marginBottom: '6px' }} />
                {modal.mode === 'add' ? 'Click to choose files, or drop them here. You can add several at once.' : 'Click to choose the new file, or drop it here'}
                <div style={{ fontSize: '10px', color: T.textMuted, marginTop: '4px' }}>PDF, Word, Excel, images, CAD or ZIP · up to {MAX_MB} MB each</div>
                <input ref={fileRef} type="file" multiple={modal.mode === 'add'} style={{ display: 'none' }}
                  onChange={e => { pickFiles(e.target.files); e.target.value = '' }} />
              </div>
            )}
            {modal.files.length > 0 && (
              <div style={{ marginBottom: '14px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {modal.files.map((f, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: T.textPrimary, padding: '6px 8px', background: T.bgMuted, borderRadius: '6px' }}>
                    <i className={`ti ${fileType(f.name).icon}`} style={{ color: fileType(f.name).color }} />
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                    <span style={{ color: T.textMuted }}>{fmtSize(f.size)}</span>
                    {!modal.saving && <i className="ti ti-x" onClick={() => removePicked(i)} style={{ cursor: 'pointer', color: T.textMuted }} />}
                  </div>
                ))}
                {modal.mode === 'replace' && <div style={{ fontSize: '11px', color: T.textMuted }}>The old file will be removed once the new one is saved.</div>}
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              {!(modal.mode === 'add' && modal.files.length > 1) ? (
                <div style={{ gridColumn: '1 / -1' }}>
                  <div style={labelStyle}>Title</div>
                  <input value={modal.form.title} onChange={e => setForm('title', e.target.value)} placeholder="e.g. Sungrow SG125CX-P2 User Manual" style={inp} />
                </div>
              ) : (
                <div style={{ gridColumn: '1 / -1', fontSize: '11px', color: T.textSecondary }}>
                  <i className="ti ti-info-circle" style={{ color: T.blue }} /> Each file gets its own entry, titled from its file name (you can rename them afterwards). The details below apply to all of them.
                </div>
              )}
              <div>
                <div style={labelStyle}>Document type</div>
                <select value={modal.form.doc_type} onChange={e => setForm('doc_type', e.target.value)} style={{ ...selectStyle, width: '100%' }}>
                  {DOC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <div style={labelStyle}>Equipment category</div>
                <select value={modal.form.category} onChange={e => setForm('category', e.target.value)} style={{ ...selectStyle, width: '100%' }}>
                  {DOC_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <div style={labelStyle}>Brand (optional)</div>
                <input list="doclib-brands" value={modal.form.brand} onChange={e => setForm('brand', e.target.value)} placeholder="e.g. Sungrow" style={inp} />
                <datalist id="doclib-brands">{brands.map(b => <option key={b} value={b} />)}</datalist>
              </div>
              <div>
                <div style={labelStyle}>Expiry / warranty end (optional)</div>
                <input type="date" value={modal.form.expiry_date} onChange={e => setForm('expiry_date', e.target.value)} style={inp} />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <div style={labelStyle}>Notes (optional)</div>
                <textarea value={modal.form.description} onChange={e => setForm('description', e.target.value)} rows={2} placeholder="e.g. Applies to serials from 2024 onward" style={{ ...inp, resize: 'vertical', fontFamily: 'inherit' }} />
              </div>
            </div>

            {modal.error && <div style={{ marginTop: '12px', fontSize: '12px', color: T.red }}>{modal.error}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '8px', marginTop: '18px' }}>
              {modal.progress && <span style={{ fontSize: '12px', color: T.textMuted, marginRight: 'auto' }}>{modal.progress}</span>}
              <button onClick={() => setModal(null)} disabled={modal.saving} style={ghost}>Cancel</button>
              <button onClick={save} disabled={modal.saving} style={{ ...btn(T.blue), opacity: modal.saving ? 0.6 : 1 }}>
                <i className={`ti ${modal.saving ? 'ti-loader-2' : 'ti-check'}`} />
                {modal.saving ? 'Saving…' : modal.mode === 'add' ? (modal.files.length > 1 ? `Add ${modal.files.length} documents` : 'Add document') : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDel && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(10,20,35,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}
          onClick={e => { if (e.target === e.currentTarget && !delChecking) setConfirmDel(null) }}>
          <div style={{ ...cardStyle, width: '100%', maxWidth: '420px', padding: '22px' }}>
            <div style={{ fontSize: '16px', fontWeight: 800, color: T.textPrimary, marginBottom: '8px' }}>Delete document?</div>
            <div style={{ fontSize: '12px', color: T.textSecondary, marginBottom: '14px' }}>
              <b>{confirmDel.title}</b> will be removed from the library{confirmDel.file_path ? ' and its file deleted' : ''}. This can't be undone. Enter your portal password to confirm.
            </div>
            <input type="password" value={delPw} autoFocus onChange={e => setDelPw(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') confirmDelete() }} placeholder="Your password" style={inp} />
            {delErr && <div style={{ marginTop: '8px', fontSize: '12px', color: T.red }}>{delErr}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
              <button onClick={() => setConfirmDel(null)} disabled={delChecking} style={ghost}>Cancel</button>
              <button onClick={confirmDelete} disabled={delChecking} style={{ ...btn(T.red), opacity: delChecking ? 0.6 : 1 }}><i className="ti ti-trash" />{delChecking ? 'Checking…' : 'Delete'}</button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: '24px', right: '24px', background: T.isDark ? '#1f2d42' : '#1a2a4a', color: '#fff', padding: '10px 16px', borderRadius: '8px', fontSize: '12px', fontWeight: 600, zIndex: 1100, boxShadow: '0 6px 20px rgba(0,0,0,0.25)' }}>{toast}</div>
      )}
    </div>
  )
}
