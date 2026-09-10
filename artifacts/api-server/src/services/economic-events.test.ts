import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  db,
  economicEventMarketMappingsTable,
  economicEventsTable,
} from "@workspace/db";
import {
  getEconomicEventProviderStatus,
  listEconomicEvents,
  upsertEconomicEvent,
} from "./economic-events";

const providerKey = "test-economic-calendar";

describe("economic events service", () => {
  beforeEach(async () => {
    const existing = await db.select({ id: economicEventsTable.id })
      .from(economicEventsTable)
      .where(eq(economicEventsTable.providerKey, providerKey));
    for (const event of existing) {
      await db.delete(economicEventMarketMappingsTable)
        .where(eq(economicEventMarketMappingsTable.eventId, event.id));
    }
    await db.delete(economicEventsTable).where(eq(economicEventsTable.providerKey, providerKey));
  });

  afterAll(async () => {
    const existing = await db.select({ id: economicEventsTable.id })
      .from(economicEventsTable)
      .where(eq(economicEventsTable.providerKey, providerKey));
    for (const event of existing) {
      await db.delete(economicEventMarketMappingsTable)
        .where(eq(economicEventMarketMappingsTable.eventId, event.id));
    }
    await db.delete(economicEventsTable).where(eq(economicEventsTable.providerKey, providerKey));
  });

  it("reports the configured public provider state", () => {
    expect(getEconomicEventProviderStatus()).toEqual({
      providerConnected: true,
      providerName: "Federal Reserve FOMC, European Central Bank, UK Office for National Statistics",
      message: "Connected sources: Federal Reserve FOMC, European Central Bank, UK Office for National Statistics.",
    });
  });

  it("deduplicates provider events and replaces structured mappings on update", async () => {
    const scheduledAt = new Date(Date.now() + 60 * 60 * 1000);
    const first = await upsertEconomicEvent({
      providerKey,
      providerEventId: "cpi-001",
      name: "Consumer Price Index",
      scheduledAt,
      impact: "medium",
      region: "United States",
      currency: "usd",
      forecast: "2.5%",
      affectedMarkets: [{ marketLabel: "USD", impactDirection: "direct" }],
    });
    const second = await upsertEconomicEvent({
      providerKey,
      providerEventId: "cpi-001",
      name: "Consumer Price Index",
      scheduledAt,
      impact: "high",
      region: "United States",
      currency: "USD",
      actual: "2.7%",
      affectedMarkets: [{ marketLabel: "US Dollar", impactDirection: "direct", notes: "Updated mapping" }],
    });

    expect(second.id).toBe(first.id);
    expect(second.impact).toBe("high");
    expect(second.actual).toBe("2.7%");
    expect(second.currency).toBe("USD");
    expect(second.affectedMarkets).toHaveLength(1);
    expect(second.affectedMarkets[0].marketLabel).toBe("US Dollar");

    const all = await listEconomicEvents({ view: "all", search: "consumer" });
    const testProviderEvents = all.events.filter(event => event.providerKey === providerKey);
    expect(testProviderEvents).toHaveLength(1);
    expect(testProviderEvents[0].id).toBe(first.id);
  });

  it("classifies upcoming and recently released views without fabricating timing", async () => {
    await upsertEconomicEvent({
      providerKey,
      providerEventId: "future-001",
      name: "Future rate decision",
      scheduledAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
      releaseStatus: "upcoming",
    });
    await upsertEconomicEvent({
      providerKey,
      providerEventId: "past-001",
      name: "Released employment report",
      scheduledAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      releaseStatus: "released",
      actual: "148k",
    });
    await upsertEconomicEvent({
      providerKey,
      providerEventId: "date-only-today-001",
      name: "Date-only policy meeting",
      scheduledAt: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate())),
      timePrecision: "date",
      releaseStatus: "upcoming",
    });

    const upcoming = await listEconomicEvents({ view: "upcoming" });
    const released = await listEconomicEvents({ view: "recently_released" });
    expect(upcoming.events.map(event => event.name)).toContain("Future rate decision");
    expect(upcoming.events.map(event => event.name)).toContain("Date-only policy meeting");
    expect(released.events.map(event => event.name)).toContain("Released employment report");
  });
});