"""Login for a hosted copy: her email address plus either a password or a 6-digit code emailed to her.
Off unless a login email or password is configured, so the local Mac app is unchanged.

  MCT_LOGIN_EMAIL       the account's email (her address). Required for email codes.
  MCT_PASSWORD_HASH     password as a scrypt hash: python -m app.auth hash-password
  MCT_PASSWORD          plain password (older setups; the hash is preferred)
  MCT_SMTP_*            outgoing mail for codes (app/core/mailer.py)
  MCT_SECRET            optional signing secret; otherwise one is generated into DATA_DIR/.session_secret
  MCT_OTP_DEBUG=1       local testing only: write codes to the server log when no SMTP is configured

A signed cookie keeps a device logged in for 30 days. The signing key includes the email and the password
material, so changing either logs every device out. Codes expire after 10 minutes and allow 5 tries;
at most one code a minute and five an hour are sent.
"""
import asyncio
import base64
import hashlib
import hmac
import html
import logging
import os
import secrets
import sys
import time

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse

from app.core import mailer
from app.core.config import DATA_DIR
from app.core.pack import PACK

log = logging.getLogger("mct.auth")
COOKIE = "mct_session"
MAX_AGE = 30 * 24 * 3600
# Reachable without a session: the login pages, and what Safari fetches for Add to Home Screen.
OPEN_PATHS = {"/login", "/login/code", "/login/verify", "/logout", "/favicon.svg", "/manifest.webmanifest", "/apple-touch-icon.png", "/icon-512.png"}
LOCKOUT_ATTEMPTS, LOCKOUT_SECONDS = 10, 15 * 60
CODE_TTL, CODE_TRIES, CODE_GAP, CODES_PER_HOUR = 10 * 60, 5, 60, 5
_failures: list[float] = []   # recent wrong passwords; one list, since there is one user
_code: dict = {}              # the live login code: hash, expiry, tries left
_sent: list[float] = []       # when codes were sent, for rate limiting


# ----------------------------------------------------------------------------- configuration
def _email() -> str:
    return os.getenv("MCT_LOGIN_EMAIL", "").strip().lower()


def _password_material() -> str:
    return os.getenv("MCT_PASSWORD_HASH") or os.getenv("MCT_PASSWORD", "")


def enabled() -> bool:
    return bool(_email() or _password_material())


def codes_available() -> bool:
    return bool(_email()) and (mailer.configured() or os.getenv("MCT_OTP_DEBUG") == "1")


def _secret() -> bytes:
    if os.getenv("MCT_SECRET"):
        return os.environ["MCT_SECRET"].encode()
    path = DATA_DIR / ".session_secret"
    if not path.exists():
        path.write_text(secrets.token_hex(32))
        path.chmod(0o600)
    return path.read_text().strip().encode()


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1)
    return f"scrypt$16384$8$1${base64.b64encode(salt).decode()}${base64.b64encode(digest).decode()}"


def _password_ok(given: str) -> bool:
    stored = os.getenv("MCT_PASSWORD_HASH")
    if stored:
        try:
            _, n, r, p, salt, digest = stored.split("$")
            test = hashlib.scrypt(given.encode(), salt=base64.b64decode(salt), n=int(n), r=int(r), p=int(p))
            return hmac.compare_digest(test, base64.b64decode(digest))
        except ValueError:
            log.error("MCT_PASSWORD_HASH is malformed")
            return False
    plain = os.getenv("MCT_PASSWORD", "")
    return bool(plain) and hmac.compare_digest(given.encode(), plain.encode())


def _email_ok(given: str) -> bool:
    return not _email() or hmac.compare_digest(given.strip().lower().encode(), _email().encode())


# ----------------------------------------------------------------------------- session cookie
def _sign(expiry: int) -> str:
    key = hashlib.sha256(b"mct-session:" + _secret() + b":" + _email().encode() + b":" + _password_material().encode()).digest()
    return hmac.new(key, str(expiry).encode(), hashlib.sha256).hexdigest()


def _valid(token: str | None) -> bool:
    expiry, _, sig = (token or "").partition(".")
    return expiry.isdigit() and int(expiry) > time.time() and hmac.compare_digest(sig, _sign(int(expiry)))


