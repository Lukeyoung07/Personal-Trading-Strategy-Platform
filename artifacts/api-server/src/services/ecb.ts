import type { EconomicEventInput } from "@workspace/api-zod";

const PROVIDER_KEY = "ecb-governing-council";
const PROVIDER_NAME = "European Central Bank";
const SOURCE_URL = "https://www.ecb.europa.eu/press/calendars/mgcgc/html/index.en.html";
const REQUEST_TIMEOUT_MS = 15_000;

function decodeHtml(value: string) {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;|&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function dateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function parseCalendar(html: string, from: Date, to: Date) {
  const events: EconomicEventInput[] = [];
  const meetingPattern = /<dt>\s*(\d{2})\/(\d{2})\/(\d{4})\s*<\/dt>\s*<dd>\s*([\s\S]*?)\s*<\/dd>/gi;
  for (const match of html.matchAll(meetingPattern)) {
    const [, day, month, year, rawName] = match;
    const scheduledAt = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    if (Number.isNaN(scheduledAt.getTime()) || scheduledAt < from || scheduledAt > to) continue;
    const name = decodeHtml(rawName);
    if (!name) continue;

    events.push({
      providerKey: PROVIDER_KEY,
      providerEventId: `${year}-${month}-${day}|${name.toLowerCase()}`,
      name,
      scheduledAt,
      timePrecision: "date",
      impact: null,
      region: "Euro area",
      currency: "EUR",
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
        { marketLabel: "EUR", notes: "Informational currency relevance from the official ECB calendar; not a trading prediction." },
        { marketLabel: "European markets", notes: "Informational relevance from the official ECB calendar; not a trading prediction." },
        { marketLabel: "EUR pairs", notes: "Informational relevance only; not a trading prediction." },
        { marketLabel: "European indices", notes: "Informational relevance only; not a trading prediction." },
      ],
    });
  }
  return events;
}

async function fetchEvents(from: Date, to: Date) {
  const response = await fetch(SOURCE_URL, {
    headers: {
      accept: "text/html",
      "user-agent": "Trading Strategy Platform personal research calendar",
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`ECB calendar request failed (${response.status}).`);
  const html = await response.text();
  if (!html.includes("Governing Council") && !html.includes("General Council")) {
    throw new Error("ECB calendar returned an unexpected response.");
  }
  return parseCalendar(html, from, to);
}

export const ecbProvider = {
  key: PROVIDER_KEY,
  name: PROVIDER_NAME,
  isConfigured: () => true,
  fetchEvents,
} satisfies {
  key: string;
  name: string;
  isConfigured: () => boolean;
  fetchEvents: (from: Date, to: Date) => Promise<EconomicEventInput[]>;
};