import type { BasicBridgeErrorCode } from "./basic-hermes-llama-contracts.js";

export class BasicCollectionBridgeError extends Error {
  constructor(code: BasicBridgeErrorCode, _ignoredCause?: unknown) {
    super(`P1-6C bridge failed: ${code}`);
    this.name = "BasicCollectionBridgeError";
    Object.setPrototypeOf(this, BasicCollectionBridgeError.prototype);
  }
}
