from __future__ import annotations

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from ..auth import Admin, AdminDep, bearer_token

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginIn(BaseModel):
    username: str = Field(..., max_length=64)
    password: str = Field(..., max_length=256)


class PasswordIn(BaseModel):
    current_password: str = Field(..., max_length=256)
    new_password: str = Field(..., max_length=256)


@router.post("/login")
def login(request: Request, body: LoginIn):
    ip = request.client.host if request.client else "unknown"
    token, admin, expires = request.app.state.ctx.auth.login(
        body.username, body.password, ip, request.headers.get("user-agent"))
    return {"token": token, "expires_at": expires, "admin": admin.to_dict()}


@router.get("/me")
def me(admin: Admin = AdminDep):
    return admin.to_dict()


@router.post("/logout", status_code=204)
def logout(request: Request, _: Admin = AdminDep):
    request.app.state.ctx.auth.logout(bearer_token(request))


@router.post("/password", status_code=204)
def change_password(request: Request, body: PasswordIn, admin: Admin = AdminDep):
    request.app.state.ctx.auth.change_password(admin, body.current_password, body.new_password,
                                               bearer_token(request))
