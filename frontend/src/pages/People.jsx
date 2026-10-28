import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CalendarPlus, Eraser, Pencil, ScanFace, Search, Trash2, UserPlus, Users } from 'lucide-react'
import { api } from '../lib/api'
import { fmtTime, initials, titleCase } from '../lib/format'
import { useToast } from '../context/ToastContext'
import { Badge, Button, ConfirmDialog, EmptyState, ErrorNote, IconButton, Panel, Spinner, StatusBadge } from '../components/ui'
import PersonFormModal from '../components/PersonFormModal'
import FaceEnrollModal from '../components/FaceEnrollModal'

export default function People() {
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const [items, setItems] = useState(null)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [type, setType] = useState('')
  const [face, setFace] = useState('')
  const [editing, setEditing] = useState(undefined)     // undefined = closed, null = new, object = edit
  const [enrolling, setEnrolling] = useState(null)
  const [confirm, setConfirm] = useState(null)          // { kind: 'delete'|'reset'|'mark', person }
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setError(null)
      const res = await api.get('/api/persons')
      setItems(res.items)
    } catch (err) { setError(err.message) }
  }, [])
  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (params.get('new')) { setEditing(null); setParams({}, { replace: true }) }
  }, [params, setParams])

  const filtered = useMemo(() => {
    if (!items) return []
    const q = search.trim().toLowerCase()
    return items.filter((p) =>
      (!type || p.person_type === type) &&
      (!face || (face === 'registered' ? p.face_registered : !p.face_registered)) &&
      (!q || [p.person_id, p.full_name, p.department, p.class_name, p.email, p.phone]
        .some((v) => (v || '').toLowerCase().includes(q))))
  }, [items, search, type, face])

  const runConfirm = async () => {
    const { kind, person } = confirm
    const id = encodeURIComponent(person.person_id)
    setBusy(true)
    try {
      if (kind === 'delete') {
        await api.del(`/api/persons/${id}`)
        toast.success('Person deleted', `${person.full_name} and their face data were removed.`)
      } else if (kind === 'reset') {
        await api.del(`/api/persons/${id}/faces`)
        toast.success('Face data removed', `Register ${person.full_name}’s face again to enable recognition.`)
      } else {
        const r = await api.post('/api/attendance', { person_id: person.person_id })
        toast.success(`Marked ${r.status}`, `${person.full_name} at ${fmtTime(r.time)}`)
      }
      setConfirm(null)
      load()
    } catch (err) {
      toast.error('Action failed', err.message)
    } finally {
      setBusy(false)
    }
  }

  const onSaved = (saved, created) => {
    setEditing(undefined)
    load()
    if (created) setEnrolling(saved)
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {items ? `${items.length} people · ${items.filter((p) => !p.face_registered).length} without a registered face` : ' '}
        </p>
        <Button icon={UserPlus} onClick={() => setEditing(null)}>Add person</Button>
      </div>

      <Panel bodyClass="p-0">
        <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row">
          <label className="relative flex-1">
            <span className="sr-only">Search people</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
            <input className="field pl-9" placeholder="Search by name, ID, department, class, email or phone"
                   value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <select className="field sm:w-40" value={type} onChange={(e) => setType(e.target.value)} aria-label="Filter by type">
            <option value="">All types</option>
            <option value="student">Students</option>
            <option value="employee">Employees</option>
          </select>
          <select className="field sm:w-48" value={face} onChange={(e) => setFace(e.target.value)} aria-label="Filter by face status">
            <option value="">Any face status</option>
            <option value="registered">Face registered</option>
            <option value="pending">Face not registered</option>
          </select>
        </div>

        {error ? <div className="p-4"><ErrorNote onRetry={load}>{error}</ErrorNote></div>
          : !items ? <Spinner label="Loading people" />
          : items.length === 0 ? (
            <EmptyState icon={Users} title="No people yet" action={<Button icon={UserPlus} onClick={() => setEditing(null)}>Add person</Button>}>
              Add a student or employee, then register their face with the webcam.
            </EmptyState>
          ) : filtered.length === 0 ? (
            <EmptyState icon={Search} title="No matches">Try a different search or clear the filters.</EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead className="bg-paper/60">
                  <tr>
                    <th className="th">Person</th>
                    <th className="th">Type</th>
                    <th className="th">Department / class</th>
                    <th className="th">Contact</th>
                    <th className="th">Face</th>
                    <th className="th">Today</th>
                    <th className="th text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {filtered.map((p) => (
                    <tr key={p.person_id} className="hover:bg-paper/50">
                      <td className="td">
                        <div className="flex items-center gap-3">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand">
                            {initials(p.full_name)}
                          </span>
                          <div>
                            <p className="font-medium">{p.full_name}</p>
                            <p className="tabular text-xs text-muted">{p.person_id}</p>
                          </div>
                        </div>
                      </td>
                      <td className="td">{titleCase(p.person_type)}</td>
                      <td className="td">
                        <p>{p.department || '—'}</p>
                        <p className="text-xs text-muted">{p.class_name || ''}</p>
                      </td>
                      <td className="td">
                        <p className="max-w-[200px] truncate">{p.email || '—'}</p>
                        <p className="text-xs text-muted">{p.phone || ''}</p>
                      </td>
                      <td className="td">
                        {p.face_registered
                          ? <Badge tone="present" dot>Registered · {p.face_samples}</Badge>
                          : <button onClick={() => setEnrolling(p)} className="rounded-full focus-visible:outline-2"><Badge tone="late" dot>Not registered</Badge></button>}
                      </td>
                      <td className="td">
                        {p.today ? <span className="flex items-center gap-2"><StatusBadge status={p.today.status} /><span className="tabular text-xs text-muted">{fmtTime(p.today.time)}</span></span>
                          : <span className="text-xs text-muted">Not marked</span>}
                      </td>
                      <td className="td">
                        <div className="flex justify-end gap-0.5">
                          <IconButton icon={ScanFace} label={p.face_registered ? 'Add face samples' : 'Register face'} onClick={() => setEnrolling(p)} />
                          <IconButton icon={CalendarPlus} label="Mark present manually" disabled={Boolean(p.today)}
                                      className="disabled:opacity-30" onClick={() => setConfirm({ kind: 'mark', person: p })} />
                          <IconButton icon={Pencil} label="Edit" onClick={() => setEditing(p)} />
                          <IconButton icon={Eraser} label="Remove face data" disabled={!p.face_registered} className="disabled:opacity-30"
                                      onClick={() => setConfirm({ kind: 'reset', person: p })} />
                          <IconButton icon={Trash2} label="Delete" tone="danger" onClick={() => setConfirm({ kind: 'delete', person: p })} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </Panel>

      <PersonFormModal open={editing !== undefined} person={editing} onClose={() => setEditing(undefined)} onSaved={onSaved} />
      <FaceEnrollModal open={Boolean(enrolling)} person={enrolling} onClose={() => { setEnrolling(null); load() }}
                       onDone={() => { setEnrolling(null); load() }} />
      <ConfirmDialog open={Boolean(confirm)} loading={busy} onClose={() => !busy && setConfirm(null)} onConfirm={runConfirm}
        tone={confirm?.kind === 'mark' ? 'success' : 'danger'}
        title={{ delete: 'Delete person?', reset: 'Remove face data?', mark: 'Mark present manually?' }[confirm?.kind] || ''}
        confirmLabel={{ delete: 'Delete permanently', reset: 'Remove face data', mark: 'Mark present' }[confirm?.kind] || ''}>
        {confirm?.kind === 'delete' && <>This permanently deletes <b>{confirm.person.full_name}</b> ({confirm.person.person_id}), all stored face data and their attendance history. This cannot be undone.</>}
        {confirm?.kind === 'reset' && <>All {confirm.person.face_samples} face samples for <b>{confirm.person.full_name}</b> will be deleted and they will no longer be recognised. Their record and attendance history stay.</>}
        {confirm?.kind === 'mark' && <><b>{confirm.person.full_name}</b> will be marked for today at the current time, recorded as a manual entry.</>}
      </ConfirmDialog>
    </div>
  )
}
