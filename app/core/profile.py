"""Build, load and save the master profile."""
import re
from datetime import date
from pathlib import Path

from app.core import llm
from app.core.config import PROFILE_PATH, load_prompt
from app.core.models import GitHubMerge, LinkedInCopy, Profile, ProfileAddition, ProfileMerge, RiskFlags, Skill
from app.core.text import plain, plain_model
from connectors.github import GitHubSnapshot
from connectors.resume_pdf import extract_text

PROFICIENCY_RANK = {"learning": 0, "familiar": 1, "hands_on": 2, "expert": 3}


def build_from_text(resume_text: str, target_role: str) -> Profile:
    system = load_prompt("profile_builder").format(target_role=target_role, today=date.today().isoformat())
    p = llm.extract(Profile, user=f"<resume>\n{resume_text}\n</resume>", system=system, effort="high", feature="profile_build")
    return plain_model(p)


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
    return plain_model(llm.extract(GitHubMerge, user=user, system=system, effort="high", feature="github_merge"))


def _same_point(a: str, b: str) -> bool:
    """Two sentences saying the same thing in different words (each sync paraphrases the README)."""
    ta = set(re.findall(r"[a-z0-9]+", a.lower())) - _STOP
    tb = set(re.findall(r"[a-z0-9]+", b.lower())) - _STOP
    return bool(ta and tb) and len(ta & tb) / min(len(ta), len(tb)) >= 0.6


_STOP = {"the", "a", "an", "and", "or", "of", "to", "in", "on", "at", "by", "for", "with", "is", "are", "was", "so", "that",
         "this", "it", "as", "from", "per", "readme", "states", "documents"}


def add_unique(items: list[str], new: str) -> None:
    """Append unless an item already makes the same point; then keep whichever says more."""
    for i, x in enumerate(items):
        if _same_point(new, x):
            if len(new) > len(x):
                items[i] = new
            return
    items.append(new)


def dedupe(items: list[str]) -> list[str]:
    out: list[str] = []
    for x in items:
        add_unique(out, x)
    return out


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
            add_unique(cur.evidence, e)

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
            add_unique(existing.outcomes, o)

    if not profile.personal_info.github:
        profile.personal_info.github = f"https://github.com/{snap.username}"
    return profile


# ----------------------------------------------------------------------------- additions
def propose_addition(profile: Profile, add: ProfileAddition) -> ProfileMerge:
    """Ask the model what one new certification/course/project/job proves. Nothing is applied here."""
    system = load_prompt("profile_addition").format(target_role=profile.target.primary_role, today=date.today().isoformat())
    skills = "\n".join(f"- {s.name} [{s.category}] {s.proficiency}" for s in profile.skills)
    flags = "\n".join(f"- {f}" for f in profile.risk_flags)
    user = (f"<current_skills>\n{skills}\n</current_skills>\n\n<risk_flags>\n{flags}\n</risk_flags>\n\n"
            f"<addition>\n{add.model_dump_json(indent=1)}\n</addition>")
    return plain_model(llm.extract(ProfileMerge, user=user, system=system, effort="medium", feature="profile_addition"))


