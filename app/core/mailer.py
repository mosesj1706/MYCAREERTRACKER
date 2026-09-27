"""Outgoing email over SMTP (used for login codes). Configured in .env; works with Gmail (an app
password), AWS SES SMTP credentials, Outlook and most providers.

  MCT_SMTP_HOST, MCT_SMTP_PORT (587 STARTTLS, or 465 with MCT_SMTP_SSL=1),
  MCT_SMTP_USER, MCT_SMTP_PASSWORD, MCT_SMTP_FROM (defaults to the user)
"""
import os
import smtplib
import ssl
from email.message import EmailMessage


def configured() -> bool:
    return bool(os.getenv("MCT_SMTP_HOST") and os.getenv("MCT_SMTP_USER") and os.getenv("MCT_SMTP_PASSWORD"))


def send(to: str, subject: str, text: str) -> None:
    host, user = os.environ["MCT_SMTP_HOST"], os.environ["MCT_SMTP_USER"]
    port = int(os.getenv("MCT_SMTP_PORT") or (465 if os.getenv("MCT_SMTP_SSL") else 587))
    msg = EmailMessage()
    msg["From"] = os.getenv("MCT_SMTP_FROM") or user
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(text)
    context = ssl.create_default_context()
    if os.getenv("MCT_SMTP_SSL") or port == 465:
        with smtplib.SMTP_SSL(host, port, context=context, timeout=20) as s:
            s.login(user, os.environ["MCT_SMTP_PASSWORD"])
            s.send_message(msg)
    else:
        with smtplib.SMTP(host, port, timeout=20) as s:
            s.starttls(context=context)
            s.login(user, os.environ["MCT_SMTP_PASSWORD"])
            s.send_message(msg)
