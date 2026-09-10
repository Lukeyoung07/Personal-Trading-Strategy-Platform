import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EconomicCalendar } from "./economic-calendar";

const state = vi.hoisted(() => ({
  providerConnected: false,
  calls: [] as unknown[],
}));

vi.mock("@workspace/api-client-react", () => ({
  getListEconomicEventsQueryKey: (params: unknown) => ["economic-events", params],
  useListEconomicEvents: (params: unknown) => {
    state.calls.push(params);
    return {
      data: state.providerConnected
        ? {
            providerConnected: true,
            providerName: "Test Calendar",
            events: [{
              id: 1,
              providerKey: "test",
              providerEventId: "event-1",
              dedupeKey: "dedupe-1",
              name: "Consumer Price Index",
              scheduledAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
              impact: "high",
              region: "United States",
              currency: "USD",
              previous: "2.4%",
              forecast: "2.5%",
              actual: null,
              releaseStatus: "upcoming",
              sourceUpdatedAt: null,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              affectedMarkets: [{ id: 1, eventId: 1, marketId: null, marketLabel: "USD", impactDirection: "direct", notes: null }],
            }],
          }
        : { providerConnected: false, providerName: null, events: [] },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
  },
}));

beforeEach(() => {
  state.providerConnected = false;
  state.calls.length = 0;
});

afterEach(() => {
  cleanup();
});

describe("EconomicCalendar", () => {
  it("shows the honest no-provider state without sample events", () => {
    render(<EconomicCalendar />);
    expect(screen.getByTestId("empty-economic-provider")).toBeInTheDocument();
    expect(screen.getByText("No economic calendar data is currently connected.")).toBeInTheDocument();
    expect(screen.queryByTestId("list-economic-events")).not.toBeInTheDocument();
  });

  it("filters the connected record and renders impact, values, and reliable timing", async () => {
    state.providerConnected = true;
    render(<EconomicCalendar />);
    expect(screen.getByTestId("text-event-name-1")).toHaveTextContent("Consumer Price Index");
    expect(screen.getByTestId("status-event-impact-1")).toHaveTextContent("high impact");
    expect(screen.getByTestId("text-high-impact-1")).toHaveTextContent("High-impact event");
    expect(screen.getByTestId("text-event-forecast-1")).toHaveTextContent("2.5%");
    expect(screen.getByTestId("text-event-timing-1")).toHaveTextContent(/In|Starting now/);

    fireEvent.click(screen.getAllByTestId("button-calendar-view-upcoming")[0]);
    fireEvent.change(screen.getAllByTestId("input-search-economic-events")[0], { target: { value: "CPI" } });
    await waitFor(() => expect(state.calls).toEqual(expect.arrayContaining([
      expect.objectContaining({ view: "upcoming", search: "CPI" }),
    ])));
  });
});