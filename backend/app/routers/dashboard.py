from __future__ import annotations

from fastapi import APIRouter, Request

from ..auth import Admin, AdminDep

router = APIRouter(prefix="/api", tags=["dashboard"])


@router.get("/dashboard")
def dashboard(request: Request, _: Admin = AdminDep):
    ctx = request.app.state.ctx
    return {**ctx.attendance.dashboard(), "engine": ctx.engine_info()}


@router.get("/health")
def health(request: Request):
    ctx = request.app.state.ctx
    return {"status": "ok", "engine": ctx.engine_status}


@router.get("/system")
def system(request: Request, _: Admin = AdminDep):
    ctx = request.app.state.ctx
    cfg, s = ctx.cfg, ctx.settings
    return {
        "engine": ctx.engine_info(),
        "recognition": {"similarity_threshold": cfg.recognition.similarity_threshold,
                        "margin": cfg.recognition.margin, "strategy": cfg.recognition.match_strategy},
        "enrollment": {"min_samples": cfg.enrollment.min_samples,
                       "target_samples": cfg.enrollment.target_samples,
                       "max_samples": cfg.enrollment.max_samples_per_person},
        "live": {"min_votes": min(s.live_min_votes or cfg.live.min_votes,
                                  s.live_window or cfg.live.smoothing_window),
                 "window": s.live_window or cfg.live.smoothing_window},
        "attendance": {"timezone": ctx.clock.tz_name, "today": ctx.clock.today().isoformat(),
                       "late_after": s.late_after.strftime("%H:%M") if s.late_after else None},
    }


@router.post("/system/reload-engine", status_code=202)
def reload_engine(request: Request, _: Admin = AdminDep):
    ctx = request.app.state.ctx
    if ctx.engine_status != "loading":
        ctx.load_engine_async()
    return ctx.engine_info()
