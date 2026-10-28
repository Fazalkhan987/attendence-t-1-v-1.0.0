"""Server-side face enrollment sessions for browser-based registration.

Flow: start session -> post frames (webcam or uploaded photos) -> each frame is screened by
the engine's own RegistrationService.screen_image() (exactly one face, strict quality) and
held IN MEMORY -> commit runs the engine's duplicate-identity check and add_samples().
Nothing biometric is written until commit; abandoned sessions expire after 10 minutes.
"""
from __future__ import annotations

import logging
import secrets
import threading
import time
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

import numpy as np

from faceattend.services.registration import EnrollmentSample

from .errors import ApiError

if TYPE_CHECKING:
    from .context import AppContext

log = logging.getLogger(__name__)
SESSION_TTL_S = 600
PROMPTS = ["Look straight at the camera", "Turn your head slightly left", "Turn your head slightly right",
           "Lift your chin slightly", "Lower your chin slightly", "Keep a neutral expression",
           "Smile", "Look straight again"]

_REASON_HINTS = {
    "no face detected": "No face found - face the camera in good light",
    "face too small": "Move closer to the camera",
    "image blurry": "Hold still - the image is blurry",
    "too dark": "Too dark - add more light in front of you",
    "overexposed": "Too bright - avoid strong light behind or on the face",
    "face turned sideways": "Turn back towards the camera a little",
    "head tilted": "Keep your head level",
    "face tilted up/down": "Look more directly at the camera",
    "low contrast": "Improve the lighting on your face",
}


def friendly(reason: str) -> str:
    for key, hint in _REASON_HINTS.items():
        if key in reason:
            return hint
    if "faces detected" in reason:
        return "Only one person should be in view"
    return reason[:1].upper() + reason[1:]


@dataclass
class EnrollmentSession:
    id: str
    person_id: str
    existing_samples: int
    samples: list[EnrollmentSample] = field(default_factory=list)
    rejected: int = 0
    frames: int = 0
    last_activity: float = field(default_factory=time.monotonic)


