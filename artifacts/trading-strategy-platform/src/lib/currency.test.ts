import { describe, expect, it } from "vitest";
import { formatMoney } from "./currency";

describe("account currency formatting", () => {
  it("formats positive and negative account values as GBP by default", () => {
    expect(formatMoney(92.61)).toBe("£92.61");
    expect(formatMoney(-428.32)).toBe("-£428.32");
  });

  it("supports an explicitly configured future currency without changing the numeric value", () => {
    expect(formatMoney(92.61, "USD")).toContain("92.61");
    expect(formatMoney(92.61, "USD")).not.toContain("£");
  });

  it("keeps missing monetary values blank", () => {
    expect(formatMoney(null)).toBe("—");
    expect(formatMoney(undefined)).toBe("—");
  });
});