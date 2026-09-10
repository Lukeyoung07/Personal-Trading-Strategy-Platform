import { createHash } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import {
  db,
  economicEventMarketMappingsTable,
  economicEventsTable,
  type EconomicEvent,
  type EconomicEventMarketMapping,
} from "@workspace/db";
import type {
  EconomicEventInput,
  EconomicEventMarketMappingInput,
  EconomicEventUpdate,
  ListEconomicEventsParams,
} from "@workspace/api-zod";
import {
  federalReserveProvider,
  type EconomicCalendarProvider,
} from "./federal-reserve";

const providers = new Map<string, EconomicCalendarProvider>([
  [federalReserveProvider.key, federalReserveProvider],
]);
const PROVIDER_SYNC_TTL_MS = 5 * 60 * 1000;
let lastProviderSyncAt = 0;
let providerSyncPromise: Promise<number> | null = null;

export function getEconomicEventProviderStatus() {
  const provider = providers.values().next().value as EconomicCalendarProvider | undefined;
  if (!provider) {
    return {
      providerConnected: false,
      providerName: null,
      message: "No economic calendar data is currently connected.",
    };
  }
  return {
    providerConnected: true,
    providerName: provider.name,
    message: `${provider.name} economic calendar is connected.`,
  };
}

function stableDedupeKey(input: Pick<EconomicEventInput, "providerKey" | "providerEventId" | "name" | "scheduledAt" | "region" | "currency">) {
  const identity = input.providerEventId
    ? `${input.providerKey.trim().toLowerCase()}|id|${input.providerEventId.trim()}`
    : [
        input.providerKey.trim().toLowerCase(),
        input.name.trim().toLowerCase().replace(/\s+/g, " "),
        input.scheduledAt.toISOString(),
        input.region?.trim().toLowerCase() ?? "",
        input.currency?.trim().toUpperCase() ?? "",
      ].join("|");
  return createHash("sha256").update(identity).digest("hex");
}

type MappingInput = EconomicEventMarketMappingInput;

function normalizeMapping(mapping: MappingInput) {
  return {
    marketId: mapping.marketId ?? null,
    marketLabel: mapping.marketLabel?.trim() || null,
    impactDirection: mapping.impactDirection?.trim() || null,
    notes: mapping.notes?.trim() || null,
  };
}

async function withMappings(event: EconomicEvent, query = db) {
  const affectedMarkets = await query
    .select()
    .from(economicEventMarketMappingsTable)
    .where(eq(economicEventMarketMappingsTable.eventId, event.id))
    .orderBy(asc(economicEventMarketMappingsTable.id));
  return { ...event, affectedMarkets };
}

export async function upsertEconomicEvent(input: EconomicEventInput) {
  const dedupeKey = input.dedupeKey?.trim() || stableDedupeKey(input);
  const event = await db.transaction(async tx => {
    const existing = input.providerEventId
      ? (await tx.select().from(economicEventsTable).where(and(
          eq(economicEventsTable.providerKey, input.providerKey),
          eq(economicEventsTable.providerEventId, input.providerEventId),
        )))[0]
      : (await tx.select().from(economicEventsTable).where(eq(economicEventsTable.dedupeKey, dedupeKey)))[0];

    const values = {
      providerKey: input.providerKey.trim(),
      providerEventId: input.providerEventId?.trim() || null,
      dedupeKey,
      name: input.name.trim(),
      scheduledAt: input.scheduledAt,
      timePrecision: input.timePrecision ?? "datetime",
      impact: input.impact ?? null,
      region: input.region?.trim() || null,
      currency: input.currency?.trim().toUpperCase() || null,
      previous: input.previous ?? null,
      forecast: input.forecast ?? null,
      actual: input.actual ?? null,
      releaseStatus: input.releaseStatus ?? "upcoming",
      sourceName: input.sourceName?.trim() || null,
      sourceUrl: input.sourceUrl?.trim() || null,
      sourceUpdatedAt: input.sourceUpdatedAt ?? null,
    };
    const [saved] = existing
      ? await tx.update(economicEventsTable).set(values).where(eq(economicEventsTable.id, existing.id)).returning()
      : await tx.insert(economicEventsTable).values(values).returning();

    await tx.delete(economicEventMarketMappingsTable)
      .where(eq(economicEventMarketMappingsTable.eventId, saved.id));
    if (input.affectedMarkets?.length) {
      await tx.insert(economicEventMarketMappingsTable).values(
        input.affectedMarkets.map(mapping => ({
          eventId: saved.id,
          ...normalizeMapping(mapping),
        })),
      );
    }
    return saved;
  });
  return withMappings(event);
}

