import { afterEach, describe, expect, it, vi } from "vitest";
import { tradingEconomicsProvider } from "./trading-economics";

describe("Trading Economics provider adapter", () => {
  const originalApiKey = process.env.TRADING_ECONOMICS_API_KEY;

  afterEach(() => {
    if (originalApiKey === undefined) delete process.env.TRADING_ECONOMICS_API_KEY;
    else process.env.TRADING_ECONOMICS_API_KEY = originalApiKey;
    vi.unstubAllGlobals();
  });

  it("normalizes genuine provider fields without fabricating missing values", async () => {
    process.env.TRADING_ECONOMICS_API_KEY = "test-key";
    let requestedUrl: unknown;
    const fetchMock = vi.fn(async (input: unknown) => {
      requestedUrl = input;
      return {
      ok: true,
      json: async () => [
        {
          CalendarId: 123,
          Date: "2026-09-11T09:00:00+01:00",
          Country: "United Kingdom",
          Event: "Monthly GDP",
          Actual: null,
          Previous: "0.1%",
          Forecast: "0.2%",
          Importance: 3,
          LastUpdate: "2026-09-10T12:00:00Z",
          Currency: "GBP",
          Ticker: "UKGDP",
        },
        {
          CalendarId: 124,
          Date: "not-a-date",
          Event: "Invalid event",
        },
      ],
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const events = await tradingEconomicsProvider.fetchEvents(
      new Date("2026-09-10T00:00:00Z"),
      new Date("2026-09-12T00:00:00Z"),
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(requestedUrl)).toContain("/calendar/country/All/2026-09-10/2026-09-12");
    expect(events).toEqual([{
      providerKey: "tradingeconomics",
      providerEventId: "123",
      name: "Monthly GDP",
      scheduledAt: new Date("2026-09-11T08:00:00Z"),
      impact: "high",
      region: "United Kingdom",
      currency: "GBP",
      previous: "0.1%",
      forecast: "0.2%",
      actual: null,
      releaseStatus: "upcoming",
      sourceUpdatedAt: new Date("2026-09-10T12:00:00Z"),
      affectedMarkets: [{
        marketLabel: "UKGDP",
        notes: "Provider-supplied market reference",
      }],
    }]);
  });

  it("returns provider errors instead of presenting an empty success response", async () => {
    process.env.TRADING_ECONOMICS_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 429,
      text: async () => "rate limit exceeded",
    })));

    await expect(tradingEconomicsProvider.fetchEvents(new Date(), new Date()))
      .rejects.toThrow("Trading Economics request failed (429): rate limit exceeded");
  });
});