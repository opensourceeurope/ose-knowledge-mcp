import { describe, it, expect } from "vitest";
import { isOriginAllowed } from "../src/origin.js";

describe("isOriginAllowed", () => {
  it("allows everything when allowlist is *", () => {
    expect(isOriginAllowed(undefined, "*")).toBe(true);
    expect(isOriginAllowed("https://evil.com", "*")).toBe(true);
  });

  it("allows an exact allowlisted origin", () => {
    expect(isOriginAllowed("https://chat.example.org", "https://chat.example.org")).toBe(true);
  });

  it("supports comma-separated allowlists (with whitespace)", () => {
    const list = "https://a.example.org, https://b.example.org";
    expect(isOriginAllowed("https://a.example.org", list)).toBe(true);
    expect(isOriginAllowed("https://b.example.org", list)).toBe(true);
    expect(isOriginAllowed("https://c.example.org", list)).toBe(false);
  });

  it("rejects a missing Origin when an allowlist is configured", () => {
    expect(isOriginAllowed(undefined, "https://chat.example.org")).toBe(false);
  });

  it("is not bypassable via prefix/suffix tricks", () => {
    const list = "https://chat.example.org";
    expect(isOriginAllowed("https://chat.example.org.evil.com", list)).toBe(false);
    expect(isOriginAllowed("https://evil.com/https://chat.example.org", list)).toBe(false);
    expect(isOriginAllowed("http://chat.example.org", list)).toBe(false); // scheme matters
    expect(isOriginAllowed("https://chat.example.org:8443", list)).toBe(false); // port matters
  });

  it("ignores empty entries from trailing commas", () => {
    expect(isOriginAllowed("", "https://a.example.org,,")).toBe(false);
    expect(isOriginAllowed(undefined, "https://a.example.org,")).toBe(false);
  });
});
