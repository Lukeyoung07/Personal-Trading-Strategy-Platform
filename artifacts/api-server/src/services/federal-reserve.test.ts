import { afterEach, describe, expect, it, vi } from "vitest";
import { federalReserveProvider } from "./federal-reserve";

describe("Federal Reserve public calendar adapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("normalizes official date-only FOMC meetings without inventing time or market data", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () => `
        <h4><a id="42828">2026 FOMC Meetings</a></h4>
        <div class="row fomc-meeting">
          <div class="fomc-meeting__month"><strong>September</strong></div>
          <div class="fomc-meeting__date">15-16*</div>
        </div>
      `,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const events = await federalReserveProvider.fetchEvents(
      new Date("2026-09-01T00:00:00Z"),
      new Date("2026-09-30T00:00:00Z"),
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      providerKey: "federal-reserve-fomc",
      providerEventId: "2026-09-15",
      name: "Federal Open Market Committee meeting",
      scheduledAt: new Date("2026-09-15T00:00:00Z"),
      timePrecision: "date",
      impact: null,
      previous: null,
      forecast: null,
      actual: null,
      sourceName: "Federal Reserve FOMC",
      sourceUrl: "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm",
    });
  });

  it("reports public-source failures instead of presenting an empty success response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 403,
      text: async () => "access denied",
    })));

    await expect(federalReserveProvider.fetchEvents(new Date(), new Date()))
      .rejects.toThrow("Federal Reserve calendar request failed (403).");
  });
});