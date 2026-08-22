export type DemoMeta = {
  data_origin: "synthetic_demo";
  disclaimer: "演示数据 / 非正式结论";
  result_count?: number | null;
};

export type DemoEnvelope<T> = {
  meta: DemoMeta;
  data: T;
};

export type DemoErrorEnvelope = {
  meta?: Partial<DemoMeta>;
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
};

export type CountryScores = {
  market_attractiveness: number;
  policy_certainty: number;
  project_activity: number;
  partner_maturity: number;
  risk_controllability: number;
  readiness?: number;
  opportunity?: number;
  risk?: number;
};

export type CountrySummary = {
  data_origin: "synthetic_demo";
  code: string;
  name_zh: string;
  name_en: string;
  region: string;
  currency: string;
  summary: string;
  scores: CountryScores;
  dimension_deltas: Partial<Record<ScoreDimensionKey, number>>;
};

export type SignalItem = {
  data_origin: "synthetic_demo";
  signal_id: string;
  country_code: string;
  category: string;
  title: string;
  value: number;
  unit: string;
  trend: string;
  confidence: number;
  summary: string;
  occurred_at: string;
  updated_at?: string;
};

export type ReasonItem = {
  data_origin: "synthetic_demo";
  reason_id: string;
  country_code: string;
  kind: string;
  title: string;
  detail: string;
  rank: number;
};

export type ActionItem = {
  data_origin: "synthetic_demo";
  action_id: string;
  country_code: string;
  priority: number;
  title: string;
  detail: string;
  owner_hint: string;
};

export type RiskItem = {
  data_origin: "synthetic_demo";
  risk_id: string;
  country_code: string;
  title: string;
  category: string;
  severity: number;
  likelihood: number;
  detail: string;
  mitigation: string;
};

export type CountryDetail = CountrySummary & {
  signals: SignalItem[];
  reasons: ReasonItem[];
  risks: RiskItem[];
  actions: ActionItem[];
};

export type PolicyItem = {
  data_origin: "synthetic_demo";
  policy_id: string;
  country_code: string;
  title: string;
  category: string;
  status: string;
  published_at: string;
  summary: string;
};

export type OpportunityItem = {
  data_origin: "synthetic_demo";
  opportunity_id: string;
  country_code: string;
  title: string;
  category: string;
  score: number;
  detail: string;
  next_step: string;
};

export type TenderItem = {
  data_origin: "synthetic_demo";
  tender_id: string;
  country_code: string;
  title: string;
  sector: string;
  stage: string;
  budget_min_million: number;
  budget_max_million: number;
  currency: string;
  deadline: string;
  summary: string;
};

export type PartnerItem = {
  data_origin: "synthetic_demo";
  partner_id: string;
  country_code: string;
  name: string;
  partner_type: string;
  capabilities: string[];
  fit_score: number;
  summary: string;
};

export type ComparisonCountry = {
  data_origin: "synthetic_demo";
  rank: number;
  country_code: string;
  name_zh: string;
  scores: CountryScores;
  dimension_deltas: Partial<Record<ScoreDimensionKey, number>>;
  trend: string;
  overall_score: number;
  reason: string;
};

export type ComparisonResult = {
  data_origin: "synthetic_demo";
  comparison_id: string;
  countries: ComparisonCountry[];
  recommendation: string;
  methodology: string;
};

export type DemoInfo = {
  data_origin: "synthetic_demo";
  name: string;
  baseline_decision: string;
  mode: "bounded_internal_demo";
  country_codes: string[];
  external_calls_enabled: false;
  real_data_enabled: false;
};

export type IntelligenceItem = PolicyItem | RiskItem | OpportunityItem | TenderItem | PartnerItem;

export const SCORE_DIMENSIONS = [
  { key: "market_attractiveness", label: "市场吸引力" },
  { key: "policy_certainty", label: "政策确定性" },
  { key: "project_activity", label: "项目活跃度" },
  { key: "partner_maturity", label: "合作伙伴成熟度" },
  { key: "risk_controllability", label: "风险可控性" },
] as const satisfies ReadonlyArray<{ key: keyof CountryScores; label: string }>;

export type ScoreDimensionKey = (typeof SCORE_DIMENSIONS)[number]["key"];
