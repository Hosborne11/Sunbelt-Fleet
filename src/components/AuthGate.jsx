import { useEffect, useState } from 'react'
import { Mail } from 'lucide-react'
import { supabase } from '../lib/supabase'

// Everything in the app requires a signed-in user. Staff sign in with a one-time
// email link; only people invited in Supabase (Authentication -> Users) can get one.
export default function AuthGate({ children }) {
  const [session, setSession] = useState(undefined) // undefined = still checking

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  if (session === undefined) {
    return <div className="flex h-screen items-center justify-center text-sm text-ink-500">Loading…</div>
  }
  if (!session) return <SignIn />
  return children
}

function SignIn() {
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [sentTo, setSentTo] = useState(null)
  const [error, setError] = useState(null)

  async function sendLink(e) {
    e.preventDefault()
    const address = email.trim().toLowerCase()
    if (!address) return
    setSending(true)
    setError(null)
    const { error: err } = await supabase.auth.signInWithOtp({
      email: address,
      options: { shouldCreateUser: false, emailRedirectTo: window.location.origin },
    })
    setSending(false)
    if (err) {
      setError(
        /signups? not allowed|not found|otp_disabled/i.test(err.message)
          ? "That email isn't set up for Fleet yet. Ask an admin to invite you."
          : err.message
      )
      return
    }
    setSentTo(address)
  }

  return (
    <div className="flex h-screen items-center justify-center bg-graphite-900 px-6">
      <div className="w-full max-w-sm">
        <div className="mb-6">
          <div className="font-mono text-xs uppercase tracking-wide text-ink-500">Sunbelt Utilities</div>
          <div className="text-2xl font-semibold text-ink-100">Fleet</div>
        </div>

        {sentTo ? (
          <div className="rounded border border-graphite-700 bg-graphite-800 px-4 py-4">
            <div className="flex items-center gap-2 text-sm font-medium text-ink-100">
              <Mail size={16} strokeWidth={1.75} className="text-amber-400" />
              Check your email
            </div>
            <p className="mt-1.5 text-sm text-ink-300">
              We sent a sign-in link to <span className="text-ink-100">{sentTo}</span>. Open it on this
              device to continue.
            </p>
            <button
              onClick={() => setSentTo(null)}
              className="mt-3 text-sm text-ink-500 hover:text-ink-100"
            >
              Use a different email
            </button>
          </div>
        ) : (
          <form onSubmit={sendLink} className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-sm text-ink-300">Work email</span>
              <input
                type="email"
                autoFocus
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@sunbeltutilities.com"
                className="input"
              />
            </label>
            <button
              type="submit"
              disabled={sending}
              className="w-full rounded bg-amber-400 px-3.5 py-2 text-sm font-medium text-graphite-950 hover:bg-amber-400/90 disabled:opacity-60"
            >
              {sending ? 'Sending…' : 'Email me a sign-in link'}
            </button>
            {error && <p className="text-sm text-rust-400">{error}</p>}
          </form>
        )}
      </div>
    </div>
  )
}
