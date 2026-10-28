"""Per-connection live recognition: detection -> IoU tracking -> recognition -> vote smoothing
-> attendance. Reuses the engine's FaceTracker/TrackState exactly as `faceattend live` does;
only the frame source (browser WebSocket instead of cv2.VideoCapture) and the
on-confirmed action (attendance) differ.
"""
from __future__ import annotations

import logging
import time
from typing import TYPE_CHECKING, Any

import numpy as np

from faceattend.camera.tracker import FaceTracker, TrackState

from .enrollment import friendly

if TYPE_CHECKING:
    from .context import AppContext

log = logging.getLogger(__name__)


class LiveSession:
    def __init__(self, ctx: "AppContext", operator: str):
        self.ctx = ctx
        self.operator = operator
        lv = ctx.cfg.live
        window = ctx.settings.live_window or lv.smoothing_window
        self.min_votes = min(ctx.settings.live_min_votes or lv.min_votes, window)
        self.tracker = FaceTracker(lv.track_iou_threshold, lv.track_max_missed, window)
        # Browser frames arrive at ~5-10 fps (vs ~30 from a local camera), so recognise
        # every frame we receive instead of every Nth.
        self.recognize_every = 1
        self.frames = 0

    def reset(self) -> None:
        lv = self.ctx.cfg.live
        self.tracker = FaceTracker(lv.track_iou_threshold, lv.track_max_missed, self.tracker.window)

    def process(self, frame: np.ndarray) -> dict[str, Any]:
        engine, recognition, _ = self.ctx.require_engine()
        t0 = time.perf_counter()
        self.frames += 1
        with self.ctx.infer_lock:
            faces = engine.detect(frame)
            tracks = self.tracker.update(faces)
            due = [t for t in tracks if t.frames_since_recognition >= self.recognize_every]
            if due:
                for t, rec in zip(due, recognition.recognize_faces(frame, [t.face for t in due])):
                    t.add(rec.result)
        out_faces, events = [], []
        for t in tracks:
            d = t.decide(self.min_votes)
            hint = None
            if d.state == TrackState.LOW_QUALITY and t.last_result and t.last_result.quality_reasons:
                hint = friendly(t.last_result.quality_reasons[0])
            if d.state == TrackState.CONFIRMED and t.confirmed_person != d.person_id:
                t.confirmed_person = d.person_id
                events.append(self._on_confirmed(d.person_id, d.full_name, d.similarity))
            out_faces.append({
                "track_id": t.track_id,
                "bbox": [round(float(v), 1) for v in t.face.bbox],
                "det_score": round(float(t.face.score), 3),
                "state": d.state.value,
                "person_id": d.person_id,
                "full_name": d.full_name,
                "similarity": None if d.similarity is None else round(float(d.similarity), 3),
                "votes": len(t.history),
                "hint": hint,
            })
        h, w = frame.shape[:2]
        return {"type": "result", "frame": [w, h], "faces": out_faces, "events": events,
                "stats": {"latency_ms": round((time.perf_counter() - t0) * 1000),
                          "gallery_size": recognition.gallery_size, "min_votes": self.min_votes}}

    def _on_confirmed(self, person_id: str, full_name: str | None, similarity: float) -> dict[str, Any]:
        try:
            record, created = self.ctx.attendance.mark(
                person_id, "face", similarity=float(similarity), marked_by=f"camera:{self.operator}")
        except Exception:  # noqa: BLE001 - person deleted mid-session, DB issue, etc.
            log.exception("Could not record attendance for %s", person_id)
            return {"type": "attendance_error", "person_id": person_id, "full_name": full_name,
                    "message": "Recognised, but attendance could not be saved"}
        return {"type": "attendance_marked" if created else "already_marked", "record": record}
