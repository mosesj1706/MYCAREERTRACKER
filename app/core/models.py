"""Pydantic schemas shared by the whole app. The Profile is the single source of truth
about Moses; everything else (matching, interviews, learning) reads from it."""
from datetime import date
from typing import ClassVar, Literal

from pydantic import BaseModel, Field

SkillCategory = Literal[
    "cloud", "data_engineering", "programming", "devops", "ml_ai", "databases", "tools", "soft"
]
Proficiency = Literal["learning", "familiar", "hands_on", "expert"]


class Skill(BaseModel):
    name: str = Field(description="Canonical name, e.g. 'AWS Lambda', 'Python', 'Terraform'")
    category: SkillCategory
    proficiency: Proficiency = Field(
        description="'learning' = self-described as learning / no evidence; 'familiar' = used lightly or in coursework; "
        "'hands_on' = used in a job or substantial project; 'expert' = deep, repeated production use"
    )
    evidence: list[str] = Field(
        default_factory=list,
        description="Short quotes/paraphrases from experience or projects that prove this skill. Empty if none.",
    )


class Experience(BaseModel):
    company: str
    title: str
    location: str | None = None
    employment_type: str | None = Field(default=None, description="e.g. full-time, contractor, intern")
    start: str = Field(description="YYYY-MM")
    end: str | None = Field(default=None, description="YYYY-MM, or null if current")
    bullets: list[str] = Field(description="Achievement bullets, verbatim from the source")
    technologies: list[str] = Field(default_factory=list)


class Project(BaseModel):
    name: str
    description: str
    technologies: list[str] = Field(default_factory=list)
    outcomes: list[str] = Field(default_factory=list, description="Quantified results if any")
    url: str | None = None


class Education(BaseModel):
    institution: str
    degree: str
    field: str | None = None
    start_year: int | None = None
    end_year: int | None = None
    grade: str | None = None


class Certification(BaseModel):
    name: str
    issuer: str | None = None
    status: Literal["completed", "in_progress", "planned"]
    year: int | None = None


class PersonalInfo(BaseModel):
    name: str
    headline: str | None = None
    email: str | None = None
    phone: str | None = None
    location: str | None = None
    linkedin: str | None = None
    github: str | None = None


class Target(BaseModel):
    primary_role: str
    secondary_roles: list[str] = Field(default_factory=list)
    seniority: str = Field(description="e.g. junior, mid, senior")


class Profile(BaseModel):
    personal_info: PersonalInfo
    target: Target
    summary: str = Field(description="2-4 sentence professional summary written for the target role")
    skills: list[Skill]
    experience: list[Experience]
    projects: list[Project]
    education: list[Education]
    certifications: list[Certification]
    risk_flags: list[str] = Field(
        default_factory=list,
        description="Things a recruiter will probe: employment gaps, title/target mismatch, skills claimed without evidence",
    )
    updated_at: str = Field(default_factory=lambda: date.today().isoformat())

    # --- convenience accessors used across the app ---
    def skill_names(self) -> set[str]:
        return {s.name for s in self.skills}

    def skills_by_proficiency(self, *levels: Proficiency) -> list[Skill]:
        return [s for s in self.skills if s.proficiency in levels]

    def total_experience_years(self) -> float:
        months = 0
        for e in self.experience:
            sy, sm = map(int, e.start.split("-"))
            ey, em = map(int, (e.end or date.today().strftime("%Y-%m")).split("-"))
            months += (ey - sy) * 12 + (em - sm)
        return round(months / 12, 1)


# ---------------------------------------------------------------------------
# GitHub -> profile evidence
# ---------------------------------------------------------------------------


class SkillEvidence(BaseModel):
    name: str = Field(description="Canonical skill name; reuse the profile's existing name when the skill exists")
    category: SkillCategory
    proficiency: Literal["familiar", "hands_on"] = Field(description="What the repos prove; never 'expert'")
    evidence: list[str] = Field(description="One sentence per repo that proves it, starting with the repo name")


class GitHubMerge(BaseModel):
    skills: list[SkillEvidence] = Field(description="Skills the repositories prove, existing or new")
    projects: list[Project] = Field(description="One per repository that contains code")
    notes: list[str] = Field(default_factory=list, description="Anything notable a recruiter would see on this GitHub, good or bad")


# ---------------------------------------------------------------------------
# Job descriptions and matching
# ---------------------------------------------------------------------------

Importance = Literal["must_have", "nice_to_have"]
MatchStrength = Literal["strong", "partial", "none"]


class Requirement(BaseModel):
    skill: str = Field(description="Canonical skill/technology/competency name, e.g. 'Apache Airflow', 'SQL', 'AWS Glue'")
    importance: Importance
    category: SkillCategory
    context: str = Field(description="How the JD frames it, in a few words")


