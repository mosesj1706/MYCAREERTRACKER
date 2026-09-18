"""JD analysis, evidence-based matching, and resume tailoring."""
from app.core import llm
from app.core.config import load_prompt
from app.core.models import JobAnalysis, MatchResult, Profile, TailoredOutput


def analyze_jd(jd_text: str, target_role: str) -> JobAnalysis:
    system = load_prompt("jd_analyzer").format(target_role=target_role)
    return llm.extract(JobAnalysis, user=f"<job_description>\n{jd_text}\n</job_description>", system=system, effort="medium")


def match(profile: Profile, job: JobAnalysis) -> MatchResult:
    user = (
        f"<candidate_profile>\n{profile.model_dump_json(indent=1)}\n</candidate_profile>\n\n"
        f"<job_requirements>\n{job.model_dump_json(indent=1)}\n</job_requirements>"
    )
    return llm.extract(MatchResult, user=user, system=load_prompt("matcher"), effort="high")


def tailor(profile: Profile, job: JobAnalysis, result: MatchResult, jd_text: str) -> TailoredOutput:
    user = (
        f"<candidate_profile>\n{profile.model_dump_json(indent=1)}\n</candidate_profile>\n\n"
        f"<job_description>\n{jd_text}\n</job_description>\n\n"
        f"<job_analysis>\n{job.model_dump_json(indent=1)}\n</job_analysis>\n\n"
        f"<fit_assessment score={result.score()}>\n{result.model_dump_json(indent=1)}\n</fit_assessment>"
    )
    system = load_prompt("tailor").format(years=profile.total_experience_years())
    return llm.extract(TailoredOutput, user=user, system=system, effort="high", max_tokens=16000)


class ResumeMatcher:
    """Facade kept for the UI; caches nothing itself."""

    def __init__(self, profile: Profile):
        self.profile = profile

    def analyze(self, jd_text: str) -> tuple[JobAnalysis, MatchResult]:
        job = analyze_jd(jd_text, self.profile.target.primary_role)
        return job, match(self.profile, job)

    def tailor(self, job: JobAnalysis, result: MatchResult, jd_text: str) -> TailoredOutput:
        return tailor(self.profile, job, result, jd_text)
