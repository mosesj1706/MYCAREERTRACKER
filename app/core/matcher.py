"""JD analysis, evidence-based matching, and resume tailoring."""
from app.core import llm
from app.core.config import load_prompt
from app.core.models import JobAnalysis, MatchResult, Profile, TailoredOutput
from app.core.text import plain_model


def profile_block(profile: Profile) -> str:
    return f"<candidate_profile>\n{profile.model_dump_json(indent=1)}\n</candidate_profile>"


def analyze_jd(jd_text: str, target_role: str) -> JobAnalysis:
    system = load_prompt("jd_analyzer").format(target_role=target_role)
    return llm.extract(JobAnalysis, user=f"<job_description>\n{jd_text}\n</job_description>", system=system, effort="medium",
                       feature="analyze_jd", tier="basic")


def match(profile: Profile, job: JobAnalysis) -> MatchResult:
    # The profile is the large, stable part - it goes in the cached system block; the JD varies.
    user = f"<job_requirements>\n{job.model_dump_json(indent=1)}\n</job_requirements>"
    return llm.extract(MatchResult, user=user, system=load_prompt("matcher"), cached=profile_block(profile),
                       effort="medium", feature="match")


def tailor(profile: Profile, job: JobAnalysis, result: MatchResult, jd_text: str) -> TailoredOutput:
    user = (
        f"<job_description>\n{jd_text}\n</job_description>\n\n"
        f"<job_analysis>\n{job.model_dump_json(indent=1)}\n</job_analysis>\n\n"
        f"<fit_assessment score={result.score()}>\n{result.model_dump_json(indent=1)}\n</fit_assessment>"
    )
    system = load_prompt("tailor").format(years=profile.total_experience_years())
    out = llm.extract(TailoredOutput, user=user, system=system, cached=profile_block(profile),
                      effort="medium", max_tokens=16000, feature="tailor")
    return plain_model(out)  # this text lands on the resume as written


class ResumeMatcher:
    """Facade kept for the UI; caches nothing itself."""

    def __init__(self, profile: Profile):
        self.profile = profile

    def analyze(self, jd_text: str) -> tuple[JobAnalysis, MatchResult]:
        job = analyze_jd(jd_text, self.profile.target.primary_role)
        return job, match(self.profile, job)

    def tailor(self, job: JobAnalysis, result: MatchResult, jd_text: str) -> TailoredOutput:
        return tailor(self.profile, job, result, jd_text)
