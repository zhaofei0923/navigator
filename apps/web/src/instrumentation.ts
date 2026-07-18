import { validateWebEnv } from "@navigator/shared-types/env";

export function register(): void {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    validateWebEnv(process.env);
  }
}
