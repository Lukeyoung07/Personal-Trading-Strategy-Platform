import { afterEach, describe, expect, it, vi } from "vitest";
import { onsProvider } from "./ons";

describe("ONS public release calendar adapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("normalizes published and upcoming RSS releases without inventing fields", async () => {
    const published = `<?xml version="1.0"?><rss><channel>
      <item>
        <title>GDP monthly estimate, UK: July 2026</title>
        <link>https://www.ons.gov.uk/releases/gdpmonthlyestimateukjuly2026</link>
        <guid>https://www.ons.gov.uk/releases/gdpmonthlyestimateukjuly2026</guid>
        <pubDate>Fri, 04 Sep 2026 06:00:00 +0000</pubDate>
      </item>
    </channel></rss>`;
    const upcoming = `<?xml version="1.0"?><rss><channel>
      <item>
        <title>Consumer price inflation, UK: August 2026</title>
        <link>https://www.ons.gov.uk/releases/cpiukaugust2026</link>
        <guid>https://www.ons.gov.uk/releases/cpiukaugust2026</guid>
        <pubDate>Wed, 16 Sep 2026 06:00:00 +0000</pubDate>
      </item>
    </channel></rss>`;
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(published, { status: 200 }))
      .mockResolvedValueOnce(new Response(upcoming, { status: 200 })));

    const events = await onsProvider.fetchEvents(
      new Date("2026-09-01T00:00:00Z"),
      new Date("2026-09-20T23:59:59Z"),
    );

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      providerKey: "ons-release-calendar",
      name: "GDP monthly estimate, UK: July 2026",
      releaseStatus: "released",
      sourceName: "UK Office for National Statistics",
      sourceUrl: "https://www.ons.gov.uk/releases/gdpmonthlyestimateukjuly2026",
      impact: null,
      previous: null,
      forecast: null,
      actual: null,
      currency: "GBP",
      timePrecision: "datetime",
    });
    expect(events[1].releaseStatus).toBe("upcoming");
    expect(events[1]?.affectedMarkets?.map(market => market.marketLabel)).toEqual([
      "GBP",
      "UK markets",
      "GBP pairs",
      "UK indices",
    ]);
  });

  it("rejects an unavailable RSS source", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("blocked", { status: 403 })));
    await expect(onsProvider.fetchEvents(new Date("2026-09-01"), new Date("2026-09-20")))
      .rejects.toThrow("ONS release calendar request failed (403).");
  });
});