def apply_addition(profile: Profile, add: ProfileAddition, merge: ProfileMerge) -> tuple[Profile, list[dict]]:
    """Deterministic rules, same as the GitHub merge: evidence is appended, proficiency only rises,
    entries are upserted by name, nothing is removed except risk flags the addition resolves.
    A certification or course alone is capped at 'familiar' whatever the model said, unless the
    user described a project. Returns the profile and the list of skill changes."""
    cap = "familiar" if add.kind in ("certification", "course") and not (merge.course and merge.course.project) else "hands_on"
    if add.status != "completed":
        cap = "learning"
    by_name = {s.name.lower(): s for s in profile.skills}
    changes: list[dict] = []
    for sk in merge.skills:
        prof = sk.proficiency if PROFICIENCY_RANK[sk.proficiency] <= PROFICIENCY_RANK[cap] else cap
        cur = by_name.get(sk.name.lower())
        if cur is None:
            cur = Skill(name=sk.name, category=sk.category, proficiency=prof, evidence=[])
            profile.skills.append(cur)
            by_name[sk.name.lower()] = cur
            changes.append({"skill": cur.name, "from": None, "to": prof})
        elif PROFICIENCY_RANK[prof] > PROFICIENCY_RANK[cur.proficiency]:
            changes.append({"skill": cur.name, "from": cur.proficiency, "to": prof})
            cur.proficiency = prof
        if sk.evidence:
            add_unique(cur.evidence, sk.evidence)

    if merge.certification:
        c = merge.certification
        existing = next((x for x in profile.certifications if x.name.lower() == c.name.lower()), None)
        if existing:
            existing.status, existing.year, existing.issuer = c.status, c.year or existing.year, c.issuer or existing.issuer
        else:
            profile.certifications.append(c)
    if merge.course:
        c = merge.course
        existing = next((x for x in profile.courses if x.name.lower() == c.name.lower()), None)
        if existing:
            existing.provider, existing.year, existing.url, existing.project = c.provider or existing.provider, c.year or existing.year, c.url or existing.url, c.project or existing.project
        else:
            profile.courses.append(c)
    if merge.project:
        pr = merge.project
        existing = next((x for x in profile.projects if x.name.lower() == pr.name.lower()
                         or (x.url and pr.url and x.url.lower().rstrip("/") == pr.url.lower().rstrip("/"))), None)
        if existing:
            existing.description = pr.description or existing.description
            existing.url = pr.url or existing.url
            existing.technologies += [t for t in pr.technologies if t not in existing.technologies]
            for o in pr.outcomes:
                add_unique(existing.outcomes, o)
        else:
            profile.projects.append(pr)
    if merge.experience:
        e = merge.experience
        existing = next((x for x in profile.experience if x.company.lower() == e.company.lower() and x.title.lower() == e.title.lower()), None)
        if existing:
            existing.end = e.end
            existing.bullets += [b for b in e.bullets if b not in existing.bullets]
            existing.technologies += [t for t in e.technologies if t not in existing.technologies]
        else:
            profile.experience.insert(0, e)
            profile.experience.sort(key=lambda x: x.start, reverse=True)

    resolved = set(merge.resolved_risk_flags)
    profile.risk_flags = [f for f in profile.risk_flags if f not in resolved]
    return profile, changes


def refresh_risk_flags(profile: Profile, github_notes: list[str] | None = None) -> list[str]:
    """Re-derive 'what a recruiter will probe' from the profile as it is now. The list written at
    build time goes stale as certifications complete and projects land."""
    system = load_prompt("risk_flags").format(target_role=profile.target.primary_role, today=date.today().isoformat())
    notes = "\n".join(f"- {n}" for n in (github_notes or []))
    user = (f"<candidate_profile>\n{profile.model_dump_json(indent=1, exclude={'risk_flags'})}\n</candidate_profile>"
            + (f"\n\n<github_notes>\n{notes}\n</github_notes>" if notes else ""))
    return plain_model(llm.extract(RiskFlags, user=user, system=system, effort="medium", feature="risk_flags")).risk_flags


# ----------------------------------------------------------------------------- LinkedIn export
LINKEDIN_MAX = 2000  # LinkedIn's limit for a position or project description


def _month(ym: str | None) -> str:
    if not ym:
        return "Present"
    y, m = ym.split("-")
    return f"{date(int(y), int(m), 1):%b %Y}"


def _months_between(a: str, b: str) -> int:
    (ay, am), (by, bm) = (map(int, a.split("-")), map(int, b.split("-")))
    return (by - ay) * 12 + (bm - am)


def _clip(text: str, limit: int = LINKEDIN_MAX) -> str:
    text = plain(text)
    return text if len(text) <= limit else text[: limit - 4].rsplit("\n", 1)[0] + "..."


