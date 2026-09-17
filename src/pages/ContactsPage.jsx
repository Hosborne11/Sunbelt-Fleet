import { useEffect, useMemo, useState } from 'react'
import { Plus, Search, Users } from 'lucide-react'
import { supabase } from '../lib/supabase'
import ContactDrawer from '../components/ContactDrawer'

export default function ContactsPage() {
  const [contacts, setContacts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingContact, setEditingContact] = useState(null)

  async function loadAll() {
    setLoading(true)
    setError(null)
    const { data, error: err } = await supabase.from('contacts').select('*').order('name')
    if (err) setError(err.message)
    setContacts(data || [])
    setLoading(false)
  }

  useEffect(() => {
    loadAll()
  }, [])

  const filtered = useMemo(() => {
    if (!search) return contacts
    const q = search.toLowerCase()
    return contacts.filter((c) =>
      [c.name, c.work_email, c.work_cell, c.work_phone].filter(Boolean).join(' ').toLowerCase().includes(q)
    )
  }, [contacts, search])

  function openAdd() {
    setEditingContact(null)
    setDrawerOpen(true)
  }
  function openEdit(c) {
    setEditingContact(c)
    setDrawerOpen(true)
  }
  function closeDrawer() {
    setDrawerOpen(false)
    setEditingContact(null)
  }
  function onSaved() {
    closeDrawer()
    loadAll()
  }
  function onDeleted() {
    closeDrawer()
    loadAll()
  }

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-graphite-700 px-6 py-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-ink-100">Contacts</h1>
            <p className="mt-0.5 text-sm text-ink-500">
              {loading ? 'Loading…' : `${filtered.length} of ${contacts.length} contacts`}
            </p>
          </div>
          <button
            onClick={openAdd}
            className="flex items-center gap-1.5 rounded bg-amber-400 px-3.5 py-2 text-sm font-medium text-graphite-950 hover:bg-amber-400/90"
          >
            <Plus size={16} /> Add contact
          </button>
        </div>

        <div className="relative mt-4 w-72">
          <Search
            size={15}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-500"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, email, phone…"
            className="w-full rounded border border-graphite-600 bg-graphite-900 py-1.5 pl-8 pr-3 text-sm text-ink-100 placeholder:text-ink-500 outline-none focus:border-amber-400/60"
          />
        </div>
      </header>

      <div className="flex-1 overflow-auto px-6 py-4">
        {error && (
          <div className="mb-4 rounded border border-rust-500/30 bg-rust-500/10 px-4 py-3 text-sm text-rust-400">
            {error.includes('relation') || error.includes('does not exist')
              ? "Couldn't find the contacts table yet — run supabase/migrations/007_reservations_contacts.sql in your Supabase project's SQL editor, then reload."
              : error}
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded border border-dashed border-graphite-600 py-16 text-center">
            <Users size={28} className="mb-2 text-ink-500" />
            <p className="text-ink-300">
              {contacts.length === 0 ? 'No contacts yet.' : 'No contacts match this search.'}
            </p>
            {contacts.length === 0 && (
              <button
                onClick={openAdd}
                className="mt-3 rounded bg-amber-400 px-3.5 py-2 text-sm font-medium text-graphite-950 hover:bg-amber-400/90"
              >
                Add your first contact
              </button>
            )}
          </div>
        )}

        {filtered.length > 0 && (
          <div className="overflow-x-auto rounded border border-graphite-800">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-graphite-700 bg-graphite-800/60 text-left text-xs uppercase tracking-wide text-ink-500">
                  <th className="py-2 pl-3 pr-3 font-medium">Name</th>
                  <th className="py-2 pr-3 font-medium">Preferred method</th>
                  <th className="py-2 pr-3 font-medium">Work email</th>
                  <th className="py-2 pr-3 font-medium">Work cell</th>
                  <th className="py-2 pr-3 font-medium">Work phone</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => openEdit(c)}
                    className="cursor-pointer border-b border-graphite-800 hover:bg-graphite-800/60"
                  >
                    <td className="whitespace-nowrap py-2.5 pl-3 pr-3 text-ink-100">{c.name}</td>
                    <td className="whitespace-nowrap py-2.5 pr-3 text-ink-300">
                      {c.preferred_method || '—'}
                    </td>
                    <td className="whitespace-nowrap py-2.5 pr-3 text-ink-300">
                      {c.work_email || '—'}
                    </td>
                    <td className="whitespace-nowrap py-2.5 pr-3 font-mono text-ink-500">
                      {c.work_cell || '—'}
                    </td>
                    <td className="whitespace-nowrap py-2.5 pr-3 font-mono text-ink-500">
                      {c.work_phone || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {drawerOpen && (
        <ContactDrawer
          contact={editingContact}
          onClose={closeDrawer}
          onSaved={onSaved}
          onDeleted={onDeleted}
        />
      )}
    </div>
  )
}
