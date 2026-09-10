import type { EconomicEventInput } from "@workspace/api-zod";

const PROVIDER_KEY = "federal-reserve-fomc";
const PROVIDER_NAME = "Federal Reserve FOMC";
const SOURCE_URL = "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm";
const REQUEST_TIMEOUT_MS = 15_000;

const MONTHS = new Map([
  ["January", 0],
  ["February", 1],
  ["March", 2],
  ["April", 3],
  ["May", 4],
  ["June", 5],
  ["July", 6],
  ["August", 7],
  ["September", 8],
  ["October", 9],
  ["November", 10],
  ["December", 11],
]);

export type EconomicCalendarProvider = {
  key: string;
  name: string;
  isConfigured: () => boolean;
  fetchEvents: (from: Date, to: Date) => Promise<EconomicEventInput[]>;
};

function htmlText(value: string) {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/&ndash;|&#x2013;/g, "-")
    .replace(/&mdash;|&#x2014;/g, "-")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function dateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function parseMeetings(html: string, from: Date, to: Date): EconomicEventInput[] {
  const yearHeadings = [...html.matchAll(/<h4><a id="[^"]+">(\d{4}) FOMC Meetings<\/a><\/h4>/g)]
    .map(match => ({ year: Number(match[1]), index: match.index ?? 0 }));
  const meetings: EconomicEventInput[] = [];
  const meetingPattern = /<div class="(?:fomc-meeting--shaded\s+)?fomc-meeting__month[^>]*><strong>([^<]+)<\/strong><\/div>\s*<div class="fomc-meeting__date[^>]*>([^<]+)<\/div>/g;

  for (const match of html.matchAll(meetingPattern)) {
    const sourceIndex = match.index ?? 0;
    const heading = [...yearHeadings].reverse().find(candidate => candidate.index < sourceIndex);
    const month = htmlText(match[1]);
    const monthIndex = MONTHS.get(month);
    const year = heading?.year;
    const dateText = htmlText(match[2]);
    const firstDay = Number(dateText.match(/\d{1,2}/)?.[0]);
    if (monthIndex === undefined || !year || !Number.isInteger(firstDay)) continue;

    const scheduledAt = new Date(Date.UTC(year, monthIndex, firstDay));
    if (Number.isNaN(scheduledAt.getTime())) continue;
    const scheduledKey = dateKey(scheduledAt);
    if (scheduledKey < dateKey(from) || scheduledKey > dateKey(to)) continue;

    meetings.push({
      providerKey: PROVIDER_KEY,
      providerEventId: `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(firstDay).padStart(2, "0")}`,
      name: "Federal Open Market Committee meeting",
      scheduledAt,
      timePrecision: "date",
      impact: null,
      region: "United States",
      currency: "USD",
      previous: null,
      forecast: null,
      actual: null,
      releaseStatus: scheduledAt.getTime() < Date.UTC(
        new Date().getUTCFullYear(),
        new Date().getUTCMonth(),
        new Date().getUTCDate(),
      ) ? "released" : "upcoming",
      sourceName: PROVIDER_NAME,
      sourceUrl: SOURCE_URL,
      affectedMarkets: [
        { marketLabel: "USD", notes: "Informational currency relevance from the official U.S. monetary-policy calendar; not a trading prediction." },
        { marketLabel: "Gold", notes: "Informational macro relevance; not a trading prediction." },
        { marketLabel: "US indices", notes: "Informational macro relevance; not a trading prediction." },
      ],
    });
  }
  return meetings;
}

async function fetchEvents(from: Date, to: Date) {
  const response = await fetch(SOURCE_URL, {
    headers: {
      accept: "text/html",
      "user-agent": "Trading Strategy Platform personal research calendar",
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Federal Reserve calendar request failed (${response.status}).`);
  }

  const html = await response.text();
  const events = parseMeetings(html, from, to);
  if (!html.includes("FOMC Meetings")) {
    throw new Error("Federal Reserve calendar returned an unexpected response.");
  }
  return events;
}

export const federalReserveProvider: EconomicCalendarProvider = {
  key: PROVIDER_KEY,
  name: PROVIDER_NAME,
  isConfigured: () => true,
  fetchEvents,
};