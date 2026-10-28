import { useCallback, useEffect, useState } from 'react'
import { CalendarCheck, CalendarPlus, Download, Search, Trash2, UserX } from 'lucide-react'
import { api, downloadFile } from '../lib/api'
import { fmtDate, fmtTime, titleCase } from '../lib/format'
import { useToast } from '../context/ToastContext'
import { Badge, Button, ConfirmDialog, EmptyState, ErrorNote, Field, IconButton, Modal, Pagination, Panel, Segmented, Spinner, StatusBadge } from '../components/ui'

const localToday = () => {
  const d = new Date()
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}
const daysAgo = (n) => {
  const d = new Date(); d.setDate(d.getDate() - n)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

function ManualMarkModal({ open, onClose, onSaved, prefill }) {
  const toast = useToast()
  const [people, setPeople] = useState([])
  const [form, setForm] = useState({ person_id: '', date: localToday(), time: '', status: '' })
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setError(null)
    setForm({ person_id: prefill?.person_id || '', date: prefill?.date || localToday(), time: '', status: '' })
    api.get('/api/persons').then((r) => setPeople(r.items)).catch((e) => setError(e.message))
  }, [open, prefill])

  const submit = async (e) => {
    e.preventDefault()
    if (!form.person_id) { setError('Choose a person'); return }
    setSaving(true)
    setError(null)
    try {
      const body = { person_id: form.person_id, date: form.date || null, time: form.time ? `${form.time}:00` : null, status: form.status || null }
      const r = await api.post('/api/attendance', body)
      toast.success(`Marked ${r.status}`, `${r.full_name} on ${fmtDate(r.date)} at ${fmtTime(r.time)}`)
      onSaved()
    } catch (err) { setError(err.message) } finally { setSaving(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title="Mark attendance manually" size="sm" dismissable={!saving}
      footer={<>
        <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button type="submit" form="mark-form" loading={saving}>Mark attendance</Button>
      </>}>
      <form id="mark-form" onSubmit={submit} className="space-y-4">
        {error && <ErrorNote>{error}</ErrorNote>}
        <Field label="Person">
          <select className="field" value={form.person_id} onChange={(e) => setForm({ ...form, person_id: e.target.value })}>
            <option value="">Choose a person…</option>
            {people.map((p) => <option key={p.person_id} value={p.person_id}>{p.full_name} ({p.person_id})</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date"><input type="date" className="field" max={localToday()} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
          <Field label="Time" hint="Empty = now"><input type="time" className="field" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} /></Field>
        </div>
        <Field label="Status" hint="Automatic uses the late cut-off time">
          <select className="field" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            <option value="">Automatic</option>
            <option value="present">Present</option>
            <option value="late">Late</option>
          </select>
        </Field>
      </form>
    </Modal>
  )
}

export default function Attendance() {
  const toast = useToast()
  const [view, setView] = useState('records')
  const [filters, setFilters] = useState({ date_from: daysAgo(6), date_to: localToday(), search: '', person_type: '', status: '', method: '' })
  const [query, setQuery] = useState(filters)
  const [page, setPage] = useState(1)
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [marking, setMarking] = useState(null)       // null closed, {} open, {person_id,date} prefilled
  const [deleting, setDeleting] = useState(null)
  const [busy, setBusy] = useState(false)
  const [absentDate, setAbsentDate] = useState(localToday())
  const [absent, setAbsent] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try { setData(await api.get('/api/attendance', { ...query, page, page_size: 25 })) }
    catch (err) { setError(err.message) }
    finally { setLoading(false) }
  }, [query, page])

  const loadAbsent = useCallback(async () => {
    setError(null)
    try { setAbsent(await api.get('/api/attendance/absent', { date: absentDate })) }
    catch (err) { setError(err.message) }
  }, [absentDate])

  useEffect(() => { if (view === 'records') load() }, [view, load])
  useEffect(() => { if (view === 'absent') loadAbsent() }, [view, loadAbsent])

  // Debounce the search box; dates and selects apply immediately.
  useEffect(() => {
    if (JSON.stringify(filters) === JSON.stringify(query)) return
    if (filters.date_from && filters.date_to && filters.date_from > filters.date_to) return
    const t = setTimeout(() => { setPage(1); setQuery(filters) }, filters.search !== query.search ? 300 : 0)
    return () => clearTimeout(t)
  }, [filters]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }))
  const preset = (from, to) => setFilters((f) => ({ ...f, date_from: from, date_to: to }))
  const dateError = filters.date_from && filters.date_to && filters.date_from > filters.date_to

  const exportCsv = async () => {
    setExporting(true)
    try { await downloadFile('/api/attendance/export', query, 'attendance.csv') }
    catch (err) { toast.error('Export failed', err.message) }
    finally { setExporting(false) }
  }

  const remove = async () => {
    setBusy(true)
    try {
      await api.del(`/api/attendance/${deleting.id}`)
      toast.success('Record deleted', `${deleting.full_name}, ${fmtDate(deleting.date)}`)
      setDeleting(null)
      load()
    } catch (err) { toast.error('Delete failed', err.message) } finally { setBusy(false) }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented value={view} onChange={setView} label="View"
                   options={[{ value: 'records', label: 'Records' }, { value: 'absent', label: 'Absentees' }]} />
        <div className="flex gap-2">
          {view === 'records' && <Button variant="secondary" icon={Download} loading={exporting} onClick={exportCsv} disabled={!data?.total || dateError}>Export CSV</Button>}
          <Button icon={CalendarPlus} onClick={() => setMarking({})}>Mark manually</Button>
        </div>
      </div>

      {view === 'records' ? (
        <Panel bodyClass="p-0">
          <div className="space-y-3 border-b border-line p-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[150px_150px_1fr_140px_130px_130px]">
              <Field label="From"><input type="date" className={`field ${dateError ? 'field-error' : ''}`} value={filters.date_from} max={localToday()} onChange={set('date_from')} /></Field>
              <Field label="To"><input type="date" className={`field ${dateError ? 'field-error' : ''}`} value={filters.date_to} max={localToday()} onChange={set('date_to')} /></Field>
              <Field label="Search">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
                  <input className="field pl-9" placeholder="Name, ID, department or class" value={filters.search} onChange={set('search')} />
                </div>
              </Field>
              <Field label="Type">
                <select className="field" value={filters.person_type} onChange={set('person_type')}>
                  <option value="">All</option><option value="student">Students</option><option value="employee">Employees</option>
                </select>
              </Field>
              <Field label="Status">
                <select className="field" value={filters.status} onChange={set('status')}>
                  <option value="">All</option><option value="present">Present</option><option value="late">Late</option>
                </select>
              </Field>
              <Field label="Method">
                <select className="field" value={filters.method} onChange={set('method')}>
                  <option value="">All</option><option value="face">Face</option><option value="manual">Manual</option>
                </select>
              </Field>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted">Quick range:</span>
              <button className="rounded px-2 py-1 font-medium text-brand hover:bg-brand-50" onClick={() => preset(localToday(), localToday())}>Today</button>
              <button className="rounded px-2 py-1 font-medium text-brand hover:bg-brand-50" onClick={() => preset(daysAgo(6), localToday())}>Last 7 days</button>
              <button className="rounded px-2 py-1 font-medium text-brand hover:bg-brand-50" onClick={() => preset(daysAgo(29), localToday())}>Last 30 days</button>
              <button className="rounded px-2 py-1 font-medium text-brand hover:bg-brand-50" onClick={() => preset('', '')}>All time</button>
              {dateError && <span className="text-danger">The start date must be on or before the end date.</span>}
            </div>
          </div>

          {error ? <div className="p-4"><ErrorNote onRetry={load}>{error}</ErrorNote></div>
            : !data ? <Spinner label="Loading attendance" />
            : data.items.length === 0 ? (
              <EmptyState icon={CalendarCheck} title="No attendance in this range">
                Change the dates or filters, or open the live camera to start marking.
              </EmptyState>
            ) : (
              <>
                <div className={`overflow-x-auto transition-opacity ${loading ? 'opacity-60' : ''}`}>
                  <table className="min-w-full">
                    <thead className="bg-paper/60">
                      <tr>
                        <th className="th">Date</th><th className="th">Time</th><th className="th">Person</th>
                        <th className="th">Department / class</th><th className="th">Status</th><th className="th">Method</th>
                        <th className="th">Match</th><th className="th"><span className="sr-only">Actions</span></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {data.items.map((r) => (
                        <tr key={r.id} className="hover:bg-paper/50">
                          <td className="td tabular">{fmtDate(r.date)}</td>
                          <td className="td tabular">{fmtTime(r.time)}</td>
                          <td className="td"><p className="font-medium">{r.full_name}</p><p className="tabular text-xs text-muted">{r.person_id} · {titleCase(r.person_type)}</p></td>
                          <td className="td"><p>{r.department || '—'}</p><p className="text-xs text-muted">{r.class_name || ''}</p></td>
                          <td className="td"><StatusBadge status={r.status} /></td>
                          <td className="td">{r.method === 'face' ? <Badge tone="brand">Face</Badge> : <Badge>Manual · {r.marked_by}</Badge>}</td>
                          <td className="td tabular text-muted">{r.similarity ?? '—'}</td>
                          <td className="td text-right"><IconButton icon={Trash2} label="Delete record" tone="danger" onClick={() => setDeleting(r)} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pagination page={data.page} pageSize={data.page_size} total={data.total} onPage={setPage} />
              </>
            )}
        </Panel>
      ) : (
        <Panel bodyClass="p-0">
          <div className="flex flex-wrap items-end gap-3 border-b border-line p-4">
            <Field label="Date"><input type="date" className="field" value={absentDate} max={localToday()} onChange={(e) => setAbsentDate(e.target.value)} /></Field>
            {absent && <p className="pb-2 text-sm text-muted"><b className="tabular text-[#1b2433]">{absent.total}</b> not marked on {fmtDate(absent.date)}</p>}
          </div>
          {error ? <div className="p-4"><ErrorNote onRetry={loadAbsent}>{error}</ErrorNote></div>
            : !absent ? <Spinner />
            : absent.items.length === 0 ? <EmptyState icon={UserX} title="Everyone is marked">No absentees for this date.</EmptyState>
            : (
              <ul className="divide-y divide-line">
                {absent.items.map((p) => (
                  <li key={p.person_id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{p.full_name}</p>
                      <p className="text-xs text-muted">{p.person_id} · {titleCase(p.person_type)}{p.department ? ` · ${p.department}` : ''}{p.class_name ? ` · ${p.class_name}` : ''}</p>
                    </div>
                    <StatusBadge status="absent" />
                    <Button size="sm" variant="secondary" icon={CalendarPlus} onClick={() => setMarking({ person_id: p.person_id, date: absent.date })}>Mark present</Button>
                  </li>
                ))}
              </ul>
            )}
        </Panel>
      )}

      <ManualMarkModal open={Boolean(marking)} prefill={marking} onClose={() => setMarking(null)}
                       onSaved={() => { setMarking(null); view === 'records' ? load() : loadAbsent() }} />
      <ConfirmDialog open={Boolean(deleting)} title="Delete attendance record?" confirmLabel="Delete record" loading={busy}
                     onClose={() => !busy && setDeleting(null)} onConfirm={remove}>
        {deleting && <>Remove <b>{deleting.full_name}</b>’s record for {fmtDate(deleting.date)} at {fmtTime(deleting.time)}? They will count as absent for that day.</>}
      </ConfirmDialog>
    </div>
  )
}
