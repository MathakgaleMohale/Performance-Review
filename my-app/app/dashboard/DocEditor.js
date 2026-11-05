'use client'

// Word-like editor for engineering template documents (TipTap v2)
import { useEffect, useRef } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import TextAlign from '@tiptap/extension-text-align'
import Highlight from '@tiptap/extension-highlight'
import Image from '@tiptap/extension-image'
import Placeholder from '@tiptap/extension-placeholder'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableHeader from '@tiptap/extension-table-header'
import TableCell from '@tiptap/extension-table-cell'
import { DOC_CONTENT_CSS } from '@/lib/templateExport'

export const EDITOR_EXTENSIONS = [
  StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
  Underline,
  Highlight,
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  Image.configure({ inline: false, allowBase64: false }),
  Placeholder.configure({ placeholder: 'Start typing…' }),
  TaskList,
  TaskItem.configure({ nested: false }),
  Table.configure({ resizable: true, lastColumnResizable: false }),
  TableRow,
  TableHeader,
  TableCell,
]

const EDITOR_CSS = `
.sos-editor .ProseMirror { outline: none; min-height: 600px; }
.sos-editor .ProseMirror p.is-editor-empty:first-child::before { content: attr(data-placeholder); color: #AFAFAF; float: left; height: 0; pointer-events: none; }
.sos-editor .ProseMirror .selectedCell:after { content: ''; position: absolute; inset: 0; background: rgba(11,116,215,0.12); pointer-events: none; }
.sos-editor .ProseMirror .column-resize-handle { position: absolute; right: -2px; top: 0; bottom: -2px; width: 4px; background: #0B74D7; pointer-events: none; }
.sos-editor .ProseMirror.resize-cursor { cursor: col-resize; }
.sos-editor .ProseMirror img.ProseMirror-selectednode { outline: 3px solid #0B74D7; }
.sos-editor .tableWrapper { overflow-x: auto; }
`

