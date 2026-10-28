import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarCheck, ScanFace, UserPlus, Users } from 'lucide-react'
import { api } from '../lib/api'
import { fmtDay, fmtLongDate, fmtTime, initials } from '../lib/format'
import { Badge, Button, EmptyState, ErrorNote, Panel, Spinner, StatusBadge } from '../components/ui'

function Stat({ label, value, sub, tone }) {
  const tones = { present: 'text-present', late: 'text-late', absent: 'text-danger', default: 'text-[#1b2433]' }
  return (
    <div className="rounded-lg bg-white px-5 py-4 shadow-panel">
      <p className="text-sm text-muted">{label}</p>
      <p className={`tabular mt-1.5 text-3xl font-semibold tracking-tight ${tones[tone || 'default']}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-muted">{sub}</p>}
    </div>
  )
}

function TodayBar({ today }) {
  const { expected, present, late, absent } = today
  const seg = (n) => (expected ? `${(100 * n) / expected}%` : '0%')
  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full bg-paper ring-1 ring-inset ring-line" role="img"
           aria-label={`${present} present, ${late} late, ${absent} absent of ${expected}`}>
        <div className="bg-present" style={{ width: seg(present) }} />
        <div className="bg-late" style={{ width: seg(late) }} />
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-present" />Present <b className="tabular">{present}</b></span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-late" />Late <b className="tabular">{late}</b></span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-line" />Not yet marked <b className="tabular">{absent}</b></span>
      </div>
    </div>
  )
}

function WeekChart({ trend, expected }) {
  const max = Math.max(1, expected, ...trend.map((d) => d.count))
  return (
    <div className="flex h-44 items-end gap-2 sm:gap-3" role="img" aria-label="Attendance for the last 7 days">
      {trend.map((d, i) => {
        const isToday = i === trend.length - 1
        return (
          <div key={d.date} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5">
            <span className="tabular text-xs font-medium text-muted">{d.count}</span>
            <div className={`w-full max-w-[44px] rounded-t ${isToday ? 'bg-brand' : 'bg-brand-100'}`}
                 style={{ height: `${Math.max(2, (100 * d.count) / max)}%` }} title={`${d.date}: ${d.count}`} />
            <span className={`text-xs ${isToday ? 'font-semibold text-[#1b2433]' : 'text-muted'}`}>{isToday ? 'Today' : fmtDay(d.date)}</span>
          </div>
        )
      })}
    </div>
  )
}

export default function Dashboard() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    try {
      setError(null)
      setData(await api.get('/api/dashboard'))
    } catch (err) { setError(err.message) }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 20000)
    return () => clearInterval(t)
  }, [load])

  if (error && !data) return <ErrorNote onRetry={load}>{error}</ErrorNote>
  if (!data) return <Spinner label="Loading dashboard" />
  const { people, today, trend, recent, engine } = data

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted">{fmtLongDate(data.date)}</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight">
            {today.marked} of {today.expected} marked today
          </p>
        </div>
        <div className="flex gap-2">
          <Link to="/people?new=1"><Button variant="secondary" icon={UserPlus}>Add person</Button></Link>
          <Link to="/live"><Button icon={ScanFace}>Open live camera</Button></Link>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="People registered" value={people.total} sub={`${people.students} students · ${people.employees} employees`} />
        <Stat label="Present today" value={today.present + today.late} tone="present"
              sub={`${today.rate}% attendance${today.late ? ` · ${today.late} late` : ''}`} />
        <Stat label="Not marked yet" value={today.absent} tone={today.absent ? 'absent' : 'default'} sub="Counted as absent at day end" />
        <Stat label="Faces still to register" value={people.without_face} tone={people.without_face ? 'late' : 'default'}
              sub={`${people.with_face} people can be recognised`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Panel title="Today" className="lg:col-span-2">
          {today.expected ? <TodayBar today={today} /> : (
            <EmptyState icon={Users} title="No one registered yet" action={<Link to="/people?new=1"><Button size="sm">Add the first person</Button></Link>}>
              Add students or employees, then register their faces.
            </EmptyState>
          )}
          <div className="mt-6 border-t border-line pt-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted">Recognition engine</span>
              {engine.status === 'ready' ? <Badge tone="present" dot>Ready</Badge>
                : engine.status === 'loading' ? <Badge tone="brand" dot>Loading</Badge> : <Badge tone="absent" dot>Unavailable</Badge>}
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-muted">Faces in recognition gallery</span>
              <span className="tabular font-medium">{engine.gallery_size}</span>
            </div>
          </div>
        </Panel>
        <Panel title="Last 7 days" className="lg:col-span-3"><WeekChart trend={trend} expected={today.expected} /></Panel>
      </div>

      <Panel title="Recent attendance" bodyClass="p-0"
             action={<Link to="/attendance" className="text-sm font-medium text-brand hover:underline">View all</Link>}>
        {recent.length === 0 ? (
          <EmptyState icon={CalendarCheck} title="No attendance recorded yet">
            Open the live camera and people with registered faces will be marked automatically.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {recent.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-5 py-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand">
                  {initials(r.full_name)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{r.full_name}</p>
                  <p className="truncate text-xs text-muted">{r.person_id}{r.department ? ` · ${r.department}` : ''}</p>
                </div>
                <div className="text-right">
                  <p className="tabular text-sm">{fmtTime(r.time)}</p>
                  <p className="text-xs text-muted">{r.date === data.date ? 'Today' : r.date}</p>
                </div>
                <div className="hidden w-20 justify-end sm:flex"><StatusBadge status={r.status} /></div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}
