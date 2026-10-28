import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Camera, CameraOff, Check, FlipHorizontal2, Info, RefreshCw, SwitchCamera, TriangleAlert } from 'lucide-react'
import { api, getToken, liveSocketUrl } from '../lib/api'
import { fmtTime, initials } from '../lib/format'
import { useCamera } from '../hooks/useCamera'
import { useToast } from '../context/ToastContext'
import { Badge, Button, StatusBadge } from '../components/ui'

const MIN_FRAME_GAP_MS = 120     // caps upload at ~8 fps; real rate is limited by server speed
// Send native 720p: the detector resizes to 640 internally, but quality checks (min face size)
// and ArcFace alignment use frame pixels - downscaling here makes distant faces fail.
const FRAME_WIDTH = 1280
const COLORS = { confirmed: '#3ccf87', marked: '#3ccf87', verifying: '#9db8f5', unknown: '#ff6b62', low_quality: '#f2b84b' }

function FaceMarker({ face, frameW, mirrored, marked, minVotes }) {
  const [x1, y1, x2, y2] = face.bbox
  const x = mirrored ? frameW - x2 : x1
  const w = x2 - x1
  const h = y2 - y1
  const state = marked ? 'marked' : face.state
  const color = COLORS[state] || COLORS.verifying
  const unit = frameW / 900
  const c = Math.min(w, h) * 0.22
  const sw = 3 * unit
  const title = state === 'unknown' ? 'Unknown'
    : face.state === 'confirmed' ? face.full_name
    : state === 'low_quality' ? 'Adjust position' : 'Verifying…'
  const sub = state === 'marked' ? marked
    : face.state === 'confirmed' ? face.person_id
    : state === 'low_quality' ? (face.hint || 'Face not clear enough')
    : state === 'unknown' ? 'Not registered'
    : `Checking ${Math.min(face.votes, minVotes)}/${minVotes}`
  const fs = 15 * unit
  const labelW = Math.max(w, (Math.max(title.length, sub.length) * fs * 0.56) + 20 * unit)
  const labelH = fs * 2.7
  const ly = y1 - labelH - 6 * unit > 0 ? y1 - labelH - 6 * unit : y2 + 6 * unit
  return (
    <g>
      <path d={`M${x} ${y1 + c}V${y1}H${x + c} M${x + w - c} ${y1}H${x + w}V${y1 + c} M${x + w} ${y2 - c}V${y2}H${x + w - c} M${x + c} ${y2}H${x}V${y2 - c}`}
            fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" />
      <rect x={x} y={y1} width={w} height={h} fill={color} opacity={state === 'marked' ? 0.12 : 0.04} />
      <g transform={`translate(${x} ${ly})`}>
        <rect width={labelW} height={labelH} rx={6 * unit} fill="#0d1830" opacity="0.88" />
        <rect width={4 * unit} height={labelH} rx={2 * unit} fill={color} />
        <text x={12 * unit} y={fs * 1.15} fill="#fff" fontSize={fs} fontWeight="600" fontFamily="Public Sans, system-ui">{title}</text>
        <text x={12 * unit} y={fs * 2.25} fill={color} fontSize={fs * 0.82} fontFamily="Public Sans, system-ui">{sub}</text>
      </g>
    </g>
  )
}

