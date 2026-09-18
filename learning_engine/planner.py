"""Learning plan generation, real-resource search, and closing the loop back into the profile."""
import math
from datetime import date

import anthropic

from app.core import llm
from app.core.config import DATA_DIR, load_prompt
from app.core.models import LearningPlan, Profile, Resource, ResourceList, Skill, SkillCategory
from app.core.tracker import SkillDemand

PLAN_PATH = DATA_DIR / "learning_plan.json"


# ---------------------------------------------------------------------------
# Plan
# ---------------------------------------------------------------------------

def generate_plan(profile: Profile, gaps: list[SkillDemand], weekly_hours: int = 10, top_n: int = 6) -> LearningPlan:
    gaps = [g for g in gaps if g.pressure > 0][:top_n]
    gap_text = "\n".join(
        f"- {g.skill}: asked in {g.jobs} JDs (must-have in {g.must_have}), coverage {g.coverage:.0f}%, pressure {g.pressure:.1f}"
        for g in gaps
    )
    system = load_prompt("learning_planner").format(
        target_role=profile.target.primary_role, weekly_hours=weekly_hours, today=date.today().isoformat())
    user = (f"<candidate_profile>\n{profile.model_dump_json(indent=1)}\n</candidate_profile>\n\n"
            f"<gaps>\n{gap_text}\n</gaps>")
    plan = llm.extract(LearningPlan, user=user, system=system, effort="high")
    # Skill plans decompose the project, so the project's milestones are the real critical path.
    total = sum(m.hours for m in plan.portfolio_project.milestones)
    plan.weekly_hours_assumed = weekly_hours
    plan.weeks_to_complete = max(1, math.ceil(total / weekly_hours))
    return plan


def load_plan() -> LearningPlan | None:
    if not PLAN_PATH.exists():
        return None
    return LearningPlan.model_validate_json(PLAN_PATH.read_text())


def save_plan(plan: LearningPlan) -> None:
    PLAN_PATH.write_text(plan.model_dump_json(indent=2))


# ---------------------------------------------------------------------------
# Resources via real web search
# ---------------------------------------------------------------------------

def find_resources(skill: str, profile: Profile) -> list[Resource]:
    """Web-search for the skill, then rank only the URLs the search actually returned."""
    response = llm.client().messages.create(
        model=llm.MODEL,
        max_tokens=4000,
        tools=[{"type": "web_search_20260209", "name": "web_search", "max_uses": 2}],
        messages=[{"role": "user", "content":
                   f"Find the best free or well-regarded resources to learn {skill} hands-on for a "
                   f"{profile.target.primary_role}: official docs, tutorials, labs, courses. Search twice "
                   f"with different phrasings, then list what you found with titles and URLs."}],
        output_config={"effort": "low"},
    )
    found: dict[str, dict] = {}
    for block in response.content:
        if block.type == "web_search_tool_result" and isinstance(block.content, list):
            for r in block.content:
                if getattr(r, "type", "") == "web_search_result" and r.url not in found:
                    found[r.url] = {"title": r.title, "url": r.url}
    if not found:
        return []
    model_notes = "".join(b.text for b in response.content if b.type == "text")
    results_text = "\n".join(f"- {v['title']} | {v['url']}" for v in found.values())
    system = load_prompt("resource_ranker").format(target_role=profile.target.primary_role, skill=skill)
    user = (f"<search_results>\n{results_text}\n</search_results>\n\n<notes>\n{model_notes}\n</notes>\n\n"
            f"<candidate_profile_summary>\n{profile.summary}\n</candidate_profile_summary>")
    ranked = llm.extract(ResourceList, user=user, system=system, effort="low").resources
    return [r for r in ranked if r.url in found]  # hard guarantee: only real URLs


# ---------------------------------------------------------------------------
# Close the loop: skill learned -> profile updated
# ---------------------------------------------------------------------------

def mark_learned(profile: Profile, skill_name: str, evidence: str, category: SkillCategory = "data_engineering") -> Profile:
    for s in profile.skills:
        if s.name.lower() == skill_name.lower():
            s.proficiency = "hands_on"
            s.evidence.append(evidence)
            return profile
    profile.skills.append(Skill(name=skill_name, category=category, proficiency="hands_on", evidence=[evidence]))
    return profile
