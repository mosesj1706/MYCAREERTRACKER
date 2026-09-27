"""Central paths and settings. Import this instead of hardcoding 'data/...' strings."""
import os
import re
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]

# Loads ANTHROPIC_API_KEY (and MCT_* settings) from .env into the environment so the SDK picks it up.
load_dotenv(ROOT / ".env")

# MCT_DATA_DIR moves personal data out of the checkout (the hosted copy keeps it on its own disk).
DATA_DIR = Path(os.getenv("MCT_DATA_DIR") or ROOT / "data")
PROMPTS_DIR = ROOT / "prompts"

PROFILE_PATH = DATA_DIR / "master_profile.json"
RESUME_PDF_PATH = DATA_DIR / "resume.pdf"
DB_PATH = DATA_DIR / "career.db"
GITHUB_CACHE_PATH = DATA_DIR / "github_repos.json"


def load_prompt(name: str) -> str:
    """Read prompts/<name>.txt, or prompts/<profession>/<name>.txt when the active profession pack
    has its own version. A line `<<other>>` pulls in another prompt the same way, so rules shared by
    several prompts (the writing voice) live in one file."""
    from app.core.pack import PROFESSION  # local import: pack imports this module first to load .env
    override = PROMPTS_DIR / PROFESSION / f"{name}.txt"
    text = (override if override.exists() else PROMPTS_DIR / f"{name}.txt").read_text()
    return re.sub(r"<<(\w+)>>", lambda m: load_prompt(m.group(1)).strip(), text)
