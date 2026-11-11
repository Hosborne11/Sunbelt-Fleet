import { supabase } from './supabase'

export const PM_BUCKET = 'pm-workorders' // older manual attachments
export const FILES_BUCKET = 'asset-files' // machine files, including dealer work orders

export const REQUEST_STATUS = {
  requested: { label: 'Requested', tone: 'amber', hint: 'Waiting for the dealer to propose a date' },
  proposed: { label: 'Accept date?', tone: 'amber', hint: 'The dealer proposed a date; accept it or ask for another' },
  scheduled: { label: 'Scheduled', tone: 'teal', hint: 'Date accepted with the dealer' },
  awaiting_confirmation: { label: 'Confirm?', tone: 'amber', hint: 'Service date passed; waiting for the dealer to confirm and send the work order' },
  completed: { label: 'Completed', tone: 'ink', hint: '' },
  cancelled: { label: 'Cancelled', tone: 'ink', hint: '' },
}

// Call the pm-workflow Edge Function; returns { data, error } with a readable error message
export async function pmAction(action, payload = {}) {
  const { data, error } = await supabase.functions.invoke('pm-workflow', { body: { action, ...payload } })
  if (error) {
    let message = error.message
    try {
      const body = await error.context?.json?.()
      if (body?.error) message = body.error
    } catch {
      /* keep the generic message */
    }
    return { data: null, error: message }
  }
  if (data?.error) return { data: null, error: data.error }
  return { data, error: null }
}

export function fmtTime(t) {
  if (!t) return ''
  const [h, m] = String(t).split(':').map(Number)
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

export function fmtDay(d) {
  if (!d) return ''
  const [y, m, day] = String(d).slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, day).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

export function fmtStamp(ts) {
  if (!ts) return ''
  return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

// Short-lived link to open a stored file
export async function attachmentUrl(path, bucket = PM_BUCKET) {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 300)
  return error ? null : data.signedUrl
}

export async function openFile(path, bucket) {
  const url = await attachmentUrl(path, bucket)
  if (url) window.open(url, '_blank', 'noopener')
}