def _logged_in(request: Request) -> RedirectResponse:
    expiry = int(time.time()) + MAX_AGE
    response = RedirectResponse("/", status_code=303)
    response.set_cookie(COOKIE, f"{expiry}.{_sign(expiry)}", max_age=MAX_AGE, httponly=True, samesite="lax",
                        secure=request.url.scheme == "https")
    return response


class LoginRequired:
    """ASGI middleware (not BaseHTTPMiddleware, so streamed interview replies pass through untouched)."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not enabled() or scope["path"] in OPEN_PATHS:
            return await self.app(scope, receive, send)
        if _valid(Request(scope).cookies.get(COOKIE)):
            return await self.app(scope, receive, send)
        if scope["path"].startswith("/api/"):
            response = JSONResponse({"detail": "Log in first."}, status_code=401)
        else:
            response = RedirectResponse("/login", status_code=303)
        await response(scope, receive, send)


# ----------------------------------------------------------------------------- login code
def _code_hash(code: str) -> str:
    return hmac.new(_secret(), code.encode(), hashlib.sha256).hexdigest()


def _send_code() -> str | None:
    """Create and send a code to the account email. Returns an error message, or None when sent."""
    now = time.time()
    _sent[:] = [t for t in _sent if now - t < 3600]
    if _sent and now - _sent[-1] < CODE_GAP:
        return f"A code was just sent. You can ask for another in {int(CODE_GAP - (now - _sent[-1])) + 1} seconds."
    if len(_sent) >= CODES_PER_HOUR:
        return "Too many codes this hour. Use your password, or try again later."
    code = f"{secrets.randbelow(10**6):06d}"
    _code.clear()
    _code.update(hash=_code_hash(code), expires=now + CODE_TTL, tries=CODE_TRIES)
    _sent.append(now)
    if mailer.configured():
        try:
            mailer.send(_email(), f"{code} is your {PACK.app_name} code",
                        f"Your {PACK.app_name} login code is {code}.\n\nIt expires in 10 minutes. If you didn't ask for it, "
                        f"you can ignore this email; nobody can log in without the code.\n")
        except Exception as e:  # noqa: BLE001 - any SMTP failure is reported on the page, not raised
            log.error("could not send login code: %s", e)
            _code.clear()
            return "The code email could not be sent. Use your password, or try again in a minute."
    else:
        log.warning("MCT_OTP_DEBUG: login code %s (no SMTP configured; never use this setting on a server)", code)
    return None


def _code_ok(given: str) -> str | None:
    """None when the code is right; otherwise why not."""
    if not _code or time.time() > _code["expires"]:
        return "That code has expired. Ask for a new one."
    if _code["tries"] <= 0:
        return "Too many wrong codes. Ask for a new one."
    if hmac.compare_digest(_code_hash(given.strip()), _code["hash"]):
        _code.clear()
        return None
    _code["tries"] -= 1
    return "That code isn't right." + (f" {_code['tries']} tries left." if _code["tries"] else " Ask for a new one.")


# ----------------------------------------------------------------------------- routes
def install(app: FastAPI) -> None:
    """Add the middleware and the login routes. Call before any catch-all route is registered."""
    app.add_middleware(LoginRequired)

    @app.get("/login", include_in_schema=False)
    def login_page():
        return _page()

    @app.post("/login", include_in_schema=False)
    async def login(request: Request):
        now = time.time()
        _failures[:] = [t for t in _failures if now - t < LOCKOUT_SECONDS]
        if len(_failures) >= LOCKOUT_ATTEMPTS:
            return _page("Too many wrong attempts. Try again in 15 minutes.", status=429)
        form = await request.form()
        email, password = str(form.get("email", "")), str(form.get("password", ""))
        if _password_material() and _email_ok(email) and _password_ok(password):
            _failures.clear()
            return _logged_in(request)
        _failures.append(now)
        await asyncio.sleep(1)
        return _page("That email and password don't match." if _email() else "Wrong password.", email=email, status=401)

    @app.post("/login/code", include_in_schema=False)
    async def login_code(request: Request):
        email = str((await request.form()).get("email", ""))
        if not codes_available():
            return _page("Email codes aren't set up on this server. Use your password.", email=email, tab="code", status=400)
        if not email.strip():
            return _page("Enter your email address.", tab="code", status=400)
        error = _send_code() if _email_ok(email) else None  # same answer either way: never reveal which emails exist
        if error:
            return _page(error, email=email, tab="code", status=429)
        return _page(email=email, tab="verify", info=f"If {email} has an account, a 6-digit code is on its way. It expires in 10 minutes.")

    @app.post("/login/verify", include_in_schema=False)
    async def login_verify(request: Request):
        form = await request.form()
        email, code = str(form.get("email", "")), str(form.get("code", ""))
        error = _code_ok(code) if _email_ok(email) else "That code isn't right."
        if error is None:
            return _logged_in(request)
        await asyncio.sleep(1)
        return _page(error, email=email, tab="verify", status=401)

    @app.get("/logout", include_in_schema=False)
    def logout():
        response = RedirectResponse("/login", status_code=303)
        response.delete_cookie(COOKIE)
        return response


# ----------------------------------------------------------------------------- page
def _page(error: str = "", email: str = "", tab: str = "password", info: str = "", status: int = 200) -> HTMLResponse:
    e = html.escape(email)
    has_pw, has_codes, has_email = bool(_password_material()), codes_available(), bool(_email())
    if tab == "verify":
        body = f"""
  <p class="lead">Enter the 6-digit code we emailed you.</p>
  <form method="post" action="/login/verify">
    <input type="hidden" name="email" value="{e}">
    <label for="code">Code</label>
    <input id="code" name="code" inputmode="numeric" pattern="[0-9]{{6}}" maxlength="6" autocomplete="one-time-code" autofocus required class="code">
    <button type="submit">Log in</button>
  </form>
  <form method="post" action="/login/code" class="alt"><input type="hidden" name="email" value="{e}"><button type="submit" class="link">Send a new code</button></form>
  <a class="link block" href="/login">Use a different method</a>"""
    else:
        seg = ""
        if has_pw and has_codes:
            seg = f"""<div class="seg" role="tablist"><button type="button" role="tab" aria-selected="{str(tab != 'code').lower()}" data-tab="password">Password</button><button type="button" role="tab" aria-selected="{str(tab == 'code').lower()}" data-tab="code">Email me a code</button></div>"""
        email_field = f"""<label for="{{id}}">Email</label>
    <input id="{{id}}" name="email" type="email" value="{e}" autocomplete="username email" autocapitalize="off" spellcheck="false" {"required" if has_email else ""}>"""
        pw_form = f"""
  <form method="post" action="/login" data-panel="password" {"hidden" if tab == "code" and has_codes else ""}>
    {email_field.replace("{id}", "email") if has_email else '<input type="text" name="username" value="mct" autocomplete="username" hidden>'}
    <label for="password">Password</label>
    <input id="password" type="password" name="password" autocomplete="current-password" {"" if has_email else "autofocus"} required>
    <button type="submit">Log in</button>
  </form>""" if has_pw else ""
        code_form = f"""
  <form method="post" action="/login/code" data-panel="code" {"hidden" if has_pw and tab != "code" else ""}>
    {email_field.replace("{id}", "code-email")}
    <button type="submit">Email me a code</button>
    <p class="hint">We'll send a 6-digit code to your inbox. Safari can fill it in for you.</p>
  </form>""" if has_codes else ""
        body = f"""
  <p class="lead">Log in to your tracker.</p>
  {seg}{pw_form}{code_form}"""
    notice = (f'<p class="err" role="alert">{html.escape(error)}</p>' if error else "") + (f'<p class="info">{html.escape(info)}</p>' if info else "")
    page = (_PAGE.replace("{body}", body).replace("{notice}", notice).replace("{app_name}", html.escape(PACK.app_name))
            .replace("{mark}", html.escape(PACK.mark)).replace("{home_name}", html.escape(PACK.home_name)))
    return HTMLResponse(page, status_code=status)


_PAGE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="{home_name}">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<title>Log in · {app_name}</title>
<style>
  :root { color-scheme: light dark; --bg: #f2f2f7; --card: #fff; --text: #1d1d1f; --muted: #6e6e73; --field: rgba(118,118,128,.08);
          --fill: rgba(118,118,128,.12); --accent: #007aff; --danger: #d70015; --ok: #248a3d; }
  @media (prefers-color-scheme: dark) { :root { --bg: #000; --card: #1c1c1e; --text: #f5f5f7; --muted: #98989d; --field: rgba(118,118,128,.16);
          --fill: rgba(118,118,128,.24); --accent: #0a84ff; --danger: #ff453a; --ok: #30d158; } }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100dvh; display: grid; place-items: center; padding: 16px; background: var(--bg); color: var(--text);
         font: 15px/1.45 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
  main { width: 100%; max-width: 380px; background: var(--card); border-radius: 18px; padding: 30px 26px 26px;
         box-shadow: 0 1px 2px rgba(0,0,0,.04), 0 12px 40px rgba(0,0,0,.08); }
  .mark { width: 52px; height: 52px; border-radius: 12px; background: linear-gradient(#3d9bff, #0062e6); color: #fff; display: grid;
          place-items: center; font-weight: 700; font-size: 15px; letter-spacing: -.02em; margin-bottom: 18px; }
  h1 { font: 700 24px/1.2 -apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif; letter-spacing: -.02em; margin: 0; }
  .lead { margin: 6px 0 20px; color: var(--muted); }
  label { display: block; font-size: 13px; color: var(--muted); margin: 14px 0 6px; }
  input { width: 100%; font: inherit; font-size: 17px; padding: 11px 13px; border-radius: 11px; border: 1px solid transparent;
          background: var(--field); color: var(--text); }
  input:focus { outline: none; border-color: var(--accent); background: var(--card); box-shadow: 0 0 0 4px rgba(0,122,255,.25); }
  input.code { letter-spacing: .5em; font-size: 24px; text-align: center; font-variant-numeric: tabular-nums; }
  button { width: 100%; margin-top: 18px; font: inherit; font-weight: 600; font-size: 16px; padding: 12px; border: 0; border-radius: 12px;
           background: var(--accent); color: #fff; cursor: pointer; }
  button:active { opacity: .7; }
  button.link, a.link { background: none; color: var(--accent); font-weight: 500; font-size: 14px; padding: 6px; margin-top: 10px; text-decoration: none; }
  a.block { display: block; text-align: center; }
  form.alt button { margin-top: 12px; }
  .seg { display: flex; background: var(--fill); border-radius: 9px; padding: 2px; margin-bottom: 4px; }
  .seg button { margin: 0; padding: 6px; font-size: 13px; font-weight: 500; background: none; color: var(--text); border-radius: 7px; }
  .seg button[aria-selected="true"] { background: var(--card); box-shadow: 0 3px 8px rgba(0,0,0,.12); }
  .hint { font-size: 13px; color: var(--muted); margin: 12px 0 0; }
  .err, .info { margin: 12px 0 0; font-size: 14px; padding: 10px 12px; border-radius: 10px; }
  .err { color: var(--danger); background: rgba(255,59,48,.1); }
  .info { color: var(--ok); background: rgba(52,199,89,.12); }
  [hidden] { display: none !important; }
</style>
</head>
<body>
<main>
  <div class="mark">{mark}</div>
  <h1>{app_name}</h1>
  {notice}
{body}
</main>
<script>
  // Password / Email-code switch; the email typed in one form carries over to the other.
  document.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', () => {
    const cur = document.querySelector('[data-panel]:not([hidden]) input[type=email]');
    const typed = cur ? cur.value : '';
    document.querySelectorAll('.seg button').forEach(x => x.setAttribute('aria-selected', String(x === b)));
    document.querySelectorAll('[data-panel]').forEach(p => p.hidden = p.dataset.panel !== b.dataset.tab);
    const next = document.querySelector('[data-panel]:not([hidden]) input[type=email]');
    if (next && !next.value) next.value = typed;
  }));
</script>
</body>
</html>
"""


if __name__ == "__main__":
    # python -m app.auth hash-password  ->  prints a line to paste into .env
    if sys.argv[1:] == ["hash-password"]:
        import getpass
        pw = getpass.getpass("New password: ")
        if pw != getpass.getpass("Again: ") or len(pw) < 10:
            sys.exit("Passwords differ, or shorter than 10 characters.")
        print(f"MCT_PASSWORD_HASH={hash_password(pw)}")
    else:
        sys.exit("usage: python -m app.auth hash-password")