class EnrollmentManager:
    def __init__(self, ctx: "AppContext"):
        self.ctx = ctx
        self._sessions: dict[str, EnrollmentSession] = {}
        self._lock = threading.Lock()

    def _expire(self) -> None:
        now = time.monotonic()
        for sid in [k for k, s in self._sessions.items() if now - s.last_activity > SESSION_TTL_S]:
            self._sessions.pop(sid, None)

    def _get(self, person_id: str, session_id: str) -> EnrollmentSession:
        with self._lock:
            self._expire()
            s = self._sessions.get(session_id)
        if s is None or s.person_id != person_id:
            raise ApiError(404, "Face capture session expired. Start the capture again.", "session_not_found")
        s.last_activity = time.monotonic()
        return s

    def _targets(self, existing: int) -> dict[str, int]:
        e = self.ctx.cfg.enrollment
        room = max(e.max_samples_per_person - existing, 0)
        minimum = e.min_samples if existing == 0 else 1
        return {"min": min(minimum, room), "target": min(e.target_samples, room), "room": room}

    def state(self, s: EnrollmentSession) -> dict[str, Any]:
        t = self._targets(s.existing_samples)
        return {"session_id": s.id, "person_id": s.person_id, "accepted": len(s.samples),
                "rejected": s.rejected, "min_samples": t["min"], "target_samples": t["target"],
                "existing_samples": s.existing_samples,
                "can_commit": len(s.samples) >= max(t["min"], 1),
                "prompt": PROMPTS[len(s.samples) % len(PROMPTS)]}

    def start(self, person_id: str) -> dict[str, Any]:
        self.ctx.require_engine()
        person = self.ctx.repo.get_person(person_id)
        if self._targets(person.sample_count)["room"] <= 0:
            raise ApiError(422, f"{person_id} already has the maximum number of face samples. "
                                "Reset face data to register again.", "enrollment_full")
        s = EnrollmentSession(secrets.token_hex(12), person.person_id, person.sample_count)
        with self._lock:
            self._expire()
            for sid in [k for k, v in self._sessions.items() if v.person_id == person.person_id]:
                self._sessions.pop(sid)   # one active capture per person
            self._sessions[s.id] = s
        return self.state(s)

    def add_frame(self, person_id: str, session_id: str, image: np.ndarray, source: str) -> dict[str, Any]:
        _, _, registration = self.ctx.require_engine()
        s = self._get(person_id, session_id)
        t = self._targets(s.existing_samples)
        if len(s.samples) >= t["target"]:
            return {**self.state(s), "accepted_frame": False, "message": "Enough samples captured - save to finish",
                    "bbox": None}
        s.frames += 1
        with self.ctx.infer_lock:
            faces = registration.engine.detect(image)
            out = registration.screen_image(image, f"{source}:{s.frames}")
        bbox = [round(float(v), 1) for v in faces[0].bbox] if len(faces) == 1 else None
        h, w = image.shape[:2]
        if isinstance(out, EnrollmentSample):
            near = registration.cfg.near_duplicate_threshold
            if any(float(x.embedding @ out.embedding) >= near for x in s.samples):
                s.rejected += 1
                return {**self.state(s), "accepted_frame": False, "bbox": bbox, "frame": [w, h],
                        "message": "Move a little - this looks the same as the last capture"}
            s.samples.append(out)
            return {**self.state(s), "accepted_frame": True, "bbox": bbox, "frame": [w, h],
                    "message": f"Captured {len(s.samples)} of {t['target']}"}
        s.rejected += 1
        return {**self.state(s), "accepted_frame": False, "bbox": bbox, "frame": [w, h],
                "message": friendly(out.reason)}

    def commit(self, person_id: str, session_id: str, force: bool = False) -> dict[str, Any]:
        _, _, registration = self.ctx.require_engine()
        s = self._get(person_id, session_id)
        if not s.samples:
            raise ApiError(422, "No face samples captured yet", "enrollment_failed")
        person = self.ctx.repo.get_person(person_id)
        need = self._targets(person.sample_count)["min"]
        if len(s.samples) < need:
            raise ApiError(422, f"Only {len(s.samples)} usable sample(s) captured; at least {need} are needed. "
                                "Keep capturing with small head movements.", "enrollment_failed")
        with self.ctx.infer_lock:
            if person.sample_count == 0:
                dup = registration.find_duplicate_identity(
                    np.vstack([x.embedding for x in s.samples]), exclude=person.person_id)
                if dup and not force:
                    names = self.ctx.repo.names()
                    raise ApiError(409, f"This face closely matches {names.get(dup[0], dup[0])} ({dup[0]}), "
                                        f"similarity {dup[1]:.2f}. Confirm only if they are different people.",
                                   "duplicate_face", existing_person_id=dup[0],
                                   existing_name=names.get(dup[0]), similarity=round(dup[1], 3))
                if dup:
                    log.warning("Enrolling %s despite similarity %.3f to %s (confirmed by admin)",
                                person_id, dup[1], dup[0])
            result = registration.add_samples(person.person_id, s.samples)
        with self._lock:
            self._sessions.pop(s.id, None)
        self.ctx.reload_gallery()
        return {"person_id": person.person_id, "stored_samples": result.stored_samples,
                "total_samples": result.person.sample_count,
                "dropped": [{"source": d.source, "reason": d.reason} for d in result.dropped]}

    def cancel(self, person_id: str, session_id: str) -> None:
        with self._lock:
            s = self._sessions.get(session_id)
            if s and s.person_id == person_id:
                self._sessions.pop(session_id, None)

    def cancel_person(self, person_id: str) -> None:
        with self._lock:
            for sid in [k for k, v in self._sessions.items() if v.person_id == person_id]:
                self._sessions.pop(sid)
