"""Build, load and save the master profile."""
from datetime import date
from pathlib import Path

from app.core import llm
from app.core.config import PROFILE_PATH, load_prompt
from app.core.models import Profile
from connectors.resume_pdf import extract_text


def build_from_text(resume_text: str, target_role: str) -> Profile:
    system = load_prompt("profile_builder").format(target_role=target_role, today=date.today().isoformat())
    return llm.extract(Profile, user=f"<resume>\n{resume_text}\n</resume>", system=system, effort="high")


def build_from_pdf(pdf_path: str | Path, target_role: str) -> Profile:
    return build_from_text(extract_text(pdf_path), target_role)


def load() -> Profile:
    return Profile.model_validate_json(PROFILE_PATH.read_text())


def save(profile: Profile) -> None:
    profile.updated_at = date.today().isoformat()
    PROFILE_PATH.write_text(profile.model_dump_json(indent=2))


def exists() -> bool:
    if not PROFILE_PATH.exists():
        return False
    try:
        load()
        return True
    except Exception:
        return False
