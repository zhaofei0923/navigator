export type Basic60Locale = "zh-CN" | "en";

export type Basic60Meta = {
  release_id: "BASIC60-PRIVATE-R1";
  release_profile: "basic60_private";
  formal_gate_status: "pending";
  coverage_level: "Basic";
  as_of: string;
  result_count: number;
  next_cursor?: string | null;
};

export type Basic60Envelope<T> = {
  meta: Basic60Meta;
  data: T;
};

export type Basic60Period = {
  start: string;
  end: string;
  label: string;
};

export type Basic60Metric = {
  metric_code: string;
  label: string;
  value: number | null;
  unit: string;
  period: Basic60Period;
  value_status: string;
  null_reason: string | null;
  quality_status: string;
  freshness_status: string;
};

export type Basic60CountrySummary = {
  code: string;
  iso2: string;
  name_zh: string;
  name_en: string;
  region_code: string;
  coverage_level: "Basic";
  last_reviewed_at: string | null;
  opportunity_level: "pending";
  policy_friendliness_level: "pending";
  risk_assessment_status: "unknown";
  risk_level: null;
  latest_metrics: Basic60Metric[];
};

export type Basic60LocalName = {
  locale: string;
  text: string;
  preferred: boolean;
  translation_status: string;
};

export type Basic60Capital = {
  name: string;
  role: string;
  display_order: number;
  valid_from: string | null;
  valid_to: string | null;
};

export type Basic60Language = {
  code: string;
  name_en: string;
  name_local: string;
  status: string;
};

export type Basic60Currency = {
  code: string;
  name_en: string;
  legal_tender: boolean;
  valid_from: string | null;
  valid_to: string | null;
};

export type Basic60Timezone = {
  iana_code: string;
  primary: boolean;
};

export type Basic60AdminStructure = {
  admin_level: number;
  unit_type: string;
  unit_count: number;
  as_of_year: number;
  status: string;
};

export type Basic60CountryDetail = Basic60CountrySummary & {
  local_names?: Basic60LocalName[] | null;
  capitals?: Basic60Capital[] | null;
  languages?: Basic60Language[] | null;
  currencies?: Basic60Currency[] | null;
  timezones?: Basic60Timezone[] | null;
  admin_structures?: Basic60AdminStructure[] | null;
  macro?: Basic60Metric[] | null;
  energy?: Basic60Metric[] | null;
};

export type Basic60ComparisonCountry = {
  code: string;
  name_zh: string;
  name_en: string;
  metrics: Basic60Metric[];
};

export type Basic60Comparison = {
  countries: Basic60ComparisonCountry[];
  common_metric_codes: string[];
  excluded_metric_codes: string[];
};

export type Basic60ComparisonRequest = {
  country_codes: string[];
  metric_codes?: string[];
  as_of?: string;
};

export type Basic60ErrorEnvelope = {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
};
