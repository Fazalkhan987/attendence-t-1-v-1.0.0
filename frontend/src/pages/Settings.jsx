import { useCallback, useEffect, useState } from 'react'
import { KeyRound, RefreshCw } from 'lucide-react'
import { api } from '../lib/api'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import { Badge, Button, ErrorNote, Field, Panel, Spinner } from '../components/ui'

function Row({ label, children }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="tabular text-right font-medium">{children}</dd>
    </div>
  )
}

function PasswordForm() {
  const toast = useToast()
  const [f, setF] = useState({ current: '', next: '', repeat: '' })
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const submit = async (e) => {
    e.preventDefault()
    if (f.next.length < 10) return setError('The new password must be at least 10 characters.')
    if (f.next !== f.repeat) return setError('The new passwords do not match.')
    setSaving(true)
    setError(null)
    try {
      await api.post('/api/auth/password', { current_password: f.current, new_password: f.next })
      setF({ current: '', next: '', repeat: '' })
      toast.success('Password changed', 'Other signed-in sessions were signed out.')
    } catch (err) { setError(err.message) } finally { setSaving(false) }
  }
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {error && <ErrorNote>{error}</ErrorNote>}
      <Field label="Current password"><input type="password" className="field" autoComplete="current-password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} /></Field>
      <Field label="New password" hint="At least 10 characters"><input type="password" className="field" autoComplete="new-password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} /></Field>
      <Field label="Repeat new password"><input type="password" className="field" autoComplete="new-password" value={f.repeat} onChange={(e) => setF({ ...f, repeat: e.target.value })} /></Field>
      <Button type="submit" icon={KeyRound} loading={saving} disabled={!f.current || !f.next}>Change password</Button>
    </form>
  )
}

export default function Settings() {
  const toast = useToast()
  const { admin } = useAuth()
  const [sys, setSys] = useState(null)
  const [error, setError] = useState(null)
  const [reloading, setReloading] = useState(false)

  const load = useCallback(async () => {
    try { setError(null); setSys(await api.get('/api/system')) } catch (err) { setError(err.message) }
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (sys?.engine.status !== 'loading') return
    const t = setTimeout(load, 3000)
    return () => clearTimeout(t)
  }, [sys, load])

  const reload = async () => {
    setReloading(true)
    try { await api.post('/api/system/reload-engine'); toast.info('Reloading the recognition engine'); load() }
    catch (err) { toast.error('Reload failed', err.message) } finally { setReloading(false) }
  }

  if (error && !sys) return <ErrorNote onRetry={load}>{error}</ErrorNote>
  if (!sys) return <Spinner label="Loading settings" />
  const e = sys.engine
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Panel title="Recognition engine" action={
        <Button size="sm" variant="secondary" icon={RefreshCw} loading={reloading || e.status === 'loading'} onClick={reload}>Reload engine</Button>}>
        <dl className="divide-y divide-line">
          <Row label="Status">
            {e.status === 'ready' ? <Badge tone="present" dot>Ready</Badge> : e.status === 'loading' ? <Badge tone="brand" dot>Loading</Badge> : <Badge tone="absent" dot>{e.status === 'error' ? 'Failed' : 'Not loaded'}</Badge>}
          </Row>
          {e.error && <div className="py-2.5"><ErrorNote>{e.error}</ErrorNote></div>}
          <Row label="Model">{e.model || '—'}</Row>
          <Row label="People in recognition gallery">{e.gallery_size}</Row>
          <Row label="Load time">{e.load_seconds ? `${e.load_seconds} s` : '—'}</Row>
          <Row label="Match threshold (cosine)">{sys.recognition.similarity_threshold}</Row>
          <Row label="Required margin over runner-up">{sys.recognition.margin}</Row>
          <Row label="Matching strategy">{sys.recognition.strategy}</Row>
          <Row label="Votes needed before marking">{sys.live.min_votes} of {sys.live.window} frames</Row>
          <Row label="Samples per registration">{sys.enrollment.min_samples} minimum, {sys.enrollment.target_samples} target</Row>
          <Row label="Liveness / anti-spoofing"><Badge tone="late">Not checked</Badge></Row>
        </dl>
        <p className="mt-3 text-xs leading-relaxed text-muted">
          Thresholds come from <code>face_attendance/config/default.yaml</code>. Calibrate them on your own data with <code>faceattend evaluate</code>, then restart the backend.
        </p>
      </Panel>

      <div className="space-y-6">
        <Panel title="Attendance rules">
          <dl className="divide-y divide-line">
            <Row label="Today">{sys.attendance.today}</Row>
            <Row label="Timezone">{sys.attendance.timezone}</Row>
            <Row label="Late after">{sys.attendance.late_after || 'Not used'}</Row>
            <Row label="Marks per person per day">1</Row>
          </dl>
          <p className="mt-3 text-xs text-muted">Change <code>ATTENDANCE_TIMEZONE</code> and <code>LATE_AFTER</code> in <code>backend/.env</code>.</p>
        </Panel>
        <Panel title={`Account: ${admin?.username}`}><PasswordForm /></Panel>
      </div>
    </div>
  )
}