export default function LiveRecognition() {
  const toast = useToast()
  const cam = useCamera({ width: 1280, height: 720 })
  const [wsState, setWsState] = useState('idle')     // idle | connecting | ready | error
  const [wsError, setWsError] = useState(null)
  const [result, setResult] = useState(null)
  const [mirrorPref, setMirrorPref] = useState(null)
  const [roll, setRoll] = useState([])
  const [today, setToday] = useState(null)
  const [freshIds, setFreshIds] = useState(() => new Set())
  const [markedLabels, setMarkedLabels] = useState({})   // person_id -> label shown on the box
  const wsRef = useRef(null)
  const inflight = useRef(false)
  const lastSent = useRef(0)
  const userClosed = useRef(false)
  const lastInfo = useRef({})
  const camRef = useRef(cam)
  camRef.current = cam

  const mirrored = mirrorPref ?? cam.facing === 'user'

  const loadRoll = useCallback(async () => {
    try {
      const sys = await api.get('/api/system')
      setToday(sys.attendance.today)
      const res = await api.get('/api/attendance', { date_from: sys.attendance.today, date_to: sys.attendance.today, page_size: 200 })
      setRoll(res.items)
    } catch { /* roll is secondary; camera still works */ }
  }, [])
  useEffect(() => { loadRoll() }, [loadRoll])

  const sendNext = useCallback(async () => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN || inflight.current) return
    const wait = MIN_FRAME_GAP_MS - (performance.now() - lastSent.current)
    if (wait > 0) { setTimeout(sendNext, wait); return }
    inflight.current = true
    const blob = await camRef.current.capture(FRAME_WIDTH, 0.82)
    if (!blob || ws.readyState !== WebSocket.OPEN) {
      inflight.current = false
      setTimeout(sendNext, 250)
      return
    }
    lastSent.current = performance.now()
    ws.send(blob)
  }, [])

  const handleEvents = useCallback((events) => {
    for (const ev of events) {
      if (ev.type === 'attendance_marked') {
        const r = ev.record
        setRoll((prev) => [r, ...prev.filter((x) => x.id !== r.id)])
        setFreshIds((s) => new Set(s).add(r.id))
        setMarkedLabels((m) => ({ ...m, [r.person_id]: `Marked ${r.status} · ${fmtTime(r.time)}` }))
        toast.success(`${r.full_name} marked ${r.status}`, `${r.person_id} at ${fmtTime(r.time)}`)
      } else if (ev.type === 'already_marked') {
        const r = ev.record
        setMarkedLabels((m) => ({ ...m, [r.person_id]: `Already marked · ${fmtTime(r.time)}` }))
        const now = Date.now()
        if (!lastInfo.current[r.person_id] || now - lastInfo.current[r.person_id] > 60000) {
          lastInfo.current[r.person_id] = now
          toast.info(`${r.full_name} is already marked today`, `Recorded at ${fmtTime(r.time)}`)
        }
      } else if (ev.type === 'attendance_error') {
        toast.error('Attendance not saved', `${ev.full_name || ev.person_id}: ${ev.message}`)
      }
    }
  }, [toast])

  const connect = useCallback(() => {
    wsRef.current?.close()
    userClosed.current = false
    inflight.current = false
    setWsError(null)
    setWsState('connecting')
    const ws = new WebSocket(liveSocketUrl())
    ws.binaryType = 'arraybuffer'
    wsRef.current = ws
    ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token: getToken() }))
    ws.onmessage = (e) => {
      if (wsRef.current !== ws) return
      const msg = JSON.parse(e.data)
      if (msg.type === 'ready') { setWsState('ready'); sendNext() }
      else if (msg.type === 'result') {
        inflight.current = false
        setResult(msg)
        if (msg.events.length) handleEvents(msg.events)
        sendNext()
      } else if (msg.type === 'frame_error') { inflight.current = false; sendNext() }
      else if (msg.type === 'error') { setWsError(msg.detail) }
      else if (msg.type === 'reset_ok') { setResult(null) }
    }
    ws.onclose = (e) => {
      if (wsRef.current !== ws) return
      inflight.current = false
      if (userClosed.current) { setWsState('idle'); return }
      setWsState('error')
      setWsError((prev) => prev || (e.code === 1006 ? 'Lost connection to the recognition server.' : 'The recognition connection closed.'))
    }
  }, [sendNext, handleEvents])

  const start = async () => {
    setResult(null)
    await cam.start(cam.deviceId)
  }
  const stop = useCallback(() => {
    userClosed.current = true
    wsRef.current?.close()
    wsRef.current = null
    camRef.current.stop()
    setResult(null)
    setWsState('idle')
  }, [])

  // Connect once the camera is live; drop the connection if the camera stops.
  useEffect(() => {
    if (cam.status === 'live' && wsState === 'idle') connect()
    if (cam.status === 'error' && wsRef.current) { userClosed.current = true; wsRef.current.close(); wsRef.current = null; setWsState('idle') }
  }, [cam.status]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { userClosed.current = true; wsRef.current?.close() }, [])

  const switchCamera = () => {
    cam.switchCamera()
    setMirrorPref(null)
    wsRef.current?.readyState === WebSocket.OPEN && wsRef.current.send(JSON.stringify({ type: 'reset' }))
  }

  const live = cam.status === 'live'
  const faces = live && result ? result.faces : []
  const frameW = result?.frame?.[0] || 640
  const frameH = result?.frame?.[1] || 360
  const minVotes = result?.stats?.min_votes || 4

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-3">
        <div className="relative aspect-video overflow-hidden rounded-xl bg-ink shadow-panel">
          <video ref={cam.videoRef} muted playsInline autoPlay
                 className={`h-full w-full object-contain ${mirrored ? '-scale-x-100' : ''} ${live ? '' : 'invisible'}`} />
          {live && result && (
            <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${frameW} ${frameH}`} preserveAspectRatio="xMidYMid meet" aria-hidden>
              {faces.map((f) => (
                <FaceMarker key={f.track_id} face={f} frameW={frameW} mirrored={mirrored} minVotes={minVotes}
                            marked={f.state === 'confirmed' ? markedLabels[f.person_id] : null} />
              ))}
            </svg>
          )}

          {!live && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center text-white">
              {cam.status === 'error' ? (
                <>
                  <TriangleAlert className="h-9 w-9 text-[#f2b84b]" aria-hidden />
                  <p className="max-w-md text-sm leading-relaxed text-white/90">{cam.error}</p>
                  <Button variant="secondary" icon={RefreshCw} onClick={start}>Try again</Button>
                </>
              ) : cam.status === 'starting' ? (
                <p className="text-sm text-white/80">Waiting for camera permission…</p>
              ) : (
                <>
                  <Camera className="h-10 w-10 text-ink-300" aria-hidden />
                  <div>
                    <p className="text-lg font-semibold">Camera is off</p>
                    <p className="mt-1 text-sm text-ink-300">Start the camera to recognise faces and mark attendance automatically.</p>
                  </div>
                  <Button size="lg" icon={Camera} onClick={start}>Start camera</Button>
                </>
              )}
            </div>
          )}

          {live && wsState !== 'ready' && (
            <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-center justify-center gap-3 bg-ink/85 px-4 py-3 text-sm text-white">
              {wsState === 'connecting' && <span>Connecting to the recognition server…</span>}
              {wsState === 'error' && (
                <>
                  <span>{wsError}</span>
                  <Button size="sm" variant="secondary" icon={RefreshCw} onClick={connect}>Reconnect</Button>
                </>
              )}
            </div>
          )}
          {live && wsState === 'ready' && (
            <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-ink/75 px-3 py-1 text-xs font-medium text-white">
              <span className="h-2 w-2 animate-pulse rounded-full bg-[#3ccf87]" /> Recognising
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {live ? <Button variant="danger" icon={CameraOff} onClick={stop}>Stop camera</Button>
            : <Button icon={Camera} onClick={start} loading={cam.status === 'starting'}>Start camera</Button>}
          {cam.devices.length > 1 && <Button variant="secondary" icon={SwitchCamera} onClick={switchCamera} disabled={!live}>Switch camera</Button>}
          {cam.devices.length > 1 && (
            <select className="field h-10 w-auto max-w-[220px]" value={cam.deviceId || ''} disabled={!live} aria-label="Camera"
                    onChange={(e) => { cam.start(e.target.value); setMirrorPref(null) }}>
              {cam.devices.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>)}
            </select>
          )}
          <Button variant="ghost" icon={FlipHorizontal2} onClick={() => setMirrorPref(!mirrored)} aria-pressed={mirrored}>
            {mirrored ? 'Mirrored' : 'Not mirrored'}
          </Button>
          {live && result && (
            <span className="tabular ml-auto text-sm text-muted">
              {faces.length} face{faces.length === 1 ? '' : 's'} · {result.stats.latency_ms} ms · {result.stats.gallery_size} registered
            </span>
          )}
        </div>

        <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted">
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: COLORS.confirmed }} />Recognised</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: COLORS.verifying }} />Verifying</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: COLORS.unknown }} />Unknown — not marked</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: COLORS.low_quality }} />Face unclear</span>
        </div>
        {result && result.stats.gallery_size === 0 && (
          <div className="flex items-start gap-2 rounded-md bg-late-50 px-4 py-3 text-sm text-late">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <span>No faces are registered yet, so everyone shows as Unknown. <Link to="/people" className="font-medium underline">Register faces</Link> first.</span>
          </div>
        )}
        <p className="flex items-start gap-2 text-xs leading-relaxed text-muted">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          A person is marked only after {minVotes} consistent matches, once per day. Liveness is not checked, so supervise the camera — a printed photo of a registered person could be accepted.
        </p>
      </div>

      <aside className="rounded-xl bg-white shadow-panel xl:sticky xl:top-24 xl:max-h-[calc(100vh-8rem)] xl:overflow-hidden xl:flex xl:flex-col">
        <header className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <div>
            <h2 className="text-[15px] font-semibold">Today’s roll call</h2>
            {today && <p className="text-xs text-muted">{today}</p>}
          </div>
          <Badge tone="brand"><span className="tabular">{roll.length}</span>&nbsp;marked</Badge>
        </header>
        {roll.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted">No one marked yet today. Names appear here as they are recognised.</p>
        ) : (
          <ol className="divide-y divide-line overflow-y-auto">
            {roll.map((r) => (
              <li key={r.id} className={`flex items-center gap-3 px-5 py-2.5 ${freshIds.has(r.id) ? 'animate-row' : ''}`}>
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-present-50 text-present">
                  {freshIds.has(r.id) ? <Check className="h-4 w-4" strokeWidth={3} /> : <span className="text-[11px] font-semibold">{initials(r.full_name)}</span>}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{r.full_name}</p>
                  <p className="truncate text-xs text-muted">{r.person_id}{r.method === 'manual' ? ' · manual' : ''}</p>
                </div>
                <div className="text-right">
                  <p className="tabular text-sm">{fmtTime(r.time)}</p>
                  <StatusBadge status={r.status} />
                </div>
              </li>
            ))}
          </ol>
        )}
      </aside>
    </div>
  )
}