export default function DocEditor({ T, content, onChange, editable = true, onImageUpload, onReady }) {
  const fileRef = useRef(null)
  const editor = useEditor({
    extensions: EDITOR_EXTENSIONS,
    content: content || '',
    editable,
    immediatelyRender: false,
    onUpdate: ({ editor: ed }) => onChange && onChange(ed),
  })
  useEffect(() => { if (editor && onReady) onReady(editor) }, [editor]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (editor) editor.setEditable(editable) }, [editor, editable])

  if (!editor) return <div style={{ padding: '40px', textAlign: 'center', color: T.textMuted, fontSize: '13px' }}>Loading editor…</div>

  const inTable = editor.isActive('table')
  const btn = (active, disabled) => ({
    minWidth: '30px', height: '30px', padding: '0 7px', border: `1px solid ${active ? '#0B74D7' : 'transparent'}`, borderRadius: '6px',
    background: active ? 'rgba(11,116,215,0.12)' : 'transparent', color: disabled ? T.textMuted : T.textPrimary, cursor: disabled ? 'default' : 'pointer',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '4px', fontSize: '14px', opacity: disabled ? 0.45 : 1,
  })
  const sep = <span style={{ width: '1px', alignSelf: 'stretch', background: T.border, margin: '0 4px' }} />
  const B = ({ icon, title, on, active, disabled, label }) => (
    <button type="button" title={title} disabled={disabled} onMouseDown={e => e.preventDefault()} onClick={on} style={btn(active, disabled)}>
      {icon && <i className={`ti ${icon}`} />}{label && <span style={{ fontSize: '11px', fontWeight: 700 }}>{label}</span>}
    </button>
  )
  const c = () => editor.chain().focus()
  const blockType = editor.isActive('heading', { level: 1 }) ? 'h1' : editor.isActive('heading', { level: 2 }) ? 'h2' : editor.isActive('heading', { level: 3 }) ? 'h3' : 'p'

  async function addImage(file) {
    if (!file || !onImageUpload) return
    const url = await onImageUpload(file)
    if (url) c().setImage({ src: url, alt: file.name }).run()
  }

  return (
    <div className="sos-editor">
      <style>{DOC_CONTENT_CSS + EDITOR_CSS}</style>
      {editable && (
        <div style={{ position: 'sticky', top: '64px', zIndex: 5, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '2px', padding: '6px 8px', background: T.bgPanel, border: `1px solid ${T.border}`, borderRadius: '8px', marginBottom: '10px', boxShadow: '0 2px 8px rgba(26,42,74,0.06)' }}>
          <B icon="ti-arrow-back-up" title="Undo (Ctrl+Z)" on={() => c().undo().run()} disabled={!editor.can().undo()} />
          <B icon="ti-arrow-forward-up" title="Redo (Ctrl+Y)" on={() => c().redo().run()} disabled={!editor.can().redo()} />
          {sep}
          <select value={blockType} onChange={e => {
            const v = e.target.value
            if (v === 'p') c().setParagraph().run(); else c().setHeading({ level: Number(v[1]) }).run()
          }} style={{ height: '30px', border: `1px solid ${T.border}`, borderRadius: '6px', background: T.bgPanel, color: T.textPrimary, fontSize: '12px', padding: '0 6px' }}>
            <option value="p">Normal text</option>
            <option value="h1">Title</option>
            <option value="h2">Heading</option>
            <option value="h3">Sub-heading</option>
          </select>
          {sep}
          <B icon="ti-bold" title="Bold (Ctrl+B)" on={() => c().toggleBold().run()} active={editor.isActive('bold')} />
          <B icon="ti-italic" title="Italic (Ctrl+I)" on={() => c().toggleItalic().run()} active={editor.isActive('italic')} />
          <B icon="ti-underline" title="Underline (Ctrl+U)" on={() => c().toggleUnderline().run()} active={editor.isActive('underline')} />
          <B icon="ti-highlight" title="Highlight" on={() => c().toggleHighlight().run()} active={editor.isActive('highlight')} />
          {sep}
          <B icon="ti-align-left" title="Align left" on={() => c().setTextAlign('left').run()} active={editor.isActive({ textAlign: 'left' })} />
          <B icon="ti-align-center" title="Centre" on={() => c().setTextAlign('center').run()} active={editor.isActive({ textAlign: 'center' })} />
          <B icon="ti-align-right" title="Align right" on={() => c().setTextAlign('right').run()} active={editor.isActive({ textAlign: 'right' })} />
          {sep}
          <B icon="ti-list" title="Bullet list" on={() => c().toggleBulletList().run()} active={editor.isActive('bulletList')} />
          <B icon="ti-list-numbers" title="Numbered list" on={() => c().toggleOrderedList().run()} active={editor.isActive('orderedList')} />
          <B icon="ti-checkbox" title="Tick box" on={() => c().toggleTaskList().run()} active={editor.isActive('taskList')} />
          {sep}
          <B icon="ti-table-plus" title="Insert table" on={() => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} />
          <B icon="ti-row-insert-bottom" title="Add row below" on={() => c().addRowAfter().run()} disabled={!inTable} />
          <B icon="ti-column-insert-right" title="Add column right" on={() => c().addColumnAfter().run()} disabled={!inTable} />
          <B icon="ti-row-remove" title="Delete row" on={() => c().deleteRow().run()} disabled={!inTable} />
          <B icon="ti-column-remove" title="Delete column" on={() => c().deleteColumn().run()} disabled={!inTable} />
          <B icon="ti-arrows-join-2" title="Merge / split cells" on={() => c().mergeOrSplit().run()} disabled={!inTable} />
          <B icon="ti-table-row" title="Header row on/off" on={() => c().toggleHeaderRow().run()} disabled={!inTable} />
          <B icon="ti-table-off" title="Delete table" on={() => c().deleteTable().run()} disabled={!inTable} />
          {sep}
          <B icon="ti-photo-plus" title="Insert photo" on={() => fileRef.current?.click()} disabled={!onImageUpload} />
          <B icon="ti-separator-horizontal" title="Divider line" on={() => c().setHorizontalRule().run()} />
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { addImage(e.target.files?.[0]); e.target.value = '' }} />
        </div>
      )}
      <div style={{ background: '#fff', border: `1px solid ${T.border}`, borderRadius: '8px', padding: '36px 44px', boxShadow: '0 2px 14px rgba(26,42,74,0.06)', maxWidth: '920px', margin: '0 auto' }}>
        <EditorContent editor={editor} className="sos-doc" />
      </div>
    </div>
  )
}
