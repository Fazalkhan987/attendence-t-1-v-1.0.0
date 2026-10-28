"""End-to-end API workflow with the engine's own fake detector/embedder (no model download).

Covers: login/logout, person CRUD + duplicate ID, webcam-style enrollment session,
duplicate-face protection, live WebSocket recognition -> automatic attendance with
same-day de-duplication, unknown faces, history filters, CSV export, manual marking.
"""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import cv2
import pytest
from fastapi.testclient import TestClient

from faceattend.config import AppConfig, QualityConfig
from faceattend.services.engine import FaceEngine

from app.main import create_app
from app.settings import Settings

_ENGINE_TESTS = Path(__file__).resolve().parents[2] / "face_attendance" / "tests" / "conftest.py"
_spec = importlib.util.spec_from_file_location("engine_fakes", _ENGINE_TESTS)
fakes = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(fakes)

PASSWORD = "Test-Password-123"


def png(identity: int, n_faces: int = 1, variant: int = 0) -> bytes:
    ok, buf = cv2.imencode(".png", fakes.make_image(identity, n_faces, variant))  # lossless: keeps fake encoding
    assert ok
    return buf.tobytes()


@pytest.fixture
def client(tmp_path, monkeypatch):
    cfg = AppConfig()
    cfg.storage.db_path = str(tmp_path / "data" / "test.db")
    cfg.storage.crops_dir = str(tmp_path / "crops")
    cfg.enrollment.min_samples = 3
    cfg.enrollment.target_samples = 5
    cfg.enrollment_quality = QualityConfig(min_face_size=50, min_det_score=0.5, min_blur_variance=1.0,
                                           min_brightness=10, max_brightness=250, min_contrast=1)
    cfg.recognition_quality = QualityConfig(min_face_size=40, min_det_score=0.5, min_blur_variance=1.0,
                                            min_brightness=10, max_brightness=250, min_contrast=1)
    monkeypatch.setattr("app.context.load_config", lambda _p=None: cfg)
    settings = Settings(engine_root=tmp_path, admin_username="admin", admin_password=PASSWORD,
                        timezone="Asia/Karachi", late_after=None, frontend_dist=tmp_path / "none")
    settings.load_engine = False
    app = create_app(settings, engine_factory=lambda _cfg: FaceEngine(fakes.FakeDetector(), fakes.FakeEmbedder()))
    with TestClient(app) as c:
        c.app.state.ctx.load_engine()   # synchronous for tests
        yield c


def login(c: TestClient) -> dict:
    r = c.post("/api/auth/login", json={"username": "admin", "password": PASSWORD})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def enroll(c: TestClient, h: dict, pid: str, identity: int, force: bool = False):
    s = c.post(f"/api/persons/{pid}/enrollment", headers=h).json()
    for v in range(5):
        r = c.post(f"/api/persons/{pid}/enrollment/{s['session_id']}/frames", headers=h,
                   files={"file": ("f.png", png(identity, variant=v + 1), "image/png")})
        assert r.status_code == 200, r.text
    return c.post(f"/api/persons/{pid}/enrollment/{s['session_id']}/commit", headers=h, json={"force": force})


def test_auth(client):
    assert client.get("/api/dashboard").status_code == 401
    bad = client.post("/api/auth/login", json={"username": "admin", "password": "wrong-password"})
    assert bad.status_code == 401 and bad.json()["detail"] == "Incorrect username or password"
    h = login(client)
    assert client.get("/api/auth/me", headers=h).json()["username"] == "admin"
    assert client.post("/api/auth/logout", headers=h).status_code == 204
    assert client.get("/api/auth/me", headers=h).status_code == 401


