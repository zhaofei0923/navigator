export const SYNTHETIC_DEMO_RUNTIME_PROFILE = "synthetic_demo";
export const BASIC60_PRIVATE_RUNTIME_PROFILE = "basic60_private";
export const APPROVED_BASIC60_DEMO_RUNTIME_PROFILE = "approved_basic60_demo";

export function currentRuntimeProfile(): string {
  return (
    process.env.NAVIGATOR_RUNTIME_PROFILE?.trim() ||
    SYNTHETIC_DEMO_RUNTIME_PROFILE
  );
}
