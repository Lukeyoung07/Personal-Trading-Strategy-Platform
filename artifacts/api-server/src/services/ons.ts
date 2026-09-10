import type { EconomicEventInput } from "@workspace/api-zod";

const PROVIDER_KEY = "ons-release-calendar";
const PROVIDER_NAME = "UK Office for National Statistics";
const BASE_URL = "https://www.ons.gov.uk/releasecalendar";
const REQUEST_TIMEOUT_MS = 15_000;

export type EconomicCalendarProvider = {
  key: string;
  name: string;
  isConfigured: () => boolean;
  fetchEvents: (from: Date, to: Date) => Promise<EconomicEventInput[]>;
};

function decodeXml(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;|&#x27;/g, "'")
    .replace(/&#x2F;|&#47;/g, "/")
    .trim();
}

function tagValue(item: string, tag: string) {
  const match = item.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeXml(match[1]) : null;
}

function dateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function parseFeed(xml: string, releaseStatus: "upcoming" | "released", from: Date, to: Date) {
  const events: EconomicEventInput[] = [];
  for (const itemMatch of xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)) {
    const item = itemMatch[1];
    const title = tagValue(item, "title");
    const scheduledAtValue = tagValue(item, "pubDate");
    const scheduledAt = scheduledAtValue ? new Date(scheduledAtValue) : null;
    const providerEventId = tagValue(item, "guid") ?? tagValue(item, "link");
    const sourceUrl = tagValue(item, "link") ?? BASE_URL;
    if (!title || !scheduledAt || Number.isNaN(scheduledAt.getTime()) || !providerEventId) continue;
    if (scheduledAt < from || scheduledAt > to) continue;

    events.push({
      providerKey: PROVIDER_KEY,
      providerEventId,
      name: title,
      scheduledAt,
      timePrecision: "datetime",
      impact: null,
      region: "United Kingdom",
      currency: "GBP",
      previous: null,
      forecast: null,
      actual: null,
      releaseStatus,
      sourceName: PROVIDER_NAME,
      sourceUrl,
      affectedMarkets: [
        { marketLabel: "GBP", notes: "Informational currency relevance from the official UK release calendar; not a trading prediction." },
        { marketLabel: "UK markets", notes: "Informational relevance from the official UK release calendar; not a trading prediction." },
        { marketLabel: "GBP pairs", notes: "Informational relevance only; not a trading prediction." },
        { marketLabel: "UK indices", notes: "Informational relevance only; not a trading prediction." },
      ],
    });
  }
  return events;
}

async function fetchFeed(url: string) {
  const response = await fetch(url, {
    headers: {
      accept: "application/rss+xml, application/xml, text/xml",
      "user-agent": "Trading Strategy Platform personal research calendar",
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`ONS release calendar request failed (${response.status}).`);
  return response.text();
}

async function fetchEvents(from: Date, to: Date) {
  const query = new URLSearchParams({
    rss: "",
    highlight: "true",
    limit: "100",
    page: "1",
    sort: "date-newest",
  });
  const [published, upcoming] = await Promise.all([
    fetchFeed(`${BASE_URL}?${query}&release-type=type-published`),
    fetchFeed(`${BASE_URL}?${query}&release-type=type-upcoming`),
  ]);
  const events = [
    ...parseFeed(published, "released", from, to),
    ...parseFeed(upcoming, "upcoming", from, to),
  ];
  const unique = new Map(events.map(event => [`${event.providerKey}|${event.providerEventId}`, event]));
  return [...unique.values()].sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
}

export const onsProvider: EconomicCalendarProvider = {
  key: PROVIDER_KEY,
  name: PROVIDER_NAME,
  isConfigured: () => true,
  fetchEvents,
};