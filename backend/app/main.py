"""FastAPI application: `uvicorn app.main:app --reload` from the backend folder."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .context import AppContext, EngineFactory
from .errors import install_handlers
from .routers import attendance, auth, dashboard, live, persons
from .settings import Settings

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-7s %(name)s: %(message)s")
for noisy in ("onnxruntime", "PIL", "multipart"):
    logging.getLogger(noisy).setLevel(logging.WARNING)


def create_app(settings: Settings | None = None, engine_factory: EngineFactory | None = None) -> FastAPI:
    settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        ctx = AppContext(settings, engine_factory)
        ctx.auth.ensure_initial_admin(settings.admin_username, settings.admin_password)
        app.state.ctx = ctx
        if settings.load_engine:
            ctx.load_engine_async()
        yield
        ctx.close()

    app = FastAPI(title="Smart Attendance API", version="1.0.0", lifespan=lifespan)
    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_credentials=False,
                       allow_methods=["*"], allow_headers=["Authorization", "Content-Type"])
    install_handlers(app)
    for r in (auth.router, dashboard.router, persons.router, attendance.router, live.router):
        app.include_router(r)

    # Serve the built React app (frontend/dist) from the same origin in production.
    dist = settings.frontend_dist
    if (dist / "index.html").is_file():
        app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

        @app.get("/{path:path}", include_in_schema=False)
        async def spa(path: str):
            file = (dist / path).resolve()
            if path and file.is_file() and dist.resolve() in file.parents:
                return FileResponse(file)
            return FileResponse(dist / "index.html")

    return app


app = create_app()
