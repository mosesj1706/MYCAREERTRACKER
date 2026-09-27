"""Password login for a hosted copy. Off unless MCT_PASSWORD is set, so the local Mac app is unchanged.

A signed cookie (expiry + HMAC) keeps a device logged in for 30 days. The signing key is derived from
the password, so changing the password logs every device out.
"""
import asyncio
import hashlib
import hmac
import os
import time

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse

from app.core.pack import PACK

COOKIE = "mct_session"
MAX_AGE = 30 * 24 * 3600
# Reachable without a session: the login page itself, and what Safari fetches for Add to Home Screen.
OPEN_PATHS = {"/login", "/logout", "/favicon.svg", "/manifest.webmanifest", "/apple-touch-icon.png", "/icon-512.png"}
LOCKOUT_ATTEMPTS, LOCKOUT_SECONDS = 10, 15 * 60
_failures: list[float] = []  # times of recent wrong passwords; one list, since there is one user


def _password() -> str:
    return os.getenv("MCT_PASSWORD", "")


def _sign(expiry: int) -> str:
    key = hashlib.sha256(b"mct-session:" + _password().encode()).digest()
    return hmac.new(key, str(expiry).encode(), hashlib.sha256).hexdigest()


def _valid(token: str | None) -> bool:
    expiry, _, sig = (token or "").partition(".")
    return expiry.isdigit() and int(expiry) > time.time() and hmac.compare_digest(sig, _sign(int(expiry)))


class LoginRequired:
    """ASGI middleware (not BaseHTTPMiddleware, so streamed interview replies pass through untouched)."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not _password() or scope["path"] in OPEN_PATHS:
            return await self.app(scope, receive, send)
        if _valid(Request(scope).cookies.get(COOKIE)):
            return await self.app(scope, receive, send)
        if scope["path"].startswith("/api/"):
            response = JSONResponse({"detail": "Log in first."}, status_code=401)
        else:
            response = RedirectResponse("/login", status_code=303)
        await response(scope, receive, send)


def _page(error: str = "", status: int = 200) -> HTMLResponse:
    html = (_PAGE.replace("{error}", f'<p class="err">{error}</p>' if error else "")
            .replace("{app_name}", PACK.app_name).replace("{mark}", PACK.mark).replace("{home_name}", PACK.home_name))
    return HTMLResponse(html, status_code=status)


def install(app: FastAPI) -> None:
    """Add the middleware and the /login, /logout routes. Call before any catch-all route is registered."""
    app.add_middleware(LoginRequired)

    @app.get("/login", include_in_schema=False)
    def login_page():
        return _page()

    @app.post("/login", include_in_schema=False)
    async def login(request: Request):
        now = time.time()
        _failures[:] = [t for t in _failures if now - t < LOCKOUT_SECONDS]
        if len(_failures) >= LOCKOUT_ATTEMPTS:
            return _page("Too many wrong attempts. Try again in 15 minutes.", 429)
        password = str((await request.form()).get("password", ""))
        if _password() and hmac.compare_digest(password.encode(), _password().encode()):
            _failures.clear()
            expiry = int(now) + MAX_AGE
            response = RedirectResponse("/", status_code=303)
            response.set_cookie(COOKIE, f"{expiry}.{_sign(expiry)}", max_age=MAX_AGE, httponly=True,
                                samesite="lax", secure=request.url.scheme == "https")
            return response
        _failures.append(now)
        await asyncio.sleep(1)
        return _page("Wrong password.", 401)

    @app.get("/logout", include_in_schema=False)
    def logout():
        response = RedirectResponse("/login", status_code=303)
        response.delete_cookie(COOKIE)
        return response


_PAGE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="{home_name}">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<title>Log in · {app_name}</title>
<style>
  :root { color-scheme: light dark; --bg: #f6f7f9; --card: #fff; --text: #111318; --muted: #5d6472; --border: #dfe2e8; --accent: #4f6bff; --danger: #d23c3c; }
  @media (prefers-color-scheme: dark) { :root { --bg: #0d0f13; --card: #15181e; --text: #e8eaef; --muted: #9aa1ae; --border: #262a33; --danger: #ff6b6b; } }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px; background: var(--bg); color: var(--text);
         font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif; }
  form { width: 100%; max-width: 340px; background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: 28px 24px; }
  .mark { width: 44px; height: 44px; border-radius: 10px; background: var(--accent); color: #fff; display: grid; place-items: center;
          font-weight: 800; font-size: 13px; letter-spacing: -0.02em; margin-bottom: 16px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  p { margin: 0 0 18px; color: var(--muted); font-size: 14px; }
  label { display: block; font-size: 13px; color: var(--muted); margin-bottom: 6px; }
  input { width: 100%; font: inherit; font-size: 16px; padding: 11px 12px; border-radius: 9px; border: 1px solid var(--border);
          background: var(--bg); color: var(--text); }
  input:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
  button { width: 100%; margin-top: 14px; font: inherit; font-weight: 600; padding: 11px; border: 0; border-radius: 9px;
           background: var(--accent); color: #fff; cursor: pointer; }
  .err { color: var(--danger); margin: 12px 0 0; }
</style>
</head>
<body>
<form method="post" action="/login">
  <div class="mark">{mark}</div>
  <h1>Welcome back</h1>
  <p>Enter the password to open your tracker.</p>
  <input type="text" name="username" value="mct" autocomplete="username" hidden>
  <label for="password">Password</label>
  <input id="password" type="password" name="password" autocomplete="current-password" autofocus required>
  <button type="submit">Log in</button>
  {error}
</form>
</body>
</html>
"""
