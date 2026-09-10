import { afterEach, describe, expect, it, vi } from "vitest";
import { ecbProvider } from "./ecb";

describe("ECB public calendar adapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("normalizes dated Governing Council entries conservatively", async () => {
    const html = `
      <h4><a id="2026">2026 Meetings</a></h4>
      <dl>
        <dt>10/09/2026</dt>
        <dd>Governing Council of the ECB: monetary policy meeting in Frankfurt (Day 1)</dd>
        <dt>11/09/2026</dt>
        <dd>Governing Council of the ECB: monetary policy meeting in Frankfurt (Day 2), followed by press conference</dd>
      </dl>`;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(html, { status: 200 })));

    const events = await ecbProvider.fetchEvents(
      new Date("2026-09-01T00:00:00Z"),
      new Date("2026-09-20T23:59:59Z"),
    );

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      providerKey: "ecb-governing-council",
      name: "Governing Council of the ECB: monetary policy meeting in Frankfurt (Day 1)",
      timePrecision: "date",
      impact: null,
      previous: null,
      forecast: null,
      actual: null,
      region: "Euro area",
      currency: "EUR",
      sourceName: "European Central Bank",
    });
    expect(events[0]?.affectedMarkets?.map(market => market.marketLabel)).toEqual([
      "EUR",
      "European markets",
      "EUR pairs",
      "European indices",
    ]);
  });

  it("rejects an unexpected public response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>blocked</html>", { status: 200 })));
    await expect(ecbProvider.fetchEvents(new Date("2026-09-01"), new Date("2026-09-20")))
      .rejects.toThrow("ECB calendar returned an unexpected response.");
  });
});