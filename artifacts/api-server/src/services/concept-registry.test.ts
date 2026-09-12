import { describe, expect, it } from "vitest";
import {
  TRADING_CONCEPT_REGISTRY,
  resolveTradingConcept,
} from "@workspace/api-zod";

describe("canonical trading concept registry", () => {
  it("covers the complete built-in library without duplicate canonical IDs or labels", () => {
    expect(TRADING_CONCEPT_REGISTRY).toHaveLength(130);

    const ids = TRADING_CONCEPT_REGISTRY.map(definition => definition.canonicalId);
    expect(new Set(ids).size).toBe(ids.length);

    const labels = TRADING_CONCEPT_REGISTRY.flatMap(definition => [
      definition.name,
      ...definition.aliases,
    ]).map(label => label.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim());
    const uniqueLabelsWithinDefinitions = TRADING_CONCEPT_REGISTRY.flatMap(definition =>
      [...new Set([definition.name, ...definition.aliases].map(label => label.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()))],
    );
    expect(new Set(uniqueLabelsWithinDefinitions).size).toBe(uniqueLabelsWithinDefinitions.length);
  });

  it("resolves every canonical name and alias to the same immutable definition", () => {
    for (const definition of TRADING_CONCEPT_REGISTRY) {
      expect(resolveTradingConcept(definition.name)?.canonicalId).toBe(definition.canonicalId);
      for (const alias of definition.aliases) {
        expect(resolveTradingConcept(alias)?.canonicalId).toBe(definition.canonicalId);
      }
    }
  });

  it("keeps review-required concepts out of the executable evaluator contract", () => {
    for (const definition of TRADING_CONCEPT_REGISTRY) {
      if (definition.status === "review_required") {
        expect(definition.executorKind).toBeNull();
        expect(definition.evaluatorVersion).toBeNull();
        expect(definition.statusReason).toBeTruthy();
      } else {
        expect(definition.executorKind).not.toBeNull();
        expect(definition.evaluatorVersion).toBe("historical-1");
      }
    }
  });
});