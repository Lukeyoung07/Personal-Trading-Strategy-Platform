import { describe, expect, it, vi } from "vitest";
import request from "supertest";

const streamQuotes = vi.hoisted(() => vi.fn());

vi.mock("../services/market-data", () => ({
  marketDataService: {
    streamQuotes,
    refreshCandles: vi.fn(),
  },
}));

import app from "../app";

const quote = {
  eventTime: new Date("2026-09-10T02:00:00.000Z"),
  receivedAt: new Date("2026-09-10T02:00:01.000Z"),
  providerEventId: null,
  bid: 1.1,
  ask: 1.2,
  bidSize: null,
  askSize: null,
  last: 1.15,
  lastSize: null,
  marketState: "open" as const,
  stale: false,
  quoteAgeSeconds: 1,
  lastQuoteAt: new Date("2026-09-10T02:00:00.000Z"),
  sourceId: 5,
  instrumentId: 18,
};

describe("market-data SSE quote stream", () => {
  it("propagates genuine normalized quotes and labels only fresh open quotes LIVE", async () => {
    streamQuotes.mockImplementationOnce(async function* () {
      yield quote;
    });

    const response = await request(app)
      .get("/api/market-data/quotes/stream?sourceId=5&instrumentId=18")
      .expect(200);

    expect(response.headers["content-type"]).toMatch(/text\/event-stream/);
    expect(response.text).toContain('event: status\ndata: {"state":"connecting"');
    expect(response.text).toContain(`event: quote\ndata: ${JSON.stringify({ ...quote, eventTime: quote.eventTime.toISOString(), receivedAt: quote.receivedAt.toISOString(), lastQuoteAt: quote.lastQuoteAt.toISOString(), isLive: true })}`);
  });

  it("never labels stale or closed quotes LIVE", async () => {
    streamQuotes.mockImplementationOnce(async function* () {
      yield { ...quote, marketState: "open", stale: true };
      yield { ...quote, marketState: "closed", stale: false };
    });

    const response = await request(app)
      .get("/api/market-data/quotes/stream?sourceId=5&instrumentId=18")
      .expect(200);

    const quoteEvents = response.text.split("event: quote\n").slice(1);
    expect(quoteEvents).toHaveLength(2);
    expect(quoteEvents.every(event => event.includes('"isLive":false'))).toBe(true);
  });

  it("returns a stream error instead of fabricating data when the provider fails", async () => {
    streamQuotes.mockImplementationOnce(async function* () {
      throw new Error("provider disconnected");
    });

    const response = await request(app)
      .get("/api/market-data/quotes/stream?sourceId=5&instrumentId=18")
      .expect(200);

    expect(response.text).toContain('event: error\ndata: {"message":"provider disconnected"}');
    expect(response.text).not.toContain("event: quote");
  });

  it("rejects invalid stream identifiers before contacting the provider", async () => {
    await request(app)
      .get("/api/market-data/quotes/stream?sourceId=0&instrumentId=bad")
      .expect(400);
    expect(streamQuotes).not.toHaveBeenCalled();
  });
});