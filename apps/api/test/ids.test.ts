import { describe, expect, it } from "vitest";
import { newId, nowIso } from "../src/ids";

describe("newId", () => {
  it("returns 21 URL-safe characters", () => {
    expect(newId()).toMatch(/^[0-9A-Za-z_-]{21}$/);
  });

  it("does not repeat", () => {
    const ids = new Set(Array.from({ length: 10_000 }, () => newId()));
    expect(ids.size).toBe(10_000);
  });
});

describe("nowIso", () => {
  it("returns an ISO-8601 UTC timestamp", () => {
    expect(nowIso()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});