class JobAnalysis(BaseModel):
    company: str | None = None
    title: str
    seniority: str = Field(description="junior / mid / senior / lead, inferred from years and language")
    years_required: int | None = Field(default=None, description="Minimum years of experience if stated")
    location: str | None = None
    summary: str = Field(description="Two sentences: what this role actually does day to day")
    requirements: list[Requirement]
    red_flags: list[str] = Field(default_factory=list, description="Anything concerning about the posting itself")


class RequirementMatch(BaseModel):
    skill: str = Field(description="Must match a Requirement.skill from the job analysis exactly")
    importance: Importance
    strength: MatchStrength = Field(
        description="'strong' = hands-on/expert evidence in profile; 'partial' = familiar/learning or adjacent "
        "experience; 'none' = nothing in the profile supports it"
    )
    evidence: str = Field(description="The specific profile fact that supports the match, or why it is a gap")
    how_to_close: str | None = Field(default=None, description="For partial/none: the fastest credible way to close this gap")


class MatchResult(BaseModel):
    matches: list[RequirementMatch]
    verdict: str = Field(description="One honest paragraph: should they apply, and what to lead with")
    top_gaps: list[str] = Field(description="The 3-5 gaps that matter most, most important first")

    # Deterministic score computed from the per-requirement judgments (not chosen by the model).
    WEIGHTS: ClassVar[dict] = {"must_have": 3.0, "nice_to_have": 1.0}
    STRENGTH: ClassVar[dict] = {"strong": 1.0, "partial": 0.5, "none": 0.0}

    def score(self) -> float:
        total = sum(self.WEIGHTS[m.importance] for m in self.matches)
        if not total:
            return 0.0
        got = sum(self.WEIGHTS[m.importance] * self.STRENGTH[m.strength] for m in self.matches)
        return round(100 * got / total, 1)

    def by_strength(self, strength: MatchStrength) -> list[RequirementMatch]:
        return [m for m in self.matches if m.strength == strength]


class TailoredBullet(BaseModel):
    original: str
    rewritten: str
    why: str = Field(description="Which JD requirement this now speaks to")


class TailoredOutput(BaseModel):
    summary: str = Field(description="3-4 sentence professional summary rewritten for this specific job")
    bullets: list[TailoredBullet]
    keywords_added: list[str] = Field(description="JD terms now present in the tailored text that were missing before")
    cover_letter: str = Field(description="Under 250 words, specific to this company and role, no clichés")
    honesty_notes: list[str] = Field(
        default_factory=list,
        description="Anything the candidate should NOT claim even though the JD asks for it, and why",
    )


# ---------------------------------------------------------------------------
# Interview practice
# ---------------------------------------------------------------------------

class MCQ(BaseModel):
    topic: str
    difficulty: Literal["core", "deep"]
    question: str
    options: list[str] = Field(min_length=4, max_length=4)
    answer_index: int = Field(ge=0, le=3)
    explanation: str


class MCQSet(BaseModel):
    questions: list[MCQ]


# ---------------------------------------------------------------------------
# Learning
# ---------------------------------------------------------------------------

class Resource(BaseModel):
    title: str
    url: str
    kind: Literal["official_docs", "course", "video", "article", "hands_on_lab", "book"]
    why: str = Field(description="One line: why this one, for this candidate")


class ResourceList(BaseModel):
    resources: list[Resource]


class LearningStep(BaseModel):
    title: str
    kind: Literal["read", "watch", "build", "practice"]
    hours: float
    done: bool = False


class SkillPlan(BaseModel):
    skill: str
    why: str = Field(description="Which JDs/gap pressure make this matter, one line")
    from_proficiency: Proficiency
    to_proficiency: Proficiency
    steps: list[LearningStep]
    proof: str = Field(description="The concrete artifact that will let the profile claim this skill as hands_on")

    @property
    def hours(self) -> float:
        return sum(s.hours for s in self.steps)

    @property
    def progress(self) -> float:
        return round(100 * sum(s.done for s in self.steps) / len(self.steps)) if self.steps else 0.0


class PortfolioProject(BaseModel):
    name: str
    pitch: str = Field(description="Two sentences you could say in an interview")
    skills_covered: list[str]
    milestones: list[LearningStep]
    repo_structure: list[str] = Field(description="Top-level files/dirs the repo should have")


class LearningPlan(BaseModel):
    generated_at: str
    portfolio_project: PortfolioProject
    skills: list[SkillPlan]
    weekly_hours_assumed: int
    weeks_to_complete: int
