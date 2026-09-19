"""Build, load and save the master profile."""
from datetime import date
from pathlib import Path

from app.core import llm
from app.core.config import PROFILE_PATH, load_prompt
from app.core.models import GitHubMerge, LinkedInCopy, Profile, Skill
from connectors.github import GitHubSnapshot
from connectors.resume_pdf import extract_text

PROFICIENCY_RANK = {"learning": 0, "familiar": 1, "hands_on": 2, "expert": 3}


def build_from_text(resume_text: str, target_role: str) -> Profile:
    system = load_prompt("profile_builder").format(target_role=target_role, today=date.today().isoformat())
    return llm.extract(Profile, user=f"<resume>\n{resume_text}\n</resume>", system=system, effort="high", feature="profile_build")


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


# ----------------------------------------------------------------------------- GitHub merge
def propose_github_merge(profile: Profile, snap: GitHubSnapshot) -> GitHubMerge:
    """Ask the model what the repos prove. Nothing is applied here."""
    system = load_prompt("github_merge").format(target_role=profile.target.primary_role, today=date.today().isoformat())
    skills = "\n".join(f"- {s.name} [{s.category}] {s.proficiency}" for s in profile.skills)
    projects = "\n".join(f"- {p.name} ({p.url or 'no url'}): {p.description}" for p in profile.projects)
    repos = "\n\n".join(r.digest() for r in snap.repos)
    user = (f"<current_skills>\n{skills}\n</current_skills>\n\n<current_projects>\n{projects}\n</current_projects>\n\n"
            f"<repositories owner=\"{snap.username}\">\n{repos}\n</repositories>")
    return llm.extract(GitHubMerge, user=user, system=system, effort="high", feature="github_merge")


def apply_github_merge(profile: Profile, merge: GitHubMerge, snap: GitHubSnapshot) -> Profile:
    """Deterministic rules: evidence is appended, proficiency only ever rises (capped at hands_on
    from GitHub alone), projects are upserted by URL/name, nothing is removed."""
    repo_urls = {r.url.lower() for r in snap.repos if r.has_code}
    repo_names = {r.name.lower() for r in snap.repos if r.has_code}
    by_name = {s.name.lower(): s for s in profile.skills}

    for se in merge.skills:
        # Keep only evidence that cites a repo we actually fetched and that has code.
        evidence = [e for e in se.evidence if e.split(":")[0].strip().lower() in repo_names]
        if not evidence:
            continue
        cur = by_name.get(se.name.lower())
        if cur is None:
            cur = Skill(name=se.name, category=se.category, proficiency=se.proficiency, evidence=[])
            profile.skills.append(cur)
            by_name[se.name.lower()] = cur
        elif PROFICIENCY_RANK[se.proficiency] > PROFICIENCY_RANK[cur.proficiency]:
            cur.proficiency = se.proficiency
        for e in evidence:
            if e not in cur.evidence:
                cur.evidence.append(e)

    for pr in merge.projects:
        if not pr.url or pr.url.lower().rstrip("/") not in repo_urls:
            continue
        existing = next((p for p in profile.projects
                         if (p.url and p.url.lower().rstrip("/") == pr.url.lower().rstrip("/"))
                         or p.name.lower() == pr.name.lower()), None)
        if existing is None:
            profile.projects.append(pr)
            continue
        existing.url = pr.url
        existing.description = existing.description or pr.description
        for t in pr.technologies:
            if t not in existing.technologies:
                existing.technologies.append(t)
        for o in pr.outcomes:
            if o not in existing.outcomes:
                existing.outcomes.append(o)

    if not profile.personal_info.github:
        profile.personal_info.github = f"https://github.com/{snap.username}"
    return profile


# ----------------------------------------------------------------------------- LinkedIn export
LINKEDIN_MAX = 2000  # LinkedIn's limit for a position or project description


def _month(ym: str | None) -> str:
    if not ym:
        return "Present"
    y, m = ym.split("-")
    return f"{date(int(y), int(m), 1):%b %Y}"


def _clip(text: str, limit: int = LINKEDIN_MAX) -> str:
    return text if len(text) <= limit else text[: limit - 1].rsplit("\n", 1)[0] + "…"


def linkedin_sections(profile: Profile) -> list[dict]:
    """Copy-paste-ready blocks in LinkedIn's own field layout. No model call."""
    out: list[dict] = []
    for e in profile.experience:
        kind = {"freelance": "Self-employed", "contractor": "Full-time (contract)", "full-time": "Full-time"}.get((e.employment_type or "").lower(), e.employment_type or "")
        head = f"Title: {e.title}\nCompany: {e.company}\nEmployment type: {kind}\nDates: {_month(e.start)} - {_month(e.end)}\nLocation: {e.location or ''}"
        desc = "\n".join(f"• {b}" for b in e.bullets)
        out.append({"section": "Experience", "label": f"{e.title} · {e.company}", "fields": head, "text": _clip(desc)})
    guvi = next((ed for ed in profile.education if "GUVI" in ed.institution), None)
    if guvi:
        out.append({"section": "Experience", "label": "Career break",
                    "fields": f"Type: Career break - Professional development\nDates: {guvi.start_year or ''} - {guvi.end_year or ''}",
                    "text": f"Completed the {guvi.degree} at {guvi.institution}, then self-studied AWS (Solutions Architect - Associate) before returning to full-time freelance work."})
    for p in profile.projects:
        desc = p.description + ("\n\nOutcomes: " + "; ".join(p.outcomes) if p.outcomes else "") + "\n\nStack: " + ", ".join(p.technologies)
        out.append({"section": "Projects", "label": p.name, "fields": f"Name: {p.name}\nURL: {p.url or '(none)'}", "text": _clip(desc)})
    strong = [s.name for s in profile.skills if s.proficiency in ("hands_on", "expert")]
    soft = [s.name for s in profile.skills if s.proficiency == "familiar"]
    out.append({"section": "Skills", "label": "Add these (hands-on, evidenced)", "fields": f"{len(strong)} skills", "text": ", ".join(strong)})
    out.append({"section": "Skills", "label": "Only if you accept 'familiar'-level questions", "fields": f"{len(soft)} skills", "text": ", ".join(soft)})
    return out


def linkedin_copy(profile: Profile) -> LinkedInCopy:
    system = load_prompt("linkedin_writer").format(target_role=profile.target.primary_role)
    return llm.extract(LinkedInCopy, user=f"<candidate_profile>\n{profile.model_dump_json(indent=1)}\n</candidate_profile>", system=system,
                       effort="low", feature="linkedin", tier="basic")
