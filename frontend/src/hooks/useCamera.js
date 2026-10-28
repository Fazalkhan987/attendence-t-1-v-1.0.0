import { useCallback, useEffect, useRef, useState } from 'react'

function describe(err) {
  switch (err?.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return 'Camera access was blocked. Allow the camera in your browser’s site settings (the icon left of the address bar), then start the camera again.'
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No camera was found. Connect a webcam and try again.'
    case 'NotReadableError':
    case 'TrackStartError':
      return 'The camera is busy in another app (Zoom, Teams, another tab). Close it and try again.'
    case 'OverconstrainedError':
      return 'The selected camera does not support the requested resolution.'
    case 'SecurityError':
      return 'The browser blocked camera access on this page. Open the app over https or on localhost.'
    case 'AbortError':
      return 'The camera stopped while starting. Try again.'
    default:
      return err?.message || 'The camera could not be started.'
  }
}

/**
 * Browser webcam control. status: idle | starting | live | error
 * capture(maxWidth, quality) returns a JPEG Blob of the current frame (not mirrored).
 */
export function useCamera({ width = 1280, height = 720 } = {}) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const canvasRef = useRef(null)
  const genRef = useRef(0)        // invalidates a pending start when stop/start is called again
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState(null)
  const [devices, setDevices] = useState([])
  const [deviceId, setDeviceId] = useState(null)
  const [facing, setFacing] = useState('user')

  const supported = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia

  const stop = useCallback(() => {
    genRef.current += 1
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setStatus((s) => (s === 'error' ? s : 'idle'))
  }, [])

  const start = useCallback(async (id) => {
    if (!supported) {
      setError(window.isSecureContext
        ? 'This browser does not support camera access.'
        : 'Camera access needs a secure page. Open the app at http://localhost or over https.')
      setStatus('error')
      return
    }
    const gen = ++genRef.current
    streamRef.current?.getTracks().forEach((t) => t.stop())
    setStatus('starting')
    setError(null)
    const size = { width: { ideal: width }, height: { ideal: height } }
    const constraints = { audio: false, video: id ? { deviceId: { exact: id }, ...size } : { facingMode: 'user', ...size } }
    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints)
    } catch (err) {
      if (err?.name === 'OverconstrainedError') {
        try { stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: id ? { deviceId: id } : true }) }
        catch (err2) { if (gen === genRef.current) { setError(describe(err2)); setStatus('error') } return }
      } else { if (gen === genRef.current) { setError(describe(err)); setStatus('error') } return }
    }
    if (gen !== genRef.current) {   // stopped or restarted while waiting for permission
      stream.getTracks().forEach((t) => t.stop())
      return
    }
    streamRef.current = stream
    const track = stream.getVideoTracks()[0]
    const settings = track.getSettings?.() || {}
    setDeviceId(settings.deviceId || id || null)
    setFacing(settings.facingMode || (/(back|rear|environment)/i.test(track.label) ? 'environment' : 'user'))
    track.addEventListener('ended', () => {
      if (streamRef.current !== stream) return
      setError('The camera was disconnected.')
      setStatus('error')
    })
    const video = videoRef.current
    if (video) {
      video.srcObject = stream
      try { await video.play() } catch { /* autoplay with muted+playsInline normally succeeds */ }
    }
    try {
      const list = await navigator.mediaDevices.enumerateDevices()
      setDevices(list.filter((d) => d.kind === 'videoinput'))
    } catch { /* labels unavailable */ }
    setStatus('live')
  }, [supported, width, height])

  const switchCamera = useCallback(() => {
    if (devices.length < 2) return
    const idx = devices.findIndex((d) => d.deviceId === deviceId)
    start(devices[(idx + 1) % devices.length].deviceId)
  }, [devices, deviceId, start])

  const capture = useCallback((maxWidth = 960, quality = 0.85) => new Promise((resolve) => {
    const video = videoRef.current
    if (!video || !video.videoWidth || !streamRef.current) return resolve(null)
    const scale = Math.min(1, maxWidth / video.videoWidth)
    const w = Math.round(video.videoWidth * scale)
    const h = Math.round(video.videoHeight * scale)
    const canvas = canvasRef.current || (canvasRef.current = document.createElement('canvas'))
    canvas.width = w
    canvas.height = h
    canvas.getContext('2d').drawImage(video, 0, 0, w, h)
    canvas.toBlob((b) => resolve(b), 'image/jpeg', quality)
  }), [])

  useEffect(() => () => { genRef.current += 1; streamRef.current?.getTracks().forEach((t) => t.stop()) }, [])

  return { videoRef, status, error, devices, deviceId, facing, supported, start, stop, switchCamera, capture }
}
