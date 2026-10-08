import { useCallback, useEffect, useRef, useState } from 'react'
import { FileText, FolderOpen, Trash2, Upload } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { FILES_BUCKET, fmtStamp, openFile } from '../lib/pm'

const CATEGORIES = [
  { value: 'work_order', label: 'Work order' },
  { value: 'document', label: 'Document' },
  { value: 'invoice', label: 'Invoice' },
  { value: 'photo', label: 'Photo' },
  { value: 'other', label: 'Other' },
]
const labelFor = (v) => CATEGORIES.find((c) => c.value === v)?.label || v
const size = (b) => (b == null ? '' : b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`)

// Files kept with a machine. Dealer work orders from the PM workflow land here automatically.
export default function AssetFiles({ assetId }) {
  const [files, setFiles] = useState([])
  const [category, setCategory] = useState('document')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const input = useRef(null)

  const load = useCallback(async () => {
    const { data, error: err } = await supabase.from('asset_files').select('*')
      .eq('asset_id', assetId).order('created_at', { ascending: false })
    if (err) setError(err.message)
    setFiles(data || [])
  }, [assetId])

  useEffect(() => {
    load()
  }, [load])

  async function upload(e) {
    const picked = [...(e.target.files || [])]
    e.target.value = ''
    if (!picked.length) return
    setBusy(true)
    setError(null)
    const { data: who } = await supabase.auth.getUser()
    for (const f of picked) {
      const safe = f.name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80)
      const folder = category === 'work_order' ? 'work-orders' : 'documents'
      const path = `${assetId}/${folder}/${Date.now()}-${safe}`
      const { error: upErr } = await supabase.storage.from(FILES_BUCKET).upload(path, f)
      if (upErr) {
        setError(`${f.name}: ${upErr.message}`)
        continue
      }
      const { error: rowErr } = await supabase.from('asset_files').insert({
        asset_id: assetId, bucket: FILES_BUCKET, path, file_name: f.name, content_type: f.type || null,
        size_bytes: f.size, category, uploaded_by: who?.user?.email || null,
      })
      if (rowErr) setError(`${f.name}: ${rowErr.message}`)
    }
    setBusy(false)
    load()
  }

  async function remove(f) {
    if (!window.confirm(`Delete ${f.file_name}? This can't be undone.`)) return
    await supabase.storage.from(f.bucket).remove([f.path])
    const { error: err } = await supabase.from('asset_files').delete().eq('id', f.id)
    if (err) setError(err.message)
    load()
  }

  return (
    <div className="rounded border border-graphite-700 bg-graphite-800/40">
      <div className="flex items-center justify-between gap-2 border-b border-graphite-700 px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-ink-100">
          <FolderOpen size={16} strokeWidth={1.75} className="text-ink-500" />
          Files
          <span className="font-normal text-ink-500">({files.length})</span>
        </div>
        <div className="flex items-center gap-2">
          <select value={category} onChange={(e) => setCategory(e.target.value)}
                  className="rounded border border-graphite-600 bg-graphite-900 px-2 py-1 text-xs text-ink-300">
            {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          <button onClick={() => input.current?.click()} disabled={busy}
                  className="flex items-center gap-1 rounded px-2 py-1 text-xs text-ink-500 hover:bg-graphite-700 hover:text-ink-100 disabled:opacity-60">
            <Upload size={13} /> {busy ? 'Uploading…' : 'Upload'}
          </button>
          <input ref={input} type="file" multiple className="sr-only" onChange={upload}
                 accept=".pdf,image/*,.doc,.docx,.xls,.xlsx,.csv,.txt" />
        </div>
      </div>
      {error && <p className="px-4 pt-3 text-xs text-rust-400">{error}</p>}
      <div className="max-h-64 overflow-y-auto">
        {files.length === 0 ? (
          <p className="px-4 py-4 text-sm text-ink-500">
            No files yet. Work orders the dealer sends with a completed PM are saved here automatically.
          </p>
        ) : (
          files.map((f) => (
            <div key={f.id} className="flex items-center gap-3 border-b border-graphite-800 px-4 py-2.5 text-sm last:border-b-0">
              <FileText size={15} strokeWidth={1.75} className="shrink-0 text-ink-500" />
              <button onClick={() => openFile(f.path, f.bucket)} className="min-w-0 flex-1 text-left" title="Open">
                <div className="truncate text-ink-100 hover:text-amber-400">{f.file_name}</div>
                <div className="truncate text-xs text-ink-500">
                  {[labelFor(f.category), fmtStamp(f.created_at), f.uploaded_by, size(f.size_bytes)].filter(Boolean).join(', ')}
                </div>
              </button>
              <button onClick={() => remove(f)} className="shrink-0 text-ink-500 hover:text-rust-400" aria-label={`Delete ${f.file_name}`}>
                <Trash2 size={13} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
