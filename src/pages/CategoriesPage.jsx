import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { ICONS, iconFor } from '../lib/categoryIcons'

export default function CategoriesPage() {
  const [categories, setCategories] = useState([])
  const [name, setName] = useState('')
  const [icon, setIcon] = useState('truck')
  const [error, setError] = useState(null)

  async function load() {
    const { data, error: err } = await supabase
      .from('equipment_categories')
      .select('*')
      .order('sort_order')
    if (err) setError(err.message)
    setCategories(data || [])
  }

  useEffect(() => {
    load()
  }, [])

  async function addCategory(e) {
    e.preventDefault()
    if (!name.trim()) return
    const { error: err } = await supabase
      .from('equipment_categories')
      .insert({ name: name.trim(), icon, sort_order: categories.length + 1 })
    if (err) {
      setError(err.message)
      return
    }
    setName('')
    load()
  }

  async function remove(id) {
    if (!window.confirm('Remove this category? Assets using it will become uncategorized.')) return
    await supabase.from('equipment_categories').delete().eq('id', id)
    load()
  }

  return (
    <div className="mx-auto h-full max-w-2xl overflow-y-auto px-6 py-8">
      <h1 className="text-xl font-semibold text-ink-100">Equipment categories</h1>
      <p className="mt-1 text-sm text-ink-500">The machine types shown in the registry icon column.</p>

      <form onSubmit={addCategory} className="mt-6 flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Category name"
          className="input flex-1"
        />
        <select value={icon} onChange={(e) => setIcon(e.target.value)} className="input w-40">
          {Object.keys(ICONS).map((key) => (
            <option key={key} value={key}>
              {key}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="flex items-center gap-1.5 whitespace-nowrap rounded bg-amber-400 px-3.5 py-2 text-sm font-medium text-graphite-950 hover:bg-amber-400/90"
        >
          <Plus size={16} /> Add
        </button>
      </form>

      {error && <p className="mt-3 text-sm text-rust-400">{error}</p>}

      <ul className="mt-6 divide-y divide-graphite-800 border-t border-graphite-800">
        {categories.map((c) => {
          const Icon = iconFor(c.icon)
          return (
            <li key={c.id} className="flex items-center justify-between py-3">
              <div className="flex items-center gap-2.5 text-sm text-ink-100">
                <Icon size={16} strokeWidth={1.75} className="text-ink-500" />
                {c.name}
              </div>
              <button
                onClick={() => remove(c.id)}
                className="rounded p-1.5 text-ink-500 hover:bg-rust-500/10 hover:text-rust-400"
              >
                <Trash2 size={15} />
              </button>
            </li>
          )
        })}
        {categories.length === 0 && (
          <li className="py-6 text-center text-sm text-ink-500">No categories yet.</li>
        )}
      </ul>
    </div>
  )
}
