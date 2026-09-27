"""Profession packs: one codebase, two audiences. MCT_PROFESSION picks one at startup.

  tech (default)  Moses's Cloud Data Engineering setup, unchanged
  ot              occupational therapy: clinical skill categories, country licensing routes,
                  documents, CPD log and case studies, cover letters, licensing-exam practice

A pack sets the skill categories, the wording of proficiency levels, which prompts load
(prompts/<pack>/<name>.txt overrides prompts/<name>.txt), which features the UI shows, and its labels.
"""
import os
from dataclasses import asdict, dataclass, field

from app.core import config  # noqa: F401  (loads .env, which may set MCT_PROFESSION)


@dataclass(frozen=True)
class Pack:
    key: str
    app_name: str
    mark: str                               # the wordmark in the app icon
    home_name: str                          # name under the icon on an iPad home screen (keep it short)
    default_role: str
    categories: dict[str, str]              # key -> label, in display order
    resume_category_order: list[str]
    proficiency_labels: dict[str, str]      # internal level -> what this profession calls it
    proficiency_desc: str                   # schema description the model reads
    skill_examples: str
    learned_category: str                   # category for a skill first added via "Mark learned"
    mcq_topics: list[str]
    interview_modes: list[dict]
    features: dict[str, bool]
    credential_issuers: list[str]
    credential_tier_desc: str
    credential_tier_labels: dict[str, str]
    labels: dict[str, str] = field(default_factory=dict)


TECH = Pack(
    key="tech",
    app_name="MYCAREERTRACKER",
    mark="MCT",
    home_name="MCT",
    default_role="Cloud Data Engineer (AWS)",
    categories={"cloud": "Cloud", "data_engineering": "Data engineering", "programming": "Programming", "devops": "DevOps",
                "ml_ai": "ML / AI", "databases": "Databases", "tools": "Tools", "soft": "Soft skills"},
    resume_category_order=["cloud", "data_engineering", "programming", "ml_ai", "databases", "devops", "tools"],
    proficiency_labels={"learning": "Learning", "familiar": "Familiar", "hands_on": "Hands-on", "expert": "Expert"},
    proficiency_desc="'learning' = self-described as learning / no evidence; 'familiar' = used lightly or in coursework; "
                     "'hands_on' = used in a job or substantial project; 'expert' = deep, repeated production use",
    skill_examples="e.g. 'AWS Lambda', 'Python', 'Terraform'",
    learned_category="data_engineering",
    mcq_topics=["AWS", "SQL", "Python", "Apache Airflow"],
    interview_modes=[
        {"value": "mixed", "label": "Mixed — includes your risk flags"},
        {"value": "technical", "label": "Technical deep-dive"},
        {"value": "behavioral", "label": "Behavioral (STAR)"},
        {"value": "project", "label": "Project deep-dive — defend one of your repos"},
    ],
    features={"github": True, "edit_json": True, "countries": False, "documents": False, "cpd": False, "cover_letters": False},
    credential_issuers=[
        "skillbuilder.aws", "aws.amazon.com/training", "aws.amazon.com/education/awseducate", "databricks.com/learn",
        "learn.getdbt.com", "academy.astronomer.io", "learn.snowflake.com", "developer.confluent.io", "kaggle.com/learn",
        "freecodecamp.org/learn", "learn.microsoft.com", "cloudskillsboost.google", "learn.mongodb.com", "hackerrank.com/skills-verification",
    ],
    credential_tier_desc="vendor = the company whose product it is (AWS, Databricks, dbt Labs, Astronomer, Snowflake, Confluent, MongoDB); "
                         "platform = a major learning platform (Kaggle, freeCodeCamp, Microsoft Learn, Google Cloud Skills Boost, HackerRank); other = anything else",
    credential_tier_labels={"vendor": "vendor credential", "platform": "major platform", "other": "unrecognised issuer"},
    labels={
        "portfolio_project": "Portfolio project",
        "portfolio_structure": "Suggested repo structure",
        "learned_placeholder": "Evidence — what you built (this goes on your profile). e.g. Glue PySpark job writing partitioned Parquet; repo github.com/…",
        "projects": "Projects",
        "probe": "What a recruiter will probe",
        "interviewer": "A recruiter who has read your profile, the job, and your gaps — and goes straight for them.",
        "mcq_tab": "Quick-fire MCQs",
        "credentials_intro": "Courses and assessments that are free end to end and issue a badge or certificate from the vendor or a major platform.",
    },
)

