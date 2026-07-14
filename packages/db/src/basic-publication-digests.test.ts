import { describe, expect, test } from "vitest";

import {
  equalSha256Hex,
  sha256Hex,
} from "./collection/basic-publication-digests.js";

describe("Basic publication digests", () => {
  test("hashes exact bytes and compares valid hashes in constant time", () => {
    const digest = sha256Hex(new TextEncoder().encode("approved\n"));
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(equalSha256Hex(digest, digest)).toBe(true);
    const changedDigest = `${digest[0] === "0" ? "1" : "0"}${digest.slice(1)}`;
    expect(equalSha256Hex(digest, changedDigest)).toBe(false);
  });

  test.each(["A".repeat(64), "a".repeat(63), "g".repeat(64)])(
    "rejects malformed digest %s",
    (digest) => {
      expect(equalSha256Hex(digest, "a".repeat(64))).toBe(false);
    },
  );
});
