import { describe, expect, it } from "vitest";
import { classifyEconomicEventImpact } from "./economic-event-impact";

describe("economic event impact rules", () => {
  it.each([
    ["Federal Open Market Committee meeting", "high", "central-bank-policy-decision"],
    ["ECB monetary policy decision", "high", "central-bank-policy-decision"],
    ["Consumer Price Index", "high", "inflation-release"],
    ["Non-Farm Payrolls", "high", "major-employment-release"],
    ["Core PCE price index", "high", "pce-inflation-release"],
    ["GDP monthly estimate, UK", "high", "gdp-release"],
    ["Retail Sales", "medium", "medium-activity-release"],
    ["Services PMI", "medium", "medium-activity-release"],
    ["Business survey", "low", "minor-survey-or-secondary-indicator"],
  ] as const)("classifies %s as %s using %s", (name, impact, ruleId) => {
    expect(classifyEconomicEventImpact(name)).toMatchObject({ impact, ruleId });
  });

  it("leaves an unknown event unclassified rather than guessing", () => {
    expect(classifyEconomicEventImpact("A special announcement")).toBeNull();
  });
});