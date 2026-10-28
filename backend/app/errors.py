"""Map engine exceptions to consistent JSON errors: {"detail": str, "code": str, ...}."""
from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from faceattend.exceptions import (AuthError, DuplicateIdentityError, DuplicatePersonError,
                                   EnrollmentError, FaceAttendError, InvalidImageError,
                                   ModelLoadError, PersonNotFoundError, ValidationError)

log = logging.getLogger(__name__)


class EngineUnavailable(FaceAttendError):
    """The recognition models are still loading or failed to load."""


class ApiError(Exception):
    def __init__(self, status: int, detail: str, code: str = "error", **extra):
        self.status, self.detail, self.code, self.extra = status, detail, code, extra


_MAP: list[tuple[type[Exception], int, str]] = [
    (DuplicateIdentityError, 409, "duplicate_face"),
    (DuplicatePersonError, 409, "duplicate_id"),
    (PersonNotFoundError, 404, "not_found"),
    (ValidationError, 422, "invalid_input"),
    (EnrollmentError, 422, "enrollment_failed"),
    (InvalidImageError, 400, "invalid_image"),
    (AuthError, 401, "unauthorized"),
    (EngineUnavailable, 503, "engine_unavailable"),
    (ModelLoadError, 503, "engine_unavailable"),
]


def _body(detail: str, code: str, **extra) -> dict:
    return {"detail": detail, "code": code, **extra}


def install_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api(_: Request, exc: ApiError):
        return JSONResponse(_body(exc.detail, exc.code, **exc.extra), status_code=exc.status)

    @app.exception_handler(FaceAttendError)
    async def _engine(_: Request, exc: FaceAttendError):
        for cls, status, code in _MAP:
            if isinstance(exc, cls):
                extra = {}
                if isinstance(exc, DuplicateIdentityError):
                    extra = {"existing_person_id": exc.existing_person_id,
                             "similarity": round(exc.similarity, 3)}
                return JSONResponse(_body(str(exc), code, **extra), status_code=status)
        log.exception("Unhandled engine error")
        return JSONResponse(_body(str(exc), "engine_error"), status_code=500)

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError):
        errors = exc.errors()
        first = errors[0] if errors else {}
        field = ".".join(str(p) for p in first.get("loc", []) if p not in ("body", "query", "path"))
        msg = first.get("msg", "Invalid request").removeprefix("Value error, ")
        return JSONResponse(_body(f"{field}: {msg}" if field else msg, "invalid_input"), status_code=422)

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, exc: StarletteHTTPException):
        detail = exc.detail if isinstance(exc.detail, str) else "Request failed"
        return JSONResponse(_body(detail, "http_error"), status_code=exc.status_code,
                            headers=getattr(exc, "headers", None))