OT = Pack(
    key="ot",
    app_name="MED Career Tracker",
    mark="MED",
    home_name="MED Tracker",
    default_role="Occupational Therapist, Neuro Rehab",
    categories={"assessments": "Assessments & outcome measures", "interventions": "Interventions & techniques",
                "populations": "Client populations", "settings": "Practice settings",
                "assistive_tech": "Assistive tech & home modification", "documentation": "Documentation & frameworks",
                "credentials": "Licences & certifications", "soft": "Professional skills"},
    resume_category_order=["populations", "assessments", "interventions", "assistive_tech", "documentation", "settings", "credentials"],
    proficiency_labels={"learning": "Exposure", "familiar": "Supervised", "hands_on": "Independent", "expert": "Advanced"},
    proficiency_desc="'learning' = exposure only: observed, studied, or self-described as learning; 'familiar' = practised under "
                     "supervision (internship, clinical placement, a course with a practical component); 'hands_on' = practised "
                     "independently in a paid clinical job; 'expert' = advanced: specialist training plus repeated independent "
                     "practice, or supervises and teaches others in it",
    skill_examples="e.g. 'Fugl-Meyer Assessment', 'Constraint-Induced Movement Therapy', 'Stroke rehabilitation'",
    learned_category="interventions",
    mcq_topics=["Neurological rehabilitation", "Orthopaedics & hand therapy", "Paediatrics & sensory integration", "Mental health",
                "Geriatrics & dementia", "ADLs & assistive technology", "Assessments & outcome measures",
                "Anatomy, kinesiology & neuroanatomy", "Splinting & orthotics", "Wheelchair seating & positioning",
                "Frames of reference & OT models", "Ethics, safety & documentation"],
    interview_modes=[
        {"value": "mixed", "label": "Mixed — HR and clinical, includes your risk flags"},
        {"value": "clinical", "label": "Clinical case scenario"},
        {"value": "behavioral", "label": "Behavioural (STAR)"},
        {"value": "screening", "label": "HR & licence screening"},
        {"value": "case", "label": "Case defence — defend one of your case studies"},
    ],
    features={"github": False, "edit_json": False, "countries": True, "documents": True, "cpd": True, "cover_letters": True},
    credential_issuers=[
        "openwho.org", "e-lfh.org.uk", "physio-pedia.com", "wfot.org", "aota.org", "rcot.co.uk", "otaus.com.au",
        "futurelearn.com", "coursera.org", "edx.org", "alison.com", "cpr.heart.org",
    ],
    credential_tier_desc="vendor = a professional body, health authority or standards body (WHO / OpenWHO, AOTA, RCOT, WFOT, "
                         "Occupational Therapy Australia, a national health service, the American Heart Association for BLS); "
                         "platform = a major learning platform (Coursera, edX, FutureLearn, Physiopedia); other = anything else",
    credential_tier_labels={"vendor": "professional body", "platform": "major platform", "other": "unrecognised issuer"},
    labels={
        "portfolio_project": "CPD focus project",
        "portfolio_structure": "What goes in your portfolio",
        "learned_placeholder": "Evidence — what you did (this goes on your profile). e.g. Completed a CIMT course and ran a 2-week programme with three stroke patients; Fugl-Meyer gains recorded",
        "projects": "Projects & research",
        "probe": "What an interviewer will probe",
        "interviewer": "A hiring panel that has read your profile, the job and your gaps, with clinical cases from your own client groups.",
        "mcq_tab": "Exam practice",
        "credentials_intro": "Courses that are free end to end and issue a certificate from a professional body, health authority or major platform.",
    },
)

PACKS = {"tech": TECH, "ot": OT}
PROFESSION = os.getenv("MCT_PROFESSION", "tech").strip().lower()
if PROFESSION not in PACKS:
    raise RuntimeError(f"MCT_PROFESSION must be one of {', '.join(PACKS)}, got {PROFESSION!r}")
PACK = PACKS[PROFESSION]
CATEGORY_KEYS = tuple(PACK.categories)


def public() -> dict:
    """What the frontend needs to adapt its labels and navigation."""
    return asdict(PACK)
