"""Shared application context, built once at startup.

The face engine (InsightFace SCRFD + ArcFace) loads in a background thread so the API,
login and record management are usable immediately - even while models download on
the first run. Endpoints that need the models return 503 until it is ready.
"""
from __future__ import annotations

import logging
import threading
import time
from pathlib import Path
from typing import Callable

from faceattend.config import AppConfig, load_config
from faceattend.quality import QualityAssessor
from faceattend.services.engine import FaceEngine, build_engine
from faceattend.services.persons import PersonService
from faceattend.services.recognition import RecognitionService
from faceattend.services.registration import RegistrationService
from faceattend.storage.database import Repository

from .attendance import AttendanceService
from .auth import AuthService
from .db import WebStore
from .errors import EngineUnavailable
from .settings import Settings
from .timeutil import Clock

log = logging.getLogger(__name__)
EngineFactory = Callable[[AppConfig], FaceEngine]


def _resolve(root: Path, value: str) -> str:
    p = Path(value).expanduser()
    return str(p if p.is_absolute() else (root / p).resolve())


class AppContext:
    def __init__(self, settings: Settings, engine_factory: EngineFactory | None = None,
                 cfg: AppConfig | None = None):
        self.settings = settings
        self.cfg = cfg or load_config(settings.config_path if settings.config_path.exists() else None)
        # Relative storage paths in the YAML are relative to the engine project, so the web app
        # and the `faceattend` CLI share one database.
        root = settings.engine_root
        self.cfg.storage.db_path = _resolve(root, self.cfg.storage.db_path)
        self.cfg.storage.crops_dir = _resolve(root, self.cfg.storage.crops_dir)
        self.cfg.model.root = str(Path(self.cfg.model.root).expanduser())

        self.repo = Repository(self.cfg.storage.db_path)
        self.store = WebStore(self.repo, self.cfg.storage.db_path)
        self.clock = Clock(settings.timezone)
        self.auth = AuthService(self.store, settings.session_hours)
        self.attendance = AttendanceService(self.store, self.clock, settings.late_after)
        self.persons = PersonService(self.repo, self.cfg.storage.crops_dir)

        self._factory = engine_factory or build_engine
        self.engine: FaceEngine | None = None
        self.recognition: RecognitionService | None = None
        self.registration: RegistrationService | None = None
        self.engine_status = "not_loaded"      # not_loaded | loading | ready | error
        self.engine_error: str | None = None
        self.engine_load_seconds: float | None = None
        # One inference at a time: keeps CPU usage predictable and the models' sessions safe.
        self.infer_lock = threading.Lock()

        from .enrollment import EnrollmentManager   # local import avoids a cycle
        self.enrollment = EnrollmentManager(self)

    # ---------- engine ----------
    def load_engine(self) -> None:
        self.engine_status, self.engine_error = "loading", None
        start = time.perf_counter()
        try:
            engine = self._factory(self.cfg)
            self.registration = RegistrationService(
                engine, self.repo, self.cfg.enrollment, QualityAssessor(self.cfg.enrollment_quality),
                self.cfg.storage.crops_dir)
            self.recognition = RecognitionService(
                engine, self.repo, self.cfg.recognition, QualityAssessor(self.cfg.recognition_quality))
            self.engine = engine
            self.engine_load_seconds = round(time.perf_counter() - start, 1)
            self.engine_status = "ready"
            log.info("Face engine ready in %.1fs (gallery: %d)", self.engine_load_seconds,
                     self.recognition.gallery_size)
        except Exception as exc:  # noqa: BLE001 - surfaced to the UI
            self.engine_status, self.engine_error = "error", str(exc)
            log.exception("Face engine failed to load")

    def load_engine_async(self) -> None:
        threading.Thread(target=self.load_engine, name="engine-loader", daemon=True).start()

    def require_engine(self) -> tuple[FaceEngine, RecognitionService, RegistrationService]:
        if self.engine_status != "ready":
            msg = {"loading": "Face recognition models are still loading. Try again in a moment.",
                   "error": f"Face recognition engine failed to load: {self.engine_error}"}.get(
                self.engine_status, "Face recognition engine is not loaded.")
            raise EngineUnavailable(msg)
        return self.engine, self.recognition, self.registration

    def reload_gallery(self) -> None:
        if self.recognition is not None:
            self.recognition.reload_gallery()

    def engine_info(self) -> dict:
        return {
            "status": self.engine_status, "error": self.engine_error,
            "model": self.engine.model_name if self.engine else None,
            "gallery_size": self.recognition.gallery_size if self.recognition else 0,
            "load_seconds": self.engine_load_seconds,
            "liveness": "not_checked",
        }

    def close(self) -> None:
        self.store.close()
        self.repo.close()
