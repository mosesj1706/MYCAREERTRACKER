"""GitHub -> repo digests. Used by the profile merger to turn shipped code into skill evidence.

Public repos need no auth. Set GITHUB_TOKEN in .env to include private repos and get a higher
rate limit. Forks and the profile-README repo (named after the user) are skipped.
"""
import base64
import json
import os
import sys
from datetime import datetime, timezone

import httpx
from pydantic import BaseModel, Field

from app.core.config import GITHUB_CACHE_PATH

API = "https://api.github.com"
README_MAX_CHARS = 3500
KEY_FILE_MAX_CHARS = 1500
KEY_FILE_LIMIT = 5
# Files whose *contents* say what infrastructure/CI a repo really uses. Matched against full paths.
KEY_FILE_PATTERNS = ("infra/", "terraform/", "cloudformation/", "cdk/", ".github/workflows/", "template.yaml", "template.yml",
                     "serverless.yml", "samconfig.toml", "Dockerfile", "docker-compose", "Jenkinsfile", "deploy")


class GitHubError(Exception):
    """User-facing fetch failure (unknown user, rate limit, auth)."""


class Repo(BaseModel):
    name: str
    full_name: str
    url: str
    description: str | None = None
    private: bool = False
    primary_language: str | None = None
    languages: dict[str, int] = Field(default_factory=dict, description="language -> bytes of code")
    topics: list[str] = Field(default_factory=list)
    stars: int = 0
    created_at: str
    pushed_at: str
    commits: int | None = None
    top_files: list[str] = Field(default_factory=list, description="File tree, up to three levels deep")
    key_files: dict[str, str] = Field(default_factory=dict, description="path -> head of infra/CI files, so IaC is judged from content")
    readme: str | None = None

    @property
    def has_code(self) -> bool:
        return bool(self.languages) or bool(self.commits)

    def digest(self) -> str:
        """Compact text block for the LLM prompt."""
        langs = ", ".join(f"{k} ({v // 1000}k)" for k, v in sorted(self.languages.items(), key=lambda kv: -kv[1])[:6])
        lines = [
            f"### {self.full_name}{' (private)' if self.private else ''}",
            f"url: {self.url}",
            f"description: {self.description or '-'}",
            f"languages: {langs or self.primary_language or '-'}",
            f"topics: {', '.join(self.topics) or '-'}",
            f"created: {self.created_at[:10]} · last push: {self.pushed_at[:10]} · commits: {self.commits if self.commits is not None else '?'}",
            f"files: {', '.join(self.top_files) or '-'}",
            f"has_code: {'yes' if self.has_code else 'NO - empty repo, description only'}",
        ]
        for path, head in self.key_files.items():
            lines += [f"--- {path} ---", head]
        if self.readme:
            lines += ["readme:", self.readme]
        return "\n".join(lines)


class GitHubSnapshot(BaseModel):
    username: str
    fetched_at: str
    repos: list[Repo]
    merged_at: str | None = None
    notes: list[str] = Field(default_factory=list, description="What the merge step noticed about this GitHub")

    def save(self) -> None:
        GITHUB_CACHE_PATH.write_text(self.model_dump_json(indent=2))


def _client() -> httpx.Client:
    headers = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28",
               "User-Agent": "MYCAREERTRACKER"}
    if token := os.getenv("GITHUB_TOKEN"):
        headers["Authorization"] = f"Bearer {token}"
    return httpx.Client(base_url=API, headers=headers, timeout=30)


def _get(c: httpx.Client, path: str, **params) -> httpx.Response:
    """GET that fails loudly on rate limit / auth instead of degrading the data."""
    r = c.get(path, params=params or None)
    if r.status_code in (403, 429) and r.headers.get("x-ratelimit-remaining") == "0":
        reset = datetime.fromtimestamp(int(r.headers.get("x-ratelimit-reset", "0"))).strftime("%H:%M")
        limit = r.headers.get("x-ratelimit-limit", "60")
        hint = "" if os.getenv("GITHUB_TOKEN") else " Add GITHUB_TOKEN to .env to raise it to 5000/hour."
        raise GitHubError(f"GitHub API rate limit reached ({limit}/hour). Resets at {reset}.{hint}")
    if r.status_code == 401:
        raise GitHubError("GITHUB_TOKEN was rejected - check the token in .env.")
    return r


def _commit_count(c: httpx.Client, full_name: str) -> int | None:
    # GitHub has no count endpoint; ask for 1 commit per page and read the last page number.
    r = _get(c, f"/repos/{full_name}/commits", per_page=1)
    if r.status_code != 200:
        return None
    link = r.headers.get("Link", "")
    for part in link.split(","):
        if 'rel="last"' in part:
            return int(part.split("page=")[-1].split(">")[0].split("&")[0])
    return len(r.json())


