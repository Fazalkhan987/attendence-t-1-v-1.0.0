"""Students/employees: CRUD, face registration and face-data reset."""
from __future__ import annotations

import re
from typing import Literal

from fastapi import APIRouter, File, Form, Request, UploadFile
from pydantic import BaseModel, Field, field_validator

from faceattend.services.registration import remove_files
from faceattend.storage.database import Person
from faceattend.validation import clean_optional, validate_name, validate_person_id

from ..auth import Admin, AdminDep
from ..errors import ApiError
from ..imaging import decode_image

router = APIRouter(prefix="/api/persons", tags=["persons"])
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_PHONE = re.compile(r"^[0-9+()\-\s]{5,20}$")


def _email(v: str | None) -> str | None:
    v = (v or "").strip()
    if v and (len(v) > 120 or not _EMAIL.match(v)):
        raise ValueError("enter a valid email address")
    return v or None


def _phone(v: str | None) -> str | None:
    v = (v or "").strip()
    if v and not _PHONE.match(v):
        raise ValueError("use 5-20 digits, spaces, +, - or brackets")
    return v or None


class PersonIn(BaseModel):
    person_id: str = Field(..., max_length=64)
    full_name: str = Field(..., max_length=120)
    person_type: Literal["student", "employee"] = "student"
    department: str | None = Field(None, max_length=120)
    class_name: str | None = Field(None, max_length=120)
    email: str | None = None
    phone: str | None = None

    @field_validator("email")
    @classmethod
    def _check_email(cls, v: str | None) -> str | None:
        return _email(v)

    @field_validator("phone")
    @classmethod
    def _check_phone(cls, v: str | None) -> str | None:
        return _phone(v)


class PersonPatch(BaseModel):
    full_name: str | None = Field(None, max_length=120)
    person_type: Literal["student", "employee"] | None = None
    department: str | None = Field(None, max_length=120)
    class_name: str | None = Field(None, max_length=120)
    email: str | None = None
    phone: str | None = None

    # None = leave unchanged, "" = clear the value.
    @field_validator("email")
    @classmethod
    def _check_email(cls, v: str | None) -> str | None:
        return None if v is None else (_email(v) or "")

    @field_validator("phone")
    @classmethod
    def _check_phone(cls, v: str | None) -> str | None:
        return None if v is None else (_phone(v) or "")


class CommitIn(BaseModel):
    force: bool = False


def person_out(p: Person, today: dict | None = None) -> dict:
    md = p.metadata or {}
    return {
        "person_id": p.person_id, "full_name": p.full_name,
        "person_type": md.get("type", "student"),
        "department": p.department, "class_name": p.class_name,
        "email": md.get("email"), "phone": md.get("phone"),
        "face_samples": p.sample_count, "face_registered": p.sample_count > 0,
        "registered_at": p.registered_at, "updated_at": p.updated_at,
        "today": today,
    }


@router.get("")
def list_persons(request: Request, search: str | None = None, person_type: str | None = None,
                 face: str | None = None, _: Admin = AdminDep):
    ctx = request.app.state.ctx
    statuses = ctx.attendance.statuses_on(ctx.clock.today())
    items = []
    q = (search or "").strip().lower()
    for p in ctx.repo.list_persons():
        out = person_out(p, statuses.get(p.person_id))
        if person_type in ("student", "employee") and out["person_type"] != person_type:
            continue
        if face == "registered" and not out["face_registered"]:
            continue
        if face == "pending" and out["face_registered"]:
            continue
        if q and not any(q in (out[k] or "").lower() for k in
                         ("person_id", "full_name", "department", "class_name", "email", "phone")):
            continue
        items.append(out)
    items.sort(key=lambda x: x["full_name"].lower())
    return {"items": items, "total": len(items)}


@router.post("", status_code=201)
def create_person(request: Request, body: PersonIn, admin: Admin = AdminDep):
    ctx = request.app.state.ctx
    pid = validate_person_id(body.person_id)
    if ctx.repo.person_exists(pid):
        raise ApiError(409, f"ID '{pid}' is already in use. Choose a different ID.", "duplicate_id")
    md = {"type": body.person_type, "email": body.email, "phone": body.phone}
    ctx.repo.create_person_with_samples(
        pid, validate_name(body.full_name), clean_optional(body.department, "department"),
        clean_optional(body.class_name, "class"), {k: v for k, v in md.items() if v},
        ctx.engine.model_name if ctx.engine else "", [])
    ctx.repo.audit("web_person_created", pid, f"by={admin.username}")
    ctx.reload_gallery()   # refresh the id -> name map used for live labels
    return person_out(ctx.repo.get_person(pid))