def test_full_workflow(client):
    h = login(client)
    # --- people ---
    r = client.post("/api/persons", headers=h, json={"person_id": "S001", "full_name": "Ayesha Malik",
                                                     "person_type": "student", "department": "CS",
                                                     "class_name": "BSCS-7A", "email": "ayesha@example.com"})
    assert r.status_code == 201, r.text
    assert r.json()["face_registered"] is False
    dup = client.post("/api/persons", headers=h, json={"person_id": "S001", "full_name": "Someone"})
    assert dup.status_code == 409 and dup.json()["code"] == "duplicate_id"
    bad = client.post("/api/persons", headers=h, json={"person_id": "E1", "full_name": "X", "email": "nope"})
    assert bad.status_code == 422
    client.post("/api/persons", headers=h, json={"person_id": "E001", "full_name": "Bilal Ahmed",
                                                 "person_type": "employee", "department": "Admin"})
    client.post("/api/persons", headers=h, json={"person_id": "S002", "full_name": "Copy Cat"})

    # --- face registration ---
    res = enroll(client, h, "S001", identity=50)
    assert res.status_code == 200, res.text
    assert res.json()["total_samples"] >= 3
    assert enroll(client, h, "E001", identity=120).status_code == 200
    # Same face for a different person is blocked unless confirmed.
    clash = enroll(client, h, "S002", identity=50)
    assert clash.status_code == 409 and clash.json()["existing_person_id"] == "S001"

    # Rejected frame (two faces) gives a readable reason.
    s = client.post("/api/persons/S002/enrollment", headers=h).json()
    r = client.post(f"/api/persons/S002/enrollment/{s['session_id']}/frames", headers=h,
                    files={"file": ("f.png", png(7, n_faces=2), "image/png")}).json()
    assert r["accepted_frame"] is False and "one person" in r["message"]

    lst = client.get("/api/persons?face=registered", headers=h).json()
    assert {p["person_id"] for p in lst["items"]} == {"S001", "E001"}

    # --- live recognition over WebSocket ---
    token = h["Authorization"].split()[1]
    with client.websocket_connect("/ws/live") as ws:
        ws.send_text(json.dumps({"type": "auth", "token": token}))
        ready = ws.receive_json()
        assert ready["type"] == "ready"
        events = []
        for i in range(8):
            ws.send_bytes(png(50, variant=100 + i))
            msg = ws.receive_json()
            assert msg["type"] == "result"
            events += msg["events"]
        assert msg["faces"][0]["state"] == "confirmed" and msg["faces"][0]["person_id"] == "S001"
        assert [e["type"] for e in events] == ["attendance_marked"]
        assert events[0]["record"]["method"] == "face"

        ws.send_text(json.dumps({"type": "reset"}))
        assert ws.receive_json()["type"] == "reset_ok"
        again = []
        for i in range(8):   # same person again on the same day -> no duplicate row
            ws.send_bytes(png(50, variant=150 + i))
            again += ws.receive_json()["events"]
        assert [e["type"] for e in again] == ["already_marked"]

        ws.send_text(json.dumps({"type": "reset"}))
        ws.receive_json()
        unknown_events = []
        for i in range(8):   # never-registered face
            ws.send_bytes(png(222, variant=200 + i))
            msg = ws.receive_json()
            unknown_events += msg["events"]
        assert msg["faces"][0]["state"] == "unknown" and unknown_events == []

    with client.websocket_connect("/ws/live") as ws:   # bad token is refused
        ws.send_text(json.dumps({"type": "auth", "token": "nope"}))
        assert ws.receive_json()["code"] == "unauthorized"

    # --- attendance history, manual marking, export ---
    hist = client.get("/api/attendance", headers=h).json()
    assert hist["total"] == 1 and hist["items"][0]["person_id"] == "S001"
    m = client.post("/api/attendance", headers=h, json={"person_id": "E001"})
    assert m.status_code == 201 and m.json()["method"] == "manual"
    assert client.post("/api/attendance", headers=h, json={"person_id": "E001"}).status_code == 409
    assert client.get("/api/attendance?person_type=employee", headers=h).json()["total"] == 1
    assert client.get("/api/attendance?search=ayesha", headers=h).json()["total"] == 1
    assert client.get("/api/attendance?date_from=2099-01-01", headers=h).json()["total"] == 0
    csv_r = client.get("/api/attendance/export", headers=h)
    assert csv_r.status_code == 200 and "Ayesha Malik" in csv_r.text
    absent = client.get("/api/attendance/absent", headers=h).json()
    assert [a["person_id"] for a in absent["items"]] == ["S002"]

    dash = client.get("/api/dashboard", headers=h).json()
    assert dash["people"]["total"] == 3 and dash["today"]["marked"] == 2 and dash["today"]["absent"] == 1

    # --- edit, reset faces, delete ---
    up = client.patch("/api/persons/S001", headers=h, json={"full_name": "Ayesha R. Malik", "phone": "+92 300 1234567"})
    assert up.json()["full_name"] == "Ayesha R. Malik" and up.json()["phone"] == "+92 300 1234567"
    assert client.delete("/api/persons/S001/faces", headers=h).status_code == 204
    assert client.get("/api/persons/S001", headers=h).json()["face_samples"] == 0
    rec_id = client.get("/api/attendance?search=E001", headers=h).json()["items"][0]["id"]
    assert client.delete(f"/api/attendance/{rec_id}", headers=h).status_code == 204
    assert client.delete("/api/persons/S001", headers=h).status_code == 204
    assert client.get("/api/persons/S001", headers=h).status_code == 404
    assert client.get("/api/attendance", headers=h).json()["total"] == 0   # cascade