def _top_files(c: httpx.Client, full_name: str, default_branch: str) -> list[str]:
    """Paths up to three levels deep, so infra/, migrations/, workflows/ etc. are visible."""
    r = _get(c, f"/repos/{full_name}/git/trees/{default_branch}", recursive="1")
    if r.status_code != 200:
        return []
    paths = [t["path"] + ("/" if t["type"] == "tree" else "") for t in r.json().get("tree", [])]
    paths = [p for p in paths if p.count("/") <= 2 + p.endswith("/") and not p.startswith(("assets/", "public/", "docs/screenshots/"))]
    return sorted(paths)[:150]


def _key_files(c: httpx.Client, full_name: str, paths: list[str]) -> dict[str, str]:
    picked = [p for p in paths if not p.endswith("/") and any(k in p for k in KEY_FILE_PATTERNS)
              and p.rsplit(".", 1)[-1] in ("yaml", "yml", "tf", "json", "toml", "sh") or p.endswith(("Dockerfile", "Jenkinsfile"))]
    out: dict[str, str] = {}
    for path in picked[:KEY_FILE_LIMIT]:
        r = _get(c, f"/repos/{full_name}/contents/{path}")
        if r.status_code == 200 and r.json().get("encoding") == "base64":
            text = base64.b64decode(r.json()["content"]).decode("utf-8", errors="replace")
            out[path] = text[:KEY_FILE_MAX_CHARS] + ("\n…(truncated)" if len(text) > KEY_FILE_MAX_CHARS else "")
    return out


def _readme(c: httpx.Client, full_name: str) -> str | None:
    r = _get(c, f"/repos/{full_name}/readme")
    if r.status_code != 200:
        return None
    text = base64.b64decode(r.json().get("content", "")).decode("utf-8", errors="replace")
    return text[:README_MAX_CHARS] + ("\n…(truncated)" if len(text) > README_MAX_CHARS else "")


def fetch(username: str, include_forks: bool = False) -> GitHubSnapshot:
    with _client() as c:
        # With a token, /user/repos also returns private repos of the authenticated user.
        if os.getenv("GITHUB_TOKEN"):
            r = _get(c, "/user/repos", per_page=100, sort="pushed", affiliation="owner")
        else:
            r = _get(c, f"/users/{username}/repos", per_page=100, sort="pushed")
        if r.status_code == 404:
            raise GitHubError(f"GitHub user '{username}' not found.")
        r.raise_for_status()
        repos: list[Repo] = []
        for raw in r.json():
            if raw["name"].lower() == username.lower():
                continue  # profile README repo
            if raw["fork"] and not include_forks:
                continue
            full = raw["full_name"]
            repo = Repo(
                name=raw["name"], full_name=full, url=raw["html_url"], description=raw.get("description"),
                private=raw.get("private", False), primary_language=raw.get("language"),
                topics=raw.get("topics") or [], stars=raw.get("stargazers_count", 0),
                created_at=raw["created_at"], pushed_at=raw["pushed_at"],
            )
            if raw.get("size", 0) > 0:  # size 0 = empty repo; skip the 4 detail calls
                langs = _get(c, f"/repos/{full}/languages")
                repo.languages = langs.json() if langs.status_code == 200 else {}
                repo.commits = _commit_count(c, full)
                repo.top_files = _top_files(c, full, raw.get("default_branch", "main"))
                repo.key_files = _key_files(c, full, repo.top_files)
                repo.readme = _readme(c, full)
            repos.append(repo)
    snap = GitHubSnapshot(username=username, fetched_at=datetime.now(timezone.utc).isoformat(timespec="seconds"), repos=repos)
    snap.save()
    return snap


def load_snapshot() -> GitHubSnapshot | None:
    if not GITHUB_CACHE_PATH.exists():
        return None
    try:
        return GitHubSnapshot.model_validate_json(GITHUB_CACHE_PATH.read_text())
    except Exception:
        return None


def username_from_url(url: str | None) -> str | None:
    """'https://github.com/mosesj1706' or 'github.com/mosesj1706/' -> 'mosesj1706'."""
    if not url:
        return None
    tail = url.rstrip("/").split("github.com/")[-1]
    return tail.split("/")[0] or None


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python -m connectors.github <username>")
        sys.exit(1)
    snap = fetch(sys.argv[1])
    print(json.dumps([r.model_dump(exclude={"readme"}) for r in snap.repos], indent=2))
