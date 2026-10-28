import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, CheckCircle2, ImageUp, Pause, Play, RefreshCw, SwitchCamera, TriangleAlert } from 'lucide-react'
import { api } from '../lib/api'
import { useCamera } from '../hooks/useCamera'
import { useToast } from '../context/ToastContext'
import { Button, ErrorNote, Modal } from './ui'

const CAPTURE_INTERVAL_MS = 700

export default function FaceEnrollModal({ open, person, onClose, onDone }) {
  const toast = useToast()
  const cam = useCamera({ width: 1280, height: 720 })
  const [session, setSession] = useState(null)
  const [startError, setStartError] = useState(null)
  const [capturing, setCapturing] = useState(true)
  const [feedback, setFeedback] = useState(null)        // { message, ok, bbox, frame }
  const [flash, setFlash] = useState(0)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [duplicate, setDuplicate] = useState(null)
  const sessionRef = useRef(null)
  const committedRef = useRef(false)
  const busyRef = useRef(false)
  const fileRef = useRef(null)

  const pid = person ? encodeURIComponent(person.person_id) : ''
  const full = session && session.accepted >= session.target_samples

  const begin = useCallback(async () => {
    setStartError(null)
    setDuplicate(null)
    setFeedback(null)
    committedRef.current = false
    try {
      const s = await api.post(`/api/persons/${pid}/enrollment`)
      sessionRef.current = s
      setSession(s)
      setCapturing(true)
      cam.start()
    } catch (err) {
      setStartError(err.message)
    }
  }, [pid, cam.start]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open || !person) return
    begin()
    return () => {
      cam.stop()
      const s = sessionRef.current
      if (s && !committedRef.current) api.del(`/api/persons/${encodeURIComponent(s.person_id)}/enrollment/${s.session_id}`).catch(() => {})
      sessionRef.current = null
      setSession(null)
    }
  }, [open, person?.person_id]) // eslint-disable-line react-hooks/exhaustive-deps

  const sendFrame = useCallback(async (blob, source) => {
    const s = sessionRef.current
    if (!s || !blob) return null
    const form = new FormData()
    form.append('file', blob, source === 'upload' ? blob.name || 'photo.jpg' : 'frame.jpg')
    form.append('source', source)
    const res = await api.upload(`/api/persons/${encodeURIComponent(s.person_id)}/enrollment/${s.session_id}/frames`, form)
    setSession((prev) => ({ ...prev, ...res }))
    setFeedback({ message: res.message, ok: res.accepted_frame, bbox: res.bbox, frame: res.frame })
    if (res.accepted_frame) setFlash((n) => n + 1)
    return res
  }, [])

  // Auto-capture loop: one request in flight at a time.
  useEffect(() => {
    if (!open || !session || !capturing || full || cam.status !== 'live') return
    let stopped = false
    const tick = async () => {
      if (stopped || busyRef.current) return
      busyRef.current = true
      try {
        await sendFrame(await cam.capture(960, 0.9), 'webcam')
      } catch (err) {
        if (err.code === 'session_not_found') { stopped = true; setStartError(err.message) }
        else setFeedback({ message: err.message, ok: false })
      } finally {
        busyRef.current = false
      }
    }
    const t = setInterval(tick, CAPTURE_INTERVAL_MS)
    return () => { stopped = true; clearInterval(t) }
  }, [open, session?.session_id, capturing, full, cam.status, cam.capture, sendFrame]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (full) setCapturing(false) }, [full])

  const onUpload = async (e) => {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length) return
    setUploading(true)
    setCapturing(false)
    let accepted = 0
    const reasons = []
    for (const f of files) {
      try {
        const r = await sendFrame(f, 'upload')
        if (r?.accepted_frame) accepted += 1
        else if (r) reasons.push(`${f.name}: ${r.message}`)
      } catch (err) { reasons.push(`${f.name}: ${err.message}`) }
    }
    setUploading(false)
    if (accepted) toast.success(`${accepted} of ${files.length} photo${files.length > 1 ? 's' : ''} accepted`)
    if (reasons.length) toast.error('Some photos were not used', reasons.slice(0, 3).join(' • '))
  }

  const save = async (force = false) => {
    const s = sessionRef.current
    if (!s) return
    setSaving(true)
    try {
      const res = await api.post(`/api/persons/${pid}/enrollment/${s.session_id}/commit`, { force })
      committedRef.current = true
      cam.stop()
      toast.success('Face registered', `${person.full_name} can now be recognised (${res.total_samples} samples stored).`)
      onDone()
    } catch (err) {
      if (err.code === 'duplicate_face') setDuplicate(err.data)
      else toast.error('Face not saved', err.message)
    } finally {
      setSaving(false)
    }
  }

  const mirrored = cam.facing === 'user'
  const pct = session ? Math.min(100, (100 * session.accepted) / Math.max(1, session.target_samples)) : 0
  const box = feedback?.bbox && feedback.frame ? (() => {
    const [w] = feedback.frame
    const [x1, y1, x2, y2] = feedback.bbox
    return { x: mirrored ? w - x2 : x1, y: y1, w: x2 - x1, h: y2 - y1 }
  })() : null

  return (
    <Modal open={open} onClose={onClose} title={person ? `Register face: ${person.full_name}` : ''} size="lg" dismissable={!saving}
      footer={<>
        <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button onClick={() => save(false)} loading={saving} disabled={!session?.can_commit || uploading} icon={CheckCircle2}>
          Save face data
        </Button>
      </>}>
      {startError ? (
        <ErrorNote onRetry={begin}>{startError}</ErrorNote>
      ) : (
        <div className="grid gap-5 md:grid-cols-[1fr_220px]">
          <div>
            <div className="relative aspect-video overflow-hidden rounded-lg bg-ink">
              <video ref={cam.videoRef} muted playsInline autoPlay
                     className={`h-full w-full object-contain ${mirrored ? '-scale-x-100' : ''}`} />
              {cam.status === 'live' && feedback?.frame && (
                <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${feedback.frame[0]} ${feedback.frame[1]}`}
                     preserveAspectRatio="xMidYMid meet" aria-hidden>
                  {box && <rect x={box.x} y={box.y} width={box.w} height={box.h} rx="10" fill="none"
                                stroke={feedback.ok ? '#5fd39a' : '#f2b84b'} strokeWidth={Math.max(2, feedback.frame[0] / 320)} />}
                </svg>
              )}
              {cam.status === 'live' && !full && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden>
                  <div className="h-[72%] aspect-[3/4] rounded-[50%] border-2 border-dashed border-white/40" />
                </div>
              )}
              {flash > 0 && <div key={flash} className="animate-flash pointer-events-none absolute inset-0 bg-white" />}
              {cam.status === 'starting' && (
                <div className="absolute inset-0 flex items-center justify-center text-sm text-white/80">Starting camera…</div>
              )}
              {cam.status === 'error' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-sm text-white">
                  <TriangleAlert className="h-7 w-7 text-[#f2b84b]" />
                  <p className="max-w-sm">{cam.error}</p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" icon={RefreshCw} onClick={() => cam.start(cam.deviceId)}>Try again</Button>
                    <Button size="sm" variant="secondary" icon={ImageUp} onClick={() => fileRef.current?.click()}>Upload photos</Button>
                  </div>
                </div>
              )}
              {cam.status === 'idle' && session && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Button variant="secondary" icon={Camera} onClick={() => cam.start(cam.deviceId)}>Start camera</Button>
                </div>
              )}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {cam.status === 'live' && !full && (
                <Button size="sm" variant="secondary" icon={capturing ? Pause : Play} onClick={() => setCapturing((c) => !c)}>
                  {capturing ? 'Pause capture' : 'Resume capture'}
                </Button>
              )}
              {cam.devices.length > 1 && cam.status === 'live' && (
                <Button size="sm" variant="secondary" icon={SwitchCamera} onClick={cam.switchCamera}>Switch camera</Button>
              )}
              <Button size="sm" variant="ghost" icon={ImageUp} loading={uploading} onClick={() => fileRef.current?.click()}
                      disabled={!session || full}>Upload photos</Button>
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={onUpload} />
            </div>
          </div>

          <div className="flex flex-col">
            <p className="text-sm text-muted">Samples captured</p>
            <p className="tabular mt-1 text-3xl font-semibold">
              {session?.accepted ?? 0}<span className="text-lg font-normal text-muted"> / {session?.target_samples ?? '–'}</span>
            </p>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-paper ring-1 ring-inset ring-line">
              <div className="h-full bg-present transition-[width] duration-300" style={{ width: `${pct}%` }} />
            </div>
            {session && (
              <p className="mt-1.5 text-xs text-muted">
                {session.can_commit ? 'Enough to save. More samples improve accuracy.' : `At least ${session.min_samples} needed to save.`}
              </p>
            )}

            <div className="mt-5 rounded-md bg-brand-50 px-3.5 py-3">
              <p className="text-xs font-medium text-brand">{full ? 'Done' : 'Next pose'}</p>
              <p className="mt-0.5 text-sm font-medium text-[#1b2433]">
                {full ? 'All samples captured. Save to finish.' : session?.prompt || 'Look at the camera'}
              </p>
            </div>
            {feedback?.message && !full && (
              <p className={`mt-3 text-sm ${feedback.ok ? 'text-present' : 'text-late'}`} role="status">{feedback.message}</p>
            )}
            {session?.existing_samples > 0 && (
              <p className="mt-3 text-xs text-muted">{session.existing_samples} samples already stored. New ones are added to them.</p>
            )}
            <p className="mt-auto pt-4 text-xs leading-relaxed text-muted">
              One person in view, face well lit and unobstructed. Move slightly between captures — identical frames are skipped.
            </p>
          </div>
        </div>
      )}

      {duplicate && (
        <div className="mt-5 rounded-md border border-late/40 bg-late-50 p-4 text-sm" role="alert">
          <p className="font-semibold text-late">This face looks like someone already registered</p>
          <p className="mt-1 text-[#2b3545]">
            It matches <b>{duplicate.existing_name || duplicate.existing_person_id}</b> ({duplicate.existing_person_id}) with
            similarity {duplicate.similarity}. Registering the same person twice causes wrong attendance.
          </p>
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => setDuplicate(null)}>Keep capturing</Button>
            <Button size="sm" variant="danger" loading={saving} onClick={() => save(true)}>They are different people — save anyway</Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
