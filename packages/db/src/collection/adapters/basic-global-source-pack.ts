export const BASIC_GLOBAL_SOURCE_IDS = Object.freeze([
  "ember-electricity",
  "global-solar-atlas",
  "global-wind-atlas",
  "irenastat-capacity",
] as const);

export const BASIC_MANUAL_POLICY_SOURCE_IDS = Object.freeze([
  "iea-policies",
  "rise-policy-review",
] as const);

export function createEmberElectricityRequest(apiKey: string | undefined) {
  if (apiKey === undefined || apiKey.trim() === "") return null;
  return Object.freeze({
    url: "https://api.ember-energy.org/v1/electricity-data/yearly",
    headers: Object.freeze({
      Accept: "application/json",
      "x-api-key": apiKey,
    }),
  });
}
