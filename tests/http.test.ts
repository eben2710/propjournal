import { describe, it, expect, beforeAll } from "vitest";
import { originAllowed, parseCookies } from "../lib/http";

beforeAll(() => {
  process.env.APP_URL = "https://propjournal-gray.vercel.app";
});

describe("originAllowed (CSRF guard for mutations)", () => {
  const req = (origin?: string) => ({ headers: origin ? { origin } : {} } as any);

  it("rejects mismatched origins", () => {
    expect(originAllowed(req("https://evil.example.com"))).toBe(false);
    expect(originAllowed(req("https://propjournal-gray.vercel.app.evil.io"))).toBe(false);
  });

  it("accepts the configured origin (with trailing slash tolerance)", () => {
    expect(originAllowed(req("https://propjournal-gray.vercel.app"))).toBe(true);
    expect(originAllowed(req("https://propjournal-gray.vercel.app/"))).toBe(true);
  });

  it("allows missing Origin (native clients) — auth still required", () => {
    expect(originAllowed(req(undefined))).toBe(true);
  });
});

describe("parseCookies", () => {
  it("parses session cookies", () => {
    const cookies = parseCookies({ headers: { cookie: "pj_session=tok123; other=1" } } as any);
    expect(cookies.pj_session).toBe("tok123");
    expect(cookies.other).toBe("1");
  });
});
