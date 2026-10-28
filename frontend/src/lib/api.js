// Thin fetch wrapper: adds the bearer token, parses JSON, and turns failures into ApiError
// with the backend's human-readable "detail" message.
const TOKEN_KEY = 'sa_token'
const BASE = import.meta.env.VITE_API_BASE || ''

export class ApiError extends Error {
  constructor(message, status, data = {}) {
    super(message)
    this.status = status
    this.code = data.code
    this.data = data
  }
}

let onUnauthorized = () => {}
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn }

export const getToken = () => localStorage.getItem(TOKEN_KEY)
export const setToken = (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY))

async function request(method, path, { body, form, query, raw } = {}) {
  const url = new URL(BASE + path, window.location.origin)
  if (query) {
    Object.entries(query).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v)
    })
  }
  const headers = {}
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  let payload
  if (form) payload = form
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  let res
  try {
    res = await fetch(url, { method, headers, body: payload })
  } catch {
    throw new ApiError('Cannot reach the server. Check that the backend is running.', 0, { code: 'network' })
  }
  if (res.status === 401 && path !== '/api/auth/login') onUnauthorized()
  if (!res.ok) {
    let data = {}
    try { data = await res.json() } catch { /* not JSON */ }
    const fallback = res.status >= 500 ? 'The server hit an error. Check the backend log.' : `Request failed (${res.status})`
    throw new ApiError(data.detail || fallback, res.status, data)
  }
  if (raw) return res
  if (res.status === 204) return null
  return res.json()
}

export const api = {
  get: (p, query) => request('GET', p, { query }),
  post: (p, body) => request('POST', p, { body }),
  patch: (p, body) => request('PATCH', p, { body }),
  del: (p) => request('DELETE', p),
  upload: (p, form) => request('POST', p, { form }),
  raw: (p, query) => request('GET', p, { query, raw: true }),
}

export async function downloadFile(path, query, fallbackName) {
  const res = await api.raw(path, query)
  const blob = await res.blob()
  const cd = res.headers.get('Content-Disposition') || ''
  const name = /filename="([^"]+)"/.exec(cd)?.[1] || fallbackName
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export function liveSocketUrl() {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${window.location.host}/ws/live`
}
