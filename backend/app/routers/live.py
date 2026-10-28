"""WebSocket live recognition.

Protocol
  client -> {"type": "auth", "token": "..."}          (first message; token never goes in the URL)
  server -> {"type": "ready", ...} | {"type": "error"} + close 4401/4503
  client -> <binary JPEG frame>                         (send the next one after each result)
  server -> {"type": "result", "faces": [...], "events": [...], "stats": {...}}
  client -> {"type": "reset"}                           (clear tracks, e.g. after switching camera)
"""
from __future__ import annotations

import asyncio
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from faceattend.exceptions import FaceAttendError

from ..errors import ApiError
from ..imaging import decode_image
from ..live import LiveSession

router = APIRouter()
log = logging.getLogger(__name__)


@router.websocket("/ws/live")
async def live_ws(ws: WebSocket):
    ctx = ws.app.state.ctx
    await ws.accept()
    try:
        first = await asyncio.wait_for(ws.receive_text(), timeout=10)
        token = json.loads(first).get("token") if first else None
        admin = ctx.auth.resolve(token)
    except (asyncio.TimeoutError, ValueError, ApiError, AttributeError):
        await ws.send_json({"type": "error", "code": "unauthorized", "detail": "Sign in again to use the camera"})
        await ws.close(code=4401)
        return
    except WebSocketDisconnect:
        return
    try:
        ctx.require_engine()
    except FaceAttendError as exc:
        await ws.send_json({"type": "error", "code": "engine_unavailable", "detail": str(exc)})
        await ws.close(code=4503)
        return

    session = LiveSession(ctx, admin.username)
    await ws.send_json({"type": "ready", "engine": ctx.engine_info(), "min_votes": session.min_votes})
    try:
        while True:
            msg = await ws.receive()
            if msg.get("type") == "websocket.disconnect":
                break
            if msg.get("bytes") is not None:
                try:
                    frame = decode_image(msg["bytes"])
                    result = await asyncio.to_thread(session.process, frame)
                except FaceAttendError as exc:
                    result = {"type": "frame_error", "detail": str(exc)}
                await ws.send_json(result)
            elif msg.get("text"):
                try:
                    data = json.loads(msg["text"])
                except ValueError:
                    continue
                if data.get("type") == "reset":
                    session.reset()
                    await ws.send_json({"type": "reset_ok"})
                elif data.get("type") == "ping":
                    await ws.send_json({"type": "pong"})
    except WebSocketDisconnect:
        pass
    except Exception:  # noqa: BLE001
        log.exception("Live session crashed")
        try:
            await ws.close(code=1011)
        except RuntimeError:
            pass