export async function updateEconomicEvent(eventId: number, input: EconomicEventUpdate) {
  const [updated] = await db.update(economicEventsTable).set({
    providerEventId: input.providerEventId === undefined ? undefined : input.providerEventId?.trim() || null,
    name: input.name?.trim(),
    scheduledAt: input.scheduledAt,
    timePrecision: input.timePrecision,
    impact: input.impact,
    region: input.region === undefined ? undefined : input.region?.trim() || null,
    currency: input.currency === undefined ? undefined : input.currency?.trim().toUpperCase() || null,
    previous: input.previous,
    forecast: input.forecast,
    actual: input.actual,
    releaseStatus: input.releaseStatus,
    sourceName: input.sourceName === undefined ? undefined : input.sourceName?.trim() || null,
    sourceUrl: input.sourceUrl === undefined ? undefined : input.sourceUrl?.trim() || null,
    sourceUpdatedAt: input.sourceUpdatedAt,
  }).where(eq(economicEventsTable.id, eventId)).returning();
  if (!updated) return null;

  if (input.affectedMarkets !== undefined) {
    await db.transaction(async tx => {
      await tx.delete(economicEventMarketMappingsTable)
        .where(eq(economicEventMarketMappingsTable.eventId, eventId));
      if (input.affectedMarkets?.length) {
        await tx.insert(economicEventMarketMappingsTable).values(
          input.affectedMarkets.map(mapping => ({
            eventId,
            ...normalizeMapping(mapping),
          })),
        );
      }
    });
  }
  return withMappings(updated);
}

function configuredProvider() {
  return [...providers.values()].find(provider => provider.isConfigured());
}

export async function refreshEconomicEvents() {
  const provider = configuredProvider();
  if (!provider) return 0;
  if (Date.now() - lastProviderSyncAt < PROVIDER_SYNC_TTL_MS) return 0;
  if (providerSyncPromise) return providerSyncPromise;

  providerSyncPromise = (async () => {
    const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const to = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    const events = await provider.fetchEvents(from, to);
    for (const event of events) {
      await upsertEconomicEvent(event);
    }
    lastProviderSyncAt = Date.now();
    return events.length;
  })();

  try {
    return await providerSyncPromise;
  } finally {
    providerSyncPromise = null;
  }
}

export async function listEconomicEvents(params: ListEconomicEventsParams = {}) {
  const rows = await db.select().from(economicEventsTable).orderBy(asc(economicEventsTable.scheduledAt));
  const events = await Promise.all(rows.map(event => withMappings(event)));
  const now = new Date();
  const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const endOfToday = new Date(startOfToday);
  endOfToday.setUTCDate(endOfToday.getUTCDate() + 1);
  const recentlyReleasedAfter = new Date(now);
  recentlyReleasedAfter.setUTCDate(recentlyReleasedAfter.getUTCDate() - 7);

  const filtered = events.filter(event => {
    const when = event.scheduledAt.getTime();
    const viewMatches =
      !params.view || params.view === "all" ||
      (params.view === "today" && when >= startOfToday.getTime() && when < endOfToday.getTime()) ||
      (params.view === "upcoming" && when >= now.getTime() && ["upcoming", "delayed", "live"].includes(event.releaseStatus)) ||
      (params.view === "recently_released" && event.releaseStatus === "released" && when >= recentlyReleasedAfter.getTime() && when <= now.getTime());
    const search = params.search?.trim().toLowerCase();
    const text = [event.name, event.region, event.currency, ...event.affectedMarkets.map(m => m.marketLabel)]
      .filter(Boolean).join(" ").toLowerCase();
    return viewMatches &&
      (!params.impact || event.impact === params.impact) &&
      (!params.region || event.region?.toLowerCase() === params.region.toLowerCase()) &&
      (!params.currency || event.currency?.toLowerCase() === params.currency.toLowerCase()) &&
      (!params.market || event.affectedMarkets.some(m => m.marketLabel?.toLowerCase().includes(params.market!.toLowerCase()))) &&
      (!search || text.includes(search));
  });
  return {
    ...getEconomicEventProviderStatus(),
    events: filtered,
  };
}