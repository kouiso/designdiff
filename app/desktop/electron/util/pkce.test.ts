import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { generateCodeChallenge, generateCodeVerifier, generateState } from "./pkce";

describe("generateCodeVerifier", () => {
  it("generates a base64url string of 43 chars (32 random bytes)", () => {
    const v = generateCodeVerifier();
    expect(v).toMatch(/^[A-Za-z0-9\-_]+$/);
    expect(v.length).toBe(43);
  });

  it("generates a unique value each call", () => {
    const a = generateCodeVerifier();
    const b = generateCodeVerifier();
    expect(a).not.toBe(b);
  });
});

describe("generateCodeChallenge", () => {
  it("returns base64url(sha256(verifier))", () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const expected = createHash("sha256").update(verifier).digest("base64url");
    expect(generateCodeChallenge(verifier)).toBe(expected);
  });

  it("known S256 vector: verifier=abc", () => {
    const challenge = generateCodeChallenge("abc");
    const expected = createHash("sha256").update("abc").digest("base64url");
    expect(challenge).toBe(expected);
    expect(challenge).toMatch(/^[A-Za-z0-9\-_]+$/);
  });

  it("challenge differs from verifier", () => {
    const v = generateCodeVerifier();
    expect(generateCodeChallenge(v)).not.toBe(v);
  });
});

describe("generateState", () => {
  it("generates a hex string of 64 chars (32 bytes)", () => {
    const s = generateState();
    expect(s).toMatch(/^[0-9a-f]{64}$/);
  });

  it("generates a unique value each call", () => {
    const a = generateState();
    const b = generateState();
    expect(a).not.toBe(b);
  });
});
