import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

/** The active profession pack (app/core/pack.py): labels, categories and which features show. */
export interface Pack {
  key: "tech" | "ot";
  app_name: string;
  mark: string;
  default_role: string;
  categories: Record<string, string>;
  proficiency_labels: Record<"learning" | "familiar" | "hands_on" | "expert", string>;
  mcq_topics: string[];
  interview_modes: { value: string; label: string }[];
  features: { github: boolean; edit_json: boolean; countries: boolean; documents: boolean; cpd: boolean; cover_letters: boolean };
  credential_tier_labels: Record<"vendor" | "platform" | "other", string>;
  labels: Record<string, string>;
}

// Until /api/pack answers, render as the tech pack did before packs existed (no layout jump for Moses).
const FALLBACK: Pack = {
  key: "tech", app_name: "MYCAREERTRACKER", mark: "MCT", default_role: "Cloud Data Engineer (AWS)", categories: {},
  proficiency_labels: { learning: "Learning", familiar: "Familiar", hands_on: "Hands-on", expert: "Expert" },
  mcq_topics: ["AWS", "SQL", "Python", "Apache Airflow"], interview_modes: [],
  features: { github: true, edit_json: true, countries: false, documents: false, cpd: false, cover_letters: false },
  credential_tier_labels: { vendor: "vendor credential", platform: "major platform", other: "unrecognised issuer" }, labels: {},
};

export function usePack(): Pack {
  const q = useQuery({ queryKey: ["pack"], queryFn: () => api.get<Pack>("/api/pack"), staleTime: Infinity });
  return q.data ?? FALLBACK;
}

/** Pack label with a fallback, e.g. label(pack, "projects", "Projects"). */
export const label = (p: Pack, key: string, fallback: string) => p.labels[key] ?? fallback;

/** 🇦🇪 from "AE". */
export const flag = (code: string) => String.fromCodePoint(...[...code.toUpperCase()].map((c) => 127397 + c.charCodeAt(0)));
