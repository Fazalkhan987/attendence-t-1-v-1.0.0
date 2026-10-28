import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useToast } from '../context/ToastContext'
import { Button, ErrorNote, Field, Modal, Segmented } from './ui'

const EMPTY = { person_id: '', full_name: '', person_type: 'student', department: '', class_name: '', email: '', phone: '' }
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/

function validate(f, isEdit) {
  const e = {}
  if (!isEdit && !ID_RE.test(f.person_id.trim())) e.person_id = 'Use letters, digits, “_”, “-” or “.”, starting with a letter or digit'
  if (!f.full_name.trim()) e.full_name = 'Enter the full name'
  if (f.email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim())) e.email = 'Enter a valid email address'
  if (f.phone.trim() && !/^[0-9+()\-\s]{5,20}$/.test(f.phone.trim())) e.phone = 'Use 5–20 digits, spaces, +, - or brackets'
  return e
}

export default function PersonFormModal({ open, person, onClose, onSaved }) {
  const isEdit = Boolean(person)
  const toast = useToast()
  const [form, setForm] = useState(EMPTY)
  const [errors, setErrors] = useState({})
  const [serverError, setServerError] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setErrors({})
    setServerError(null)
    setForm(person ? Object.fromEntries(Object.keys(EMPTY).map((k) => [k, person[k] ?? ''])) : EMPTY)
  }, [open, person])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target ? e.target.value : e }))

  const submit = async (e) => {
    e.preventDefault()
    const v = validate(form, isEdit)
    setErrors(v)
    if (Object.keys(v).length) return
    setSaving(true)
    setServerError(null)
    const body = { ...form, person_id: form.person_id.trim() }
    try {
      let saved
      if (isEdit) {
        const { person_id, ...patch } = body
        saved = await api.patch(`/api/persons/${encodeURIComponent(person.person_id)}`, patch)
        toast.success('Changes saved', saved.full_name)
      } else {
        saved = await api.post('/api/persons', body)
        toast.success('Person added', `${saved.full_name} (${saved.person_id}). Register their face next.`)
      }
      onSaved(saved, !isEdit)
    } catch (err) {
      if (err.code === 'duplicate_id') setErrors({ person_id: err.message })
      else setServerError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const isEmployee = form.person_type === 'employee'
  return (
    <Modal open={open} onClose={onClose} title={isEdit ? `Edit ${person?.full_name}` : 'Add person'} dismissable={!saving}
      footer={<>
        <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button type="submit" form="person-form" loading={saving}>{isEdit ? 'Save changes' : 'Add person'}</Button>
      </>}>
      <form id="person-form" onSubmit={submit} className="space-y-4" noValidate>
        {serverError && <ErrorNote>{serverError}</ErrorNote>}
        <Field label="Type">
          <Segmented value={form.person_type} onChange={set('person_type')} label="Person type"
                     options={[{ value: 'student', label: 'Student' }, { value: 'employee', label: 'Employee' }]} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={isEmployee ? 'Employee ID' : 'Student ID'} error={errors.person_id}
                 hint={isEdit ? 'IDs cannot be changed' : 'Must be unique, e.g. S001 or EMP-104'}>
            <input className={`field ${errors.person_id ? 'field-error' : ''}`} value={form.person_id} onChange={set('person_id')}
                   disabled={isEdit} maxLength={64} autoComplete="off" />
          </Field>
          <Field label="Full name" error={errors.full_name}>
            <input className={`field ${errors.full_name ? 'field-error' : ''}`} value={form.full_name} onChange={set('full_name')} maxLength={120} />
          </Field>
          <Field label="Department">
            <input className="field" value={form.department} onChange={set('department')} maxLength={120}
                   placeholder={isEmployee ? 'e.g. Finance' : 'e.g. Computer Science'} />
          </Field>
          <Field label={isEmployee ? 'Designation' : 'Class / section'}>
            <input className="field" value={form.class_name} onChange={set('class_name')} maxLength={120}
                   placeholder={isEmployee ? 'e.g. Accountant' : 'e.g. BSCS-7A'} />
          </Field>
          <Field label="Email" error={errors.email}>
            <input className={`field ${errors.email ? 'field-error' : ''}`} type="email" value={form.email} onChange={set('email')} maxLength={120} />
          </Field>
          <Field label="Phone" error={errors.phone}>
            <input className={`field ${errors.phone ? 'field-error' : ''}`} type="tel" value={form.phone} onChange={set('phone')} maxLength={20} />
          </Field>
        </div>
      </form>
    </Modal>
  )
}
