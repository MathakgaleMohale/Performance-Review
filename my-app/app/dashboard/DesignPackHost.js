'use client'

import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useDesignPackSources } from './designPackSources'
import { checkPassword } from './projectConfig'

// ─────────────────────────────────────────────────────────────────────────────
// Design Pack Generator with saving on the website
//  • The generator itself is public/design-pack-generator.html in an iframe
//  • This bar saves the pack as an editable draft (table design_packs, files in
//    the private bucket design-packs), opens saved packs, and keeps every
//    compiled PDF as an issued revision (table design_pack_issues)
//  • Used under Engineering Tools (no project) and inside a project
// SQL: supabase/design_packs.sql (run once)
// ─────────────────────────────────────────────────────────────────────────────

const BUCKET = 'design-packs'
const GEN_SRC = '/design-pack-generator.html'
const FOLDER = { drawing: 'drawings', photo: 'photos', library: 'library' }
const isSetupError = e => /relation|does not exist|schema cache|bucket not found/i.test(e?.message || '')
const setupText = 'Saving design packs needs one setup step: run supabase/design_packs.sql once in the Supabase SQL Editor.'
const safeName = n => String(n || 'file').replace(/[^a-zA-Z0-9.\-_]/g, '_').slice(0, 120)
const fmtWhen = d => (d ? new Date(d).toLocaleString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '')
const fmtTime = d => (d ? new Date(d).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }) : '')
const fmtSize = b => (b == null ? '' : b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`)
const titleFrom = st => {
  const p = st?.project || {}
  return [p.docNo, p.name].filter(Boolean).join(' – ') || 'Untitled design pack'
}

export default function DesignPackHost({ project = null, prefill = null, initialPackId = null, startNew = false, T, cardStyle, selectStyle, userName, onCompiled, height = 'calc(100vh - 220px)' }) {
  const frame = useRef(null)
  const [frameKey, setFrameKey] = useState(0)          // bump to start a fresh generator
  const pendingLoad = useRef(null)                     // { state, files } to send once the new frame is ready
  const waiters = useRef({})                           // reqId → resolve for getState replies
  const packRef = useRef(null)
  const lastErr = useRef('')
  const [pack, setPack] = useState(null)               // the open design_packs row (null = not saved yet)
  const [title, setTitle] = useState('')
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState('')                 // '' or a progress message
  const [msg, setMsg] = useState({ text: '', kind: '' })
  const [setupNeeded, setSetupNeeded] = useState(false)
  const [view, setView] = useState('start')            // 'start' (new pack or saved drafts) | 'editor' (the generator)
  const [listLoading, setListLoading] = useState(true)
  const [panel, setPanel] = useState(null)             // null | 'issued'
  const [issuedFor, setIssuedFor] = useState(null)     // pack whose issued PDFs are shown (from the start page)
  const [packs, setPacks] = useState([])
  const [issues, setIssues] = useState([])
  const [search, setSearch] = useState('')
  const [del, setDel] = useState(null)                 // { pack, pw, err, busy }
  useEffect(() => { packRef.current = pack }, [pack])

  useDesignPackSources(frame, project?.id || null)     // BOQs + cable schedules for the pack

  const S = {
    btn: (bg, fg = '#fff', border = 'none') => ({ padding: '7px 12px', background: bg, color: fg, border, borderRadius: '7px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }),
    ghost: { padding: '7px 12px', background: 'transparent', color: T.textSecondary, border: `1px solid ${T.border}`, borderRadius: '7px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' },
    overlay: { position: 'fixed', inset: 0, background: 'rgba(10,20,35,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' },
  }
  const say = (text, kind = '') => setMsg({ text, kind })
  const post = m => frame.current?.contentWindow?.postMessage(m, window.location.origin)

  // ── messages from the generator ──
  useEffect(() => {
    function onMsg(e) {
      if (e.origin !== window.location.origin || e.source !== frame.current?.contentWindow) return
      const m = e.data || {}
      if (m.type === 'sos-design-pack:ready') {
        if (pendingLoad.current) { post({ type: 'sos-design-pack:load', ...pendingLoad.current }); pendingLoad.current = null }
        else if (prefill) post({ type: 'sos-design-pack:prefill', project: prefill }) // new pack inside a project: fill in its details
      } else if (m.type === 'sos-design-pack:loaded') {
        setDirty(false); setBusy('')
      } else if (m.type === 'sos-design-pack:dirty') {
        setDirty(m.dirty !== false)
      } else if (m.type === 'sos-design-pack:state' && waiters.current[m.reqId]) {
        waiters.current[m.reqId](m); delete waiters.current[m.reqId]
      } else if (m.type === 'sos-design-pack:compiled' && m.blob) {
        handleCompiled(m.filename, m.blob)
      }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }) // re-bound every render so handlers see current state

  function getState() {
    return new Promise((resolve, reject) => {
      const reqId = `r${Date.now()}${Math.random().toString(36).slice(2, 6)}`
      waiters.current[reqId] = resolve
      post({ type: 'sos-design-pack:getState', reqId })
      setTimeout(() => { if (waiters.current[reqId]) { delete waiters.current[reqId]; reject(new Error('The generator did not answer. Wait for it to finish loading and try again.')) } }, 20000)
    })
  }

  // ── save (draft) ──
  async function save({ quiet = false } = {}) {
    setBusy('Saving…'); if (!quiet) say('')
    try {
      const { state, files, print } = await getState()
      let row = packRef.current
      const t = title.trim() || titleFrom(state)
      const meta = { title: t, doc_no: state.project?.docNo || null, revision: state.project?.revision || null, updated_by: userName || null }
      if (!row) {
        const { data, error } = await supabase.from('design_packs')
          .insert([{ ...meta, project_id: project?.id || null, data: {}, created_by: userName || null }]).select().single()
        if (error) throw error
        row = data
      }
      // upload new files (drawings, photos, manual attachments)
      const paths = {}
      for (let i = 0; i < files.length; i++) {
        const f = files[i]
        setBusy(`Saving… uploading ${i + 1} of ${files.length}`)
        const path = `${row.id}/${FOLDER[f.kind] || 'files'}/${f.key}-${safeName(f.name)}`
        const { error } = await supabase.storage.from(BUCKET).upload(path, f.blob, { upsert: true, contentType: f.type })
        if (error) throw error
        paths[f.key] = path
      }
      const setPath = o => { if (o && o.key && paths[o.key]) o.storagePath = paths[o.key] }
      state.drawings?.forEach(setPath); state.photos?.forEach(setPath)
      Object.values(state.libs || {}).forEach(l => l.selected?.forEach(setPath))
      const { data: saved, error: upErr } = await supabase.from('design_packs').update({ ...meta, data: state }).eq('id', row.id).select().single()
      if (upErr) throw upErr
      post({ type: 'sos-design-pack:stored', paths, print })
      setPack(saved); packRef.current = saved; setTitle(saved.title); setDirty(false)
      cleanupStorage(saved.id, state) // remove files no longer used by this pack (in the background)
      if (!quiet) say(`Saved at ${fmtTime(saved.updated_at)}.`, 'ok')
      return saved
    } catch (e) {
      lastErr.current = isSetupError(e) ? setupText : `Could not save: ${e.message || e}`
      if (isSetupError(e)) setSetupNeeded(true)
      say(lastErr.current, 'err')
      return null
    } finally { setBusy('') }
  }

  async function cleanupStorage(id, state) {
    try {
      const used = new Set([...(state.drawings || []), ...(state.photos || []), ...Object.values(state.libs || {}).flatMap(l => l.selected || [])].map(o => o.storagePath).filter(Boolean))
      const gone = []
      for (const folder of Object.values(FOLDER)) {
        const { data } = await supabase.storage.from(BUCKET).list(`${id}/${folder}`, { limit: 1000 })
        ;(data || []).forEach(f => { const p = `${id}/${folder}/${f.name}`; if (!used.has(p)) gone.push(p) })
      }
      if (gone.length) await supabase.storage.from(BUCKET).remove(gone)
    } catch (e) { /* not important */ }
  }

  // ── compiled PDF → issued revision ──
  async function handleCompiled(filename, blob) {
    let row = packRef.current
    say('Saving the issued PDF…')
    if (!row || dirty) row = await save({ quiet: true })
    let packNote = row ? '' : `The PDF downloaded, but it was not kept as an issued revision. ${lastErr.current}`
    if (row) {
      try {
        const { data: st } = await supabase.from('design_packs').select('revision').eq('id', row.id).single()
        const path = `${row.id}/issued/${Date.now()}-${safeName(filename)}`
        const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'application/pdf' })
        if (error) throw error
        const { error: iErr } = await supabase.from('design_pack_issues').insert([{ pack_id: row.id, revision: st?.revision || null, filename, file_path: path, size_bytes: blob.size, issued_by: userName || null }])
        if (iErr) throw iErr
        packNote = `Saved as an issued revision of "${row.title}".`
        if (panel === 'issued') loadIssues(row.id)
      } catch (e) {
        packNote = isSetupError(e) ? setupText : `The PDF downloaded, but keeping it as an issued revision failed: ${e.message || e}`
      }
    }
    let projNote = ''
    if (onCompiled) {
      const ok = await Promise.resolve(onCompiled(filename, blob)).catch(() => false)
      projNote = ok ? ' Also saved to the project (Design stage).' : ' Saving it to the project files failed – upload it under Files & photos.'
    }
    say(`${packNote}${projNote}`, row && !/failed|setup/i.test(packNote) ? 'ok' : 'err')
  }

  // ── open / new / delete ──
  async function loadPacks() {
    let q = supabase.from('design_packs').select('id, title, project_id, doc_no, revision, updated_at, updated_by, projects(name), design_pack_issues(count)').order('updated_at', { ascending: false })
    if (project?.id) q = q.eq('project_id', project.id)
    const { data, error } = await q
    setListLoading(false)
    if (error) { if (isSetupError(error)) { setSetupNeeded(true); say(setupText, 'err') } else say(`Could not load saved packs: ${error.message}`, 'err'); return }
    setPacks(data || [])
  }
  async function loadIssues(id) {
    const { data, error } = await supabase.from('design_pack_issues').select('*').eq('pack_id', id).order('issued_at', { ascending: false })
    if (!error) setIssues(data || [])
  }
  const confirmDiscard = () => !dirty || window.confirm('You have unsaved changes in this design pack. Discard them?')

  async function openPack(id) {
    if (!confirmDiscard()) return
    setPanel(null); setBusy('Opening…'); say('')
    try {
      const { data: row, error } = await supabase.from('design_packs').select('*').eq('id', id).single()
      if (error) throw error
      const st = row.data || {}
      const wanted = [...(st.drawings || []), ...(st.photos || []), ...Object.values(st.libs || {}).flatMap(l => (l.selected || []).filter(x => x.manual))].filter(o => o.key && o.storagePath)
      const files = {}
      let done = 0
      await Promise.all(wanted.map(async o => {
        const { data } = await supabase.storage.from(BUCKET).download(o.storagePath)
        if (data) files[o.key] = data
        done += 1; setBusy(`Opening… ${done} of ${wanted.length} files`)
      }))
      pendingLoad.current = { state: st, files }
      setPack(row); packRef.current = row; setTitle(row.title); setDirty(false)
      setFrameKey(k => k + 1) // fresh generator; the load is sent when it reports ready
      setView('editor')
      setTimeout(() => setBusy(b => (b.startsWith('Opening') ? '' : b)), 30000)
    } catch (e) {
      setBusy(''); say(`Could not open: ${e.message || e}`, 'err')
    }
  }
  function newPack() {
    if (!confirmDiscard()) return
    setPanel(null); pendingLoad.current = null
    setPack(null); packRef.current = null; setTitle(''); setDirty(false); say('')
    setFrameKey(k => k + 1)
    setView('editor')
  }
  function backToList() {
    if (!confirmDiscard()) return
    pendingLoad.current = null
    setPack(null); packRef.current = null; setTitle(''); setDirty(false); say(''); setBusy('')
    setView('start'); setSearch(''); loadPacks()
  }
  async function confirmDelete() {
    if (!del.pw) { setDel(d => ({ ...d, err: 'Enter your password to delete.' })); return }
    setDel(d => ({ ...d, busy: true, err: '' }))
    try {
      if (!(await checkPassword(supabase, del.pw))) { setDel(d => ({ ...d, busy: false, err: 'Incorrect password. Nothing was deleted.' })); return }
      const id = del.pack.id
      const paths = []
      for (const folder of [...Object.values(FOLDER), 'issued']) {
        const { data } = await supabase.storage.from(BUCKET).list(`${id}/${folder}`, { limit: 1000 })
        ;(data || []).forEach(f => paths.push(`${id}/${folder}/${f.name}`))
      }
      const { error } = await supabase.from('design_packs').delete().eq('id', id)
      if (error) throw error
      if (paths.length) await supabase.storage.from(BUCKET).remove(paths)
      if (packRef.current?.id === id) { setPack(null); packRef.current = null; setTitle(''); setDirty(true) }
      setDel(null); say('Design pack deleted.', 'ok'); loadPacks()
    } catch (e) { setDel(d => ({ ...d, busy: false, err: e.message || String(e) })) }
  }
  async function downloadIssue(it) {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(it.file_path, 300, { download: it.filename })
    if (error) { say(`Could not open the PDF: ${error.message}`, 'err'); return }
    window.open(data.signedUrl, '_blank', 'noopener')
  }

  useEffect(() => {
    loadPacks()
    // opened straight from a project's Engineering work card: go directly to that pack / a new one
    if (initialPackId) openPack(initialPackId)
    else if (startNew) newPack()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const t = issuedFor || pack; if (panel === 'issued' && t) { setIssues([]); loadIssues(t.id) } }, [panel, issuedFor]) // eslint-disable-line react-hooks/exhaustive-deps
  const closePanel = () => { setPanel(null); setIssuedFor(null) }
  useEffect(() => {
    const warn = e => { if (dirty) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  // ── UI ──
  const statusChip = (() => {
    if (busy) return { text: busy, color: T.blue, icon: 'ti-loader-2' }
    if (!pack) return { text: dirty ? 'Not saved yet' : 'New pack – not saved', color: T.textMuted, icon: 'ti-file-plus' }
    if (dirty) return { text: 'Unsaved changes', color: T.orange, icon: 'ti-point-filled' }
    return { text: `Saved ${fmtWhen(pack.updated_at)}`, color: T.green, icon: 'ti-cloud-check' }
  })()
  const shown = packs.filter(p => !search.trim() || `${p.title} ${p.doc_no || ''} ${p.projects?.name || ''}`.toLowerCase().includes(search.trim().toLowerCase()))

  const issuedCount = p => p.design_pack_issues?.[0]?.count || 0
  const startPage = (
    <div>
      <div style={{ ...cardStyle, padding: '16px 20px', marginBottom: '14px', borderLeft: `3px solid ${T.green}` }}>
        <div style={{ fontSize: '18px', fontWeight: 800, color: T.textPrimary }}>{project ? `Design packs – ${project.name}` : 'Design packs'}</div>
        <div style={{ fontSize: '12px', color: T.textSecondary, marginTop: '3px' }}>Start a new design pack, or continue one of the drafts saved on the portal.</div>
        {msg.text && <div style={{ marginTop: '8px', fontSize: '12px', color: msg.kind === 'err' ? T.red : msg.kind === 'ok' ? T.green : T.textSecondary }}>{msg.text}</div>}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px', alignItems: 'stretch' }}>
        {/* New pack */}
        <button onClick={newPack} disabled={!!busy}
          style={{ ...cardStyle, flex: '1 1 250px', maxWidth: '100%', minHeight: '220px', padding: '24px', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px', textAlign: 'center', borderTop: `3px solid ${T.blue}`, font: 'inherit' }}>
          <span style={{ width: '58px', height: '58px', borderRadius: '14px', background: `${T.blue}18`, color: T.blue, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '30px' }}><i className="ti ti-file-plus" /></span>
          <span style={{ fontSize: '15px', fontWeight: 800, color: T.textPrimary }}>Start a new design pack</span>
          <span style={{ fontSize: '12px', color: T.textSecondary, lineHeight: 1.5, maxWidth: '260px' }}>
            {project ? `Starts with ${project.name}'s details filled in.` : 'A blank pack: project information, sign-off, drawings, photos, BOQ and wire schedule.'}
          </span>
          <span style={{ ...S.btn(T.blue), marginTop: '4px' }}><i className="ti ti-plus" />New design pack</span>
        </button>

        {/* Saved drafts */}
        <div style={{ ...cardStyle, flex: '3 1 420px', minWidth: 0, padding: '16px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '10px' }}>
            <div style={{ fontSize: '14px', fontWeight: 800, color: T.textPrimary }}>Saved drafts</div>
            {!listLoading && !setupNeeded && <span style={{ fontSize: '11px', color: T.textMuted }}>{packs.length} pack{packs.length === 1 ? '' : 's'}</span>}
            {packs.length > 4 && (
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, document no. or project…" aria-label="Search saved design packs"
                style={{ ...selectStyle, cursor: 'text', marginLeft: 'auto', flex: '0 1 280px', minWidth: 0 }} />
            )}
          </div>
          {setupNeeded ? (
            <div style={{ padding: '24px', textAlign: 'center', color: T.textSecondary, fontSize: '13px', border: `1px dashed ${T.orange}`, borderRadius: '8px' }}>
              <i className="ti ti-database-off" style={{ fontSize: '26px', color: T.orange, display: 'block', marginBottom: '6px' }} />{setupText}<br />You can still start a new pack and download the PDF.
            </div>
          ) : listLoading ? (
            <div style={{ padding: '30px', textAlign: 'center', color: T.textMuted, fontSize: '13px' }}>Loading saved design packs…</div>
          ) : shown.length === 0 ? (
            <div style={{ padding: '30px', textAlign: 'center', color: T.textMuted, fontSize: '13px', border: `1px dashed ${T.border}`, borderRadius: '8px' }}>
              {packs.length ? 'No packs match the search.' : 'No saved drafts yet. Start a new design pack and click Save draft to keep it here.'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '60vh', overflowY: 'auto' }}>
              {shown.map(p => (
                <div key={p.id} className="tbl-row" style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '11px 12px', border: `1px solid ${T.border}`, borderLeft: `3px solid ${T.green}`, borderRadius: '8px', flexWrap: 'wrap' }}>
                  <div role="button" tabIndex={0} onClick={() => openPack(p.id)} onKeyDown={e => { if (e.key === 'Enter') openPack(p.id) }} style={{ flex: '1 1 240px', minWidth: 0, cursor: 'pointer' }}>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: T.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</div>
                    <div style={{ fontSize: '11px', color: T.textMuted, marginTop: '2px' }}>
                      {[p.doc_no, p.revision && `Rev ${p.revision}`, !project && (p.projects?.name ? `Project: ${p.projects.name}` : null), `updated ${fmtWhen(p.updated_at)}${p.updated_by ? ` by ${p.updated_by}` : ''}`].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <button onClick={() => { setIssuedFor(p); setPanel('issued') }} disabled={!issuedCount(p)} title={issuedCount(p) ? 'Download the PDFs compiled from this pack' : 'No PDFs compiled yet'}
                    style={{ ...S.ghost, opacity: issuedCount(p) ? 1 : 0.5 }}><i className="ti ti-file-certificate" />{issuedCount(p)} issued</button>
                  <button onClick={() => openPack(p.id)} disabled={!!busy} style={S.btn(T.blue)}><i className="ti ti-pencil" />Continue</button>
                  <button onClick={() => setDel({ pack: p, pw: '', err: '', busy: false })} title="Delete this pack" aria-label={`Delete ${p.title}`} style={{ ...S.ghost, color: T.red, padding: '7px 9px' }}><i className="ti ti-trash" /></button>
                </div>
              ))}
            </div>
          )}
          {busy && <div style={{ marginTop: '10px', fontSize: '12px', color: T.blue, fontWeight: 700 }}>{busy}</div>}
        </div>
      </div>
    </div>
  )

  return (
    <div>
      {view === 'start' ? startPage : (<>
      <div style={{ ...cardStyle, padding: '10px 14px', marginBottom: '10px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px' }}>
        <button onClick={backToList} disabled={!!busy} title="Back to the list of design packs" style={{ ...S.ghost, padding: '7px 10px' }}><i className="ti ti-arrow-left" />All design packs</button>
        <input value={title} onChange={e => { setTitle(e.target.value); if (pack) setDirty(true) }} placeholder="Untitled design pack (named from Doc No. + Project when saved)"
          aria-label="Design pack name"
          style={{ ...selectStyle, flex: '1 1 260px', minWidth: 0, fontWeight: 700, cursor: 'text' }} />
        <span title={statusChip.text} style={{ fontSize: '11px', fontWeight: 700, color: statusChip.color, display: 'inline-flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}>
          <i className={`ti ${statusChip.icon}`} />{statusChip.text}
        </span>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginLeft: 'auto' }}>
          <button onClick={() => save()} disabled={!!busy || setupNeeded} style={{ ...S.btn(T.blue), opacity: busy || setupNeeded ? 0.55 : 1 }}><i className="ti ti-device-floppy" />Save draft</button>
          <button onClick={newPack} disabled={!!busy} style={S.ghost}><i className="ti ti-file-plus" />New</button>
          <button onClick={() => { setIssuedFor(null); setPanel('issued') }} disabled={!pack || !!busy} title={pack ? 'PDFs compiled from this pack' : 'Save the pack first'} style={{ ...S.ghost, opacity: pack ? 1 : 0.5 }}><i className="ti ti-file-certificate" />Issued PDFs</button>
        </div>
        {msg.text && <div style={{ flexBasis: '100%', fontSize: '12px', color: msg.kind === 'err' ? T.red : msg.kind === 'ok' ? T.green : T.textSecondary }}>{msg.text}</div>}
      </div>

      <div style={{ ...cardStyle, padding: 0, overflow: 'hidden', height, minHeight: '520px' }}>
        <iframe key={frameKey} ref={frame} src={project ? `${GEN_SRC}?from=project` : GEN_SRC} title="Design Pack Generator"
          style={{ width: '100%', height: '100%', border: 'none', display: 'block', background: '#fff' }} allow="clipboard-write" />
      </div>
      </>)}

      {panel === 'issued' && (
        <div style={S.overlay} onClick={e => { if (e.target === e.currentTarget) closePanel() }}>
          <div role="dialog" aria-label="Issued PDFs" style={{ ...cardStyle, width: '100%', maxWidth: '720px', maxHeight: '85vh', display: 'flex', flexDirection: 'column', padding: '18px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
              <div style={{ fontSize: '16px', fontWeight: 800, color: T.textPrimary, flex: 1 }}>Issued PDFs – {(issuedFor || pack)?.title || ''}</div>
              <button onClick={closePanel} aria-label="Close" style={{ ...S.ghost, padding: '5px 9px' }}><i className="ti ti-x" /></button>
            </div>
            <div style={{ overflowY: 'auto', flex: 1, border: `1px solid ${T.border}`, borderRadius: '8px' }}>
              {issues.length === 0 ? (
                <div style={{ padding: '30px', textAlign: 'center', color: T.textMuted, fontSize: '13px' }}>No issued PDFs yet. Each time you click Compile Design Pack, the PDF is kept here.</div>
              ) : issues.map(it => (
                <div key={it.id} className="tbl-row" style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', borderBottom: `1px solid ${T.border}` }}>
                  <i className="ti ti-file-type-pdf" style={{ color: T.red, fontSize: '18px' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: T.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.filename}</div>
                    <div style={{ fontSize: '11px', color: T.textMuted }}>{[it.revision && `Rev ${it.revision}`, fmtWhen(it.issued_at), it.issued_by, fmtSize(it.size_bytes)].filter(Boolean).join(' · ')}</div>
                  </div>
                  <button onClick={() => downloadIssue(it)} style={S.ghost}><i className="ti ti-download" />Download</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {del && (
        <div style={{ ...S.overlay, zIndex: 1010 }} onClick={e => { if (e.target === e.currentTarget && !del.busy) setDel(null) }}>
          <div style={{ ...cardStyle, width: '100%', maxWidth: '420px', padding: '20px' }}>
            <div style={{ fontSize: '16px', fontWeight: 800, color: T.textPrimary, marginBottom: '8px' }}>Delete design pack?</div>
            <div style={{ fontSize: '12px', color: T.textSecondary, marginBottom: '12px' }}>
              <b>{del.pack.title}</b>, its drawings, photos and all issued PDFs will be deleted. This can&apos;t be undone. Enter your portal password to confirm.
            </div>
            <input type="password" autoFocus value={del.pw} onChange={e => setDel(d => ({ ...d, pw: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') confirmDelete() }}
              placeholder="Your password" style={{ ...selectStyle, cursor: 'text', width: '100%', boxSizing: 'border-box' }} />
            {del.err && <div style={{ marginTop: '8px', fontSize: '12px', color: T.red }}>{del.err}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '14px' }}>
              <button onClick={() => setDel(null)} disabled={del.busy} style={S.ghost}>Cancel</button>
              <button onClick={confirmDelete} disabled={del.busy} style={{ ...S.btn(T.red), opacity: del.busy ? 0.6 : 1 }}><i className="ti ti-trash" />{del.busy ? 'Checking…' : 'Delete pack'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