@router.get("/{person_id}")
def get_person(request: Request, person_id: str, _: Admin = AdminDep):
    ctx = request.app.state.ctx
    p = ctx.persons.get(person_id)
    return person_out(p, ctx.attendance.statuses_on(ctx.clock.today()).get(p.person_id))


@router.patch("/{person_id}")
def update_person(request: Request, person_id: str, body: PersonPatch, admin: Admin = AdminDep):
    ctx = request.app.state.ctx
    p = ctx.persons.get(person_id)
    fields: dict = {}
    if body.full_name is not None:
        fields["full_name"] = validate_name(body.full_name)
    if body.department is not None:
        fields["department"] = clean_optional(body.department, "department")
    if body.class_name is not None:
        fields["class_name"] = clean_optional(body.class_name, "class")
    md = dict(p.metadata or {})
    for key, val in (("type", body.person_type), ("email", body.email), ("phone", body.phone)):
        if val is not None:
            if val:
                md[key] = val
            else:
                md.pop(key, None)
    if md != (p.metadata or {}):
        fields["metadata"] = md
    if fields:
        ctx.repo.update_person(p.person_id, **fields)
        ctx.reload_gallery()
    return person_out(ctx.repo.get_person(p.person_id))


@router.delete("/{person_id}", status_code=204)
def delete_person(request: Request, person_id: str, admin: Admin = AdminDep):
    ctx = request.app.state.ctx
    ctx.enrollment.cancel_person(person_id)
    ctx.persons.delete(person_id)   # record + embeddings + crops (+ attendance via FK cascade)
    ctx.repo.audit("web_person_deleted", person_id, f"by={admin.username}")
    ctx.reload_gallery()


@router.delete("/{person_id}/faces", status_code=204)
def reset_faces(request: Request, person_id: str, admin: Admin = AdminDep):
    """Delete every stored face embedding for this person; the record and attendance stay."""
    ctx = request.app.state.ctx
    p = ctx.persons.get(person_id)
    ctx.enrollment.cancel_person(p.person_id)
    with ctx.repo.transaction() as c:
        crops = [r["crop_path"] for r in c.execute(
            "SELECT crop_path FROM face_samples WHERE person_id=? AND crop_path IS NOT NULL", (p.person_id,))]
        c.execute("DELETE FROM face_samples WHERE person_id=?", (p.person_id,))
        ctx.repo.audit("web_faces_reset", p.person_id, f"by={admin.username}", conn=c)
    remove_files(crops)
    ctx.reload_gallery()


# ---------- face registration ----------
@router.post("/{person_id}/enrollment")
def start_enrollment(request: Request, person_id: str, _: Admin = AdminDep):
    return request.app.state.ctx.enrollment.start(validate_person_id(person_id))


@router.post("/{person_id}/enrollment/{session_id}/frames")
def enrollment_frame(request: Request, person_id: str, session_id: str,
                     file: UploadFile = File(...), source: str = Form("webcam"), _: Admin = AdminDep):
    image = decode_image(file.file.read())
    src = "upload" if source == "upload" else "webcam"
    return request.app.state.ctx.enrollment.add_frame(validate_person_id(person_id), session_id, image, src)


@router.post("/{person_id}/enrollment/{session_id}/commit")
def commit_enrollment(request: Request, person_id: str, session_id: str, body: CommitIn,
                      admin: Admin = AdminDep):
    ctx = request.app.state.ctx
    res = ctx.enrollment.commit(validate_person_id(person_id), session_id, force=body.force)
    ctx.repo.audit("web_faces_registered", person_id, f"by={admin.username} samples={res['stored_samples']}")
    return res


@router.delete("/{person_id}/enrollment/{session_id}", status_code=204)
def cancel_enrollment(request: Request, person_id: str, session_id: str, _: Admin = AdminDep):
    request.app.state.ctx.enrollment.cancel(person_id, session_id)
