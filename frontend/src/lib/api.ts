export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: { "Content-Type": "application/json" }, ...init });
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).detail ?? msg; } catch {}
    throw new ApiError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  get: <T>(p: string) => request<T>(p),
  post: <T>(p: string, body?: unknown) => request<T>(p, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) }),
  put: <T>(p: string, body: unknown) => request<T>(p, { method: "PUT", body: JSON.stringify(body) }),
  patch: <T>(p: string, body: unknown) => request<T>(p, { method: "PATCH", body: JSON.stringify(body) }),
  del: <T>(p: string) => request<T>(p, { method: "DELETE" }),
};

/** Read a text/event-stream POST response chunk by chunk. */
export async function streamSSE(path: string, body: unknown, onChunk: (text: string) => void): Promise<void> {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok || !res.body) throw new ApiError(res.status, res.statusText);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const frame = buf.slice(0, idx); buf = buf.slice(idx + 2);
      if (frame.startsWith("event: done")) return;
      const line = frame.split("\n").find((l) => l.startsWith("data: "));
      if (line) onChunk(JSON.parse(line.slice(6)));
    }
  }
}

// ---------------------------------------------------------------- types (mirror app/core/models.py)
export type Proficiency = "learning" | "familiar" | "hands_on" | "expert";
export interface Skill { name: string; category: string; proficiency: Proficiency; evidence: string[] }
export interface Experience { company: string; title: string; location?: string | null; employment_type?: string | null; start: string; end?: string | null; bullets: string[]; technologies: string[] }
export interface Project { name: string; description: string; technologies: string[]; outcomes: string[]; url?: string | null }
export interface Profile {
  personal_info: { name: string; headline?: string | null; email?: string | null; phone?: string | null; location?: string | null; linkedin?: string | null; github?: string | null };
  target: { primary_role: string; secondary_roles: string[]; seniority: string };
  summary: string; skills: Skill[]; experience: Experience[]; projects: Project[];
  education: { institution: string; degree: string; field?: string | null; start_year?: number | null; end_year?: number | null; grade?: string | null }[];
  certifications: { name: string; issuer?: string | null; status: string; year?: number | null }[];
  courses: { name: string; provider?: string | null; year?: number | null; url?: string | null; project?: string | null }[];
  risk_flags: string[]; updated_at: string;
  years: number; hands_on: number; learning: number;
}
export interface Requirement { skill: string; importance: "must_have" | "nice_to_have"; category: string; context: string }
export interface JobAnalysis { company?: string | null; title: string; seniority: string; years_required?: number | null; location?: string | null; summary: string; requirements: Requirement[]; red_flags: string[] }
export interface RequirementMatch { skill: string; importance: "must_have" | "nice_to_have"; strength: "strong" | "partial" | "none"; evidence: string; how_to_close?: string | null }
export interface MatchResult { matches: RequirementMatch[]; verdict: string; top_gaps: string[]; score: number }
export interface TailoredOutput { summary: string; bullets: { original: string; rewritten: string; why: string }[]; keywords_added: string[]; cover_letter: string; honesty_notes: string[] }
export interface Application { id: number; company?: string | null; title: string; url?: string | null; status: string; match_score: number; notes: string; created_at: string; updated_at: string; applied_at?: string | null; jd_text: string; job: JobAnalysis; match: MatchResult; tailored?: TailoredOutput | null }
export interface Gap { skill: string; jobs: number; must_have: number; strong: number; partial: number; none: number; pressure: number; coverage: number }
export interface MCQ { topic: string; difficulty: "core" | "deep"; question: string; options: string[]; answer_index: number; explanation: string }
export interface LearningStep { title: string; kind: string; hours: number; done: boolean }
export interface SkillPlan { skill: string; why: string; from_proficiency: Proficiency; to_proficiency: Proficiency; steps: LearningStep[]; proof: string; hours: number; progress: number }
export interface LearningPlan { generated_at: string; portfolio_project: { name: string; pitch: string; skills_covered: string[]; milestones: LearningStep[]; repo_structure: string[] }; skills: SkillPlan[]; weekly_hours_assumed: number; weeks_to_complete: number }
export interface Resource { title: string; url: string; kind: string; why: string }
export interface Analytics {
  kpis: { tracked: number; applied: number; response_rate: number | null; avg_score_applied: number | null; avg_score_rejected: number | null; interviews: number; mcq_accuracy: number | null; mcq_answered: number };
  weekly: { week: string; activity: string; count: number }[];
  funnel: { stage: string; count: number }[];
  scores: { application: string; status: string; score: number }[];
  mcq_trend: { week: string; accuracy: number; answered: number }[];
}
export interface GitHubRepo { name: string; full_name: string; url: string; description?: string | null; private: boolean; primary_language?: string | null; languages: Record<string, number>; topics: string[]; stars: number; created_at: string; pushed_at: string; commits?: number | null; top_files: string[]; has_code: boolean }
export interface GitHubSnapshot { username: string; fetched_at: string; merged_at?: string | null; notes: string[]; repos: GitHubRepo[] }
export interface GitHubStatus { username?: string | null; snapshot?: GitHubSnapshot | null }
export interface GitHubSyncResult { snapshot: GitHubSnapshot; changes: { skill: string; from?: Proficiency | null; to: Proficiency }[]; profile: Profile }
export interface InterviewRecord { id: number; created_at: string; summary?: string | null; title?: string | null; company?: string | null; transcript: { role: string; content: string }[] }
