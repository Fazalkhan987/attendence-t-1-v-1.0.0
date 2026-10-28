# Smart Attendance — React + FastAPI web app for the FaceAttend engine

```
smart-attendance/
├── face_attendance/   your engine (SCRFD + ArcFace via InsightFace) — unchanged
├── backend/           FastAPI: REST + WebSocket, auth, attendance
└── frontend/          React + Vite + Tailwind + lucide-react
```

The web app uses the SAME SQLite database as the `faceattend` CLI
(`face_attendance/data/faceattend.db`), so people registered from the CLI appear in the website.

## 1. Backend (Windows PowerShell)
```powershell
cd smart-attendance\backend
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip setuptools wheel
pip install -r requirements.txt
pip uninstall -y opencv-python-headless
pip install --force-reinstall --no-deps "opencv-python==4.10.0.84"
copy .env.example .env
uvicorn app.main:app --reload --port 8000
```
Linux/macOS: `python3.12 -m venv .venv && source .venv/bin/activate`, then the same pip commands, `cp .env.example .env`.

First start downloads the buffalo_l models (~280 MB) in the background; the UI shows a banner until ready.
`requirements.txt` pins numpy<2 together with compatible scipy/onnx/scikit-image (insightface otherwise pulls numpy-2-only versions).

## 2. Frontend (second terminal)
```powershell
cd smart-attendance\frontend
npm install
npm run dev
```
Open http://localhost:5173 — sign in with `admin` / `ADMIN_PASSWORD` from `backend/.env`, then change the password in Settings.

## 3. Production (single server)
```powershell
cd frontend; npm run build; cd ..\backend
uvicorn app.main:app --host 0.0.0.0 --port 8000
```
FastAPI serves `frontend/dist` itself → open http://<server>:8000. Browsers only allow the camera on
**https or localhost**, so put it behind HTTPS (Caddy/Nginx/Cloudflare) when used from other machines.

## Admin commands
```powershell
python -m app.manage create-admin --username ali --name "Ali Khan"
python -m app.manage reset-password --username admin
python -m app.manage list-admins
```

## Workflow
1. **People → Add person** (student/employee, unique ID, department/class, email, phone).
2. The **Register face** window opens: auto-captures a frame every 0.7 s, your engine's strict quality gate
   accepts/rejects each one with a hint ("Move closer", "Keep your head level"). Move slightly between captures.
   You can also upload photos. Matching an existing person's face is blocked unless you confirm.
3. **Live camera → Start camera**: faces get boxes (green recognised, blue verifying, red unknown, amber unclear).
   After `min_votes` consistent matches the person is marked for today — once per day. Unknown faces are never marked.
4. **Attendance**: date filters, search, type/status/method filters, CSV export, absentees, manual marking, delete.

## API (all under /api, bearer token)
| Method | Path | Purpose |
|---|---|---|
| POST | /auth/login, /auth/logout, /auth/password · GET /auth/me | session |
| GET | /dashboard, /system · POST /system/reload-engine | stats, engine info |
| GET/POST | /persons · GET/PATCH/DELETE /persons/{id} | people CRUD |
| DELETE | /persons/{id}/faces | remove face data |
| POST | /persons/{id}/enrollment → /{sid}/frames → /{sid}/commit | face registration |
| GET/POST | /attendance · GET /attendance/export, /attendance/absent · DELETE /attendance/{id} | records |
| WS | /ws/live | send `{"type":"auth","token":…}`, then binary JPEG frames |

Interactive docs: http://localhost:8000/docs

## Tests
```powershell
cd backend
pip install -r requirements-dev.txt
python -m pytest -q
```
Uses your engine's fake detector/embedder, so no models are needed. Also verified manually with the real
buffalo_l models: enrolled person recognised in a 6-person photo at 0.986 similarity, others stayed Unknown
(≤0.08), marked once, second pass returned "already marked", duplicate face blocked.

## Database
New tables in the same SQLite file: `admin_users`, `admin_sessions`, `attendance`
(`UNIQUE(person_id, date)`), versioned by the `web_schema_version` setting (`backend/app/db.py`).
For PostgreSQL/MySQL later, these tables map 1:1; the engine's `Repository` would need the same port.

## Known limits
- **No liveness check** (your engine's liveness module is a placeholder): a photo of a registered person can be accepted. Supervise the camera.
- CPU inference: ~1.4 s per frame with 6 faces on a slow shared CPU; typically much faster on a modern laptop, and GPU is supported via the YAML.
- Thresholds are uncalibrated starting points — run `faceattend evaluate` on your own data.