def linkedin_sections(profile: Profile) -> list[dict]:
    """Copy-paste-ready blocks in LinkedIn's own field layout. No model call."""
    out: list[dict] = []
    for e in profile.experience:
        kind = {"freelance": "Self-employed", "contractor": "Full-time (contract)", "full-time": "Full-time"}.get((e.employment_type or "").lower(), e.employment_type or "")
        head = f"Title: {e.title}\nCompany: {e.company}\nEmployment type: {kind}\nDates: {_month(e.start)} - {_month(e.end)}\nLocation: {e.location or ''}"
        desc = "\n".join(f"- {plain(b)}" for b in e.bullets)
        out.append({"section": "Experience", "label": f"{e.title} · {e.company}", "fields": head, "text": _clip(desc)})
    # Career break: LinkedIn shows a hole unless the break entry covers the exact months between jobs.
    jobs = sorted(profile.experience, key=lambda e: e.start)
    for prev, nxt in zip(jobs, jobs[1:]):
        if prev.end and _months_between(prev.end, nxt.start) >= 6:
            lo, hi = int(prev.end[:4]), int(nxt.start[:4])
            study = [f"completed the {ed.degree} at {ed.institution}" for ed in profile.education
                     if ed.start_year and lo <= ed.start_year <= hi]
            study += [f"completed the {c.name} ({c.issuer})" if c.issuer else f"completed the {c.name}" for c in profile.certifications
                      if c.status == "completed" and c.year and lo <= c.year <= hi and c.name.lower() not in {ed.degree.lower() for ed in profile.education}]
            done = "; ".join(study) or "professional development"
            certs = [c for c in profile.certifications if c.status == "in_progress"]
            prep = f", then prepared for {certs[0].name}" if certs else ""
            out.append({"section": "Experience", "label": "Career break",
                        "fields": f"Type: Career break - Professional development\nDates: {_month(prev.end)} - {_month(nxt.start)}",
                        "text": plain(f"{done[0].upper()}{done[1:]}{prep}, before returning to full-time work as {nxt.title.lower()} at {nxt.company}.")})
    for p in profile.projects:
        desc = p.description + ("\n\nOutcomes: " + "; ".join(p.outcomes) if p.outcomes else "") + "\n\nStack: " + ", ".join(p.technologies)
        out.append({"section": "Projects", "label": p.name, "fields": f"Name: {p.name}\nURL: {p.url or '(none)'}", "text": _clip(desc)})
    for c in profile.certifications:
        if c.status == "planned":
            continue
        fields = f"Name: {c.name}\nIssuing organization: {c.issuer or ''}\nIssue date: {c.year or ''}" + ("\n(in progress - add when passed)" if c.status == "in_progress" else "")
        out.append({"section": "Licenses & certifications", "label": c.name, "fields": fields, "text": ""})
    for c in profile.courses:
        out.append({"section": "Courses", "label": c.name, "fields": f"Name: {c.name}\nAssociated with: {c.provider or ''}\nYear: {c.year or ''}",
                    "text": plain(c.project) if c.project else ""})
    strong = [s.name for s in profile.skills if s.proficiency in ("hands_on", "expert")]
    soft = [s.name for s in profile.skills if s.proficiency == "familiar"]
    out.append({"section": "Skills", "label": "Add these (hands-on, evidenced)", "fields": f"{len(strong)} skills", "text": ", ".join(strong)})
    out.append({"section": "Skills", "label": "Only if you accept 'familiar'-level questions", "fields": f"{len(soft)} skills", "text": ", ".join(soft)})
    return out


def linkedin_copy(profile: Profile) -> LinkedInCopy:
    system = load_prompt("linkedin_writer").format(target_role=profile.target.primary_role)
    out = llm.extract(LinkedInCopy, user=f"<candidate_profile>\n{profile.model_dump_json(indent=1)}\n</candidate_profile>", system=system,
                      effort="low", feature="linkedin", tier="basic")
    return plain_model(out)
