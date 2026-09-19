"""Central paths and settings. Import this instead of hardcoding 'data/...' strings."""
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data"
PROMPTS_DIR = ROOT / "prompts"

PROFILE_PATH = DATA_DIR / "master_profile.json"
RESUME_PDF_PATH = DATA_DIR / "resume.pdf"
DB_PATH = DATA_DIR / "career.db"
GITHUB_CACHE_PATH = DATA_DIR / "github_repos.json"

# Loads ANTHROPIC_API_KEY from .env into the environment so the SDK picks it up.
load_dotenv(ROOT / ".env")


def load_prompt(name: str) -> str:
    return (PROMPTS_DIR / f"{name}.txt").read_text()
