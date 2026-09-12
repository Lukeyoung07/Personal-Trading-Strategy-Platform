import {
  integer,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  boolean,
  jsonb,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const strategiesTable = pgTable("strategies", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  status: text("status").notNull().default("draft"),
  marketId: integer("market_id").references((): AnyPgColumn => marketsTable.id, { onDelete: "restrict" }),
  assetClass: text("asset_class"),
  direction: text("direction").notNull().default("both"),
  timeframes: text("timeframes").array().notNull().default([]),
  riskManagementRules: text("risk_management_rules"),
  resetRules: text("reset_rules"),
  alertRules: text("alert_rules"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const strategyVersionsTable = pgTable("strategy_versions", {
  id: serial("id").primaryKey(),
  strategyId: integer("strategy_id").notNull().references(() => strategiesTable.id, { onDelete: "cascade" }),
  versionNumber: integer("version_number").notNull(),
  isActive: boolean("is_active").notNull().default(false),
  monitoringEpoch: integer("monitoring_epoch").notNull().default(0),
  label: text("label"),
  name: text("name").notNull().default("Untitled strategy"),
  description: text("description"),
  thesis: text("thesis"),
  entryRules: text("entry_rules"),
  exitRules: text("exit_rules"),
  riskRules: text("risk_rules"),
  notes: text("notes"),
  marketId: integer("market_id").references((): AnyPgColumn => marketsTable.id, { onDelete: "restrict" }),
  marketSymbol: text("market_symbol"),
  assetClass: text("asset_class"),
  direction: text("direction").notNull().default("both"),
  timeframes: text("timeframes").array().notNull().default([]),
  riskManagementRules: text("risk_management_rules"),
  resetRules: text("reset_rules"),
  alertRules: text("alert_rules"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  uniqueIndex("strategy_versions_strategy_number_unique").on(table.strategyId, table.versionNumber),
  uniqueIndex("strategy_versions_one_active_unique").on(table.strategyId).where(sql`${table.isActive} = true`),
]);

export const tradingConceptsTable = pgTable("trading_concepts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category"),
  description: text("description"),
  detectionRules: text("detection_rules"),
  invalidationRules: text("invalidation_rules"),
  isBuiltIn: boolean("is_built_in").notNull().default(false),
  canonicalId: text("canonical_id"),
  registryVersion: text("registry_version"),
  canonicalStatus: text("canonical_status"),
  executorKind: text("executor_kind"),
  aliases: jsonb("aliases"),
  canonicalDefinition: jsonb("canonical_definition"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  uniqueIndex("trading_concepts_canonical_id_unique").on(table.canonicalId),
]);

export const strategyConditionsTable = pgTable("strategy_conditions", {
  id: serial("id").primaryKey(),
  strategyId: integer("strategy_id").notNull().references(() => strategiesTable.id, { onDelete: "cascade" }),
  conceptId: integer("concept_id").notNull().references(() => tradingConceptsTable.id, { onDelete: "restrict" }),
  stage: text("stage").notNull().default("entry"),
  name: text("name").notNull(),
  description: text("description"),
  timeframe: text("timeframe").notNull(),
  direction: text("direction").notNull().default("both"),
  requirement: text("requirement").notNull().default("required"),
  conditionOrder: integer("condition_order").notNull().default(1),
  triggerRules: text("trigger_rules"),
  parameters: jsonb("parameters"),
  canonicalId: text("canonical_id"),
  registryVersion: text("registry_version"),
  canonicalStatus: text("canonical_status"),
  executorKind: text("executor_kind"),
  canonicalDefinition: jsonb("canonical_definition"),
  invalidationRules: text("invalidation_rules"),
  resetBehavior: text("reset_behavior"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const strategyVersionConditionsTable = pgTable("strategy_version_conditions", {
  id: serial("id").primaryKey(),
  strategyVersionId: integer("strategy_version_id").notNull().references(() => strategyVersionsTable.id, { onDelete: "cascade" }),
  conceptId: integer("concept_id").notNull().references(() => tradingConceptsTable.id, { onDelete: "restrict" }),
  conceptName: text("concept_name").notNull().default("Unknown concept"),
  conceptCategory: text("concept_category"),
  conceptDescription: text("concept_description"),
  conceptDetectionRules: text("concept_detection_rules"),
  conceptInvalidationRules: text("concept_invalidation_rules"),
  stage: text("stage").notNull().default("entry"),
  name: text("name").notNull(),
  description: text("description"),
  timeframe: text("timeframe").notNull(),
  direction: text("direction").notNull().default("both"),
  requirement: text("requirement").notNull().default("required"),
  conditionOrder: integer("condition_order").notNull().default(1),
  triggerRules: text("trigger_rules"),
  parameters: jsonb("parameters"),
  canonicalId: text("canonical_id"),
  registryVersion: text("registry_version"),
  canonicalStatus: text("canonical_status"),
  executorKind: text("executor_kind"),
  canonicalDefinition: jsonb("canonical_definition"),
  invalidationRules: text("invalidation_rules"),
  resetBehavior: text("reset_behavior"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const conditionsTable = pgTable("conditions", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  definition: text("definition"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const marketsTable = pgTable("markets", {
  id: serial("id").primaryKey(),
  assetClass: text("asset_class").notNull(),
  instrumentType: text("instrument_type").notNull().default("other"),
  venue: text("venue"),
  symbol: text("symbol").notNull(),
  displayName: text("display_name"),
  baseCurrency: text("base_currency"),
  quoteCurrency: text("quote_currency"),
  exchangeTimezone: text("exchange_timezone"),
  tickSize: numeric("tick_size"),
  contractMultiplier: numeric("contract_multiplier"),
  expiry: text("expiry"),
  isActive: boolean("is_active").notNull().default(true),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

// `markets` is the existing provider-neutral instrument catalog used by
// strategies and trades. This alias gives Step 5 services domain terminology
// without duplicating the catalog or breaking the existing Builder contract.
export const instrumentsTable = marketsTable;

export const marketDataSourcesTable = pgTable("market_data_sources", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  providerKey: text("provider_key"),
  sourceType: text("source_type").notNull().default("other"),
  description: text("description"),
  capabilities: text("capabilities").array().notNull().default([]),
  configurationStatus: text("configuration_status").notNull().default("not_configured"),
  isEnabled: boolean("is_enabled").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, table => [
  uniqueIndex("market_data_sources_name_unique").on(table.name),
]);

export const sourceInstrumentMappingsTable = pgTable("source_instrument_mappings", {
  id: serial("id").primaryKey(),
  sourceId: integer("source_id").notNull().references(() => marketDataSourcesTable.id, { onDelete: "cascade" }),
  instrumentId: integer("instrument_id").notNull().references(() => marketsTable.id, { onDelete: "restrict" }),
  providerSymbol: text("provider_symbol").notNull(),
  providerMetadata: text("provider_metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, table => [
  uniqueIndex("source_instrument_mapping_pair_unique").on(table.sourceId, table.instrumentId),
  uniqueIndex("source_instrument_mapping_symbol_unique").on(table.sourceId, table.providerSymbol),
]);

export const timeframesTable = pgTable("timeframes", {
  id: serial("id").primaryKey(),
  code: text("code").notNull(),
  label: text("label").notNull(),
  durationSeconds: integer("duration_seconds").notNull(),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, table => [
  uniqueIndex("timeframes_code_unique").on(table.code),
]);

export const marketDataConnectionsTable = pgTable("market_data_connections", {
  id: serial("id").primaryKey(),
  sourceId: integer("source_id").notNull().references(() => marketDataSourcesTable.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("disconnected"),
  statusMessage: text("status_message"),
  lastConnectedAt: timestamp("last_connected_at", { withTimezone: true }),
  lastDataAt: timestamp("last_data_at", { withTimezone: true }),
  checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, table => [
  uniqueIndex("market_data_connections_source_unique").on(table.sourceId),
]);

export const candlesTable = pgTable("candles", {
  id: serial("id").primaryKey(),
  instrumentId: integer("instrument_id").notNull().references(() => marketsTable.id, { onDelete: "restrict" }),
  sourceId: integer("source_id").notNull().references(() => marketDataSourcesTable.id, { onDelete: "restrict" }),
  timeframeId: integer("timeframe_id").notNull().references(() => timeframesTable.id, { onDelete: "restrict" }),
  openTime: timestamp("open_time", { withTimezone: true }).notNull(),
  closeTime: timestamp("close_time", { withTimezone: true }),
  open: numeric("open").notNull(),
  high: numeric("high").notNull(),
  low: numeric("low").notNull(),
  close: numeric("close").notNull(),
  volume: numeric("volume"),
  isClosed: boolean("is_closed").notNull().default(true),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  uniqueIndex("candles_series_open_unique").on(table.instrumentId, table.sourceId, table.timeframeId, table.openTime),
]);

export const strategyMonitorSessionsTable = pgTable("strategy_monitor_sessions", {
  id: serial("id").primaryKey(),
  strategyId: integer("strategy_id").notNull().references(() => strategiesTable.id, { onDelete: "cascade" }),
  strategyVersionId: integer("strategy_version_id").notNull().references(() => strategyVersionsTable.id, { onDelete: "cascade" }),
  instrumentId: integer("instrument_id").references(() => marketsTable.id, { onDelete: "restrict" }),
  sourceId: integer("source_id").references(() => marketDataSourcesTable.id, { onDelete: "restrict" }),
  monitoringStatus: text("monitoring_status").notNull().default("waiting"),
  overallStatus: text("overall_status").notNull().default("waiting"),
  statusReason: text("status_reason"),
  conditionCount: integer("condition_count").notNull().default(0),
  metCount: integer("met_count").notNull().default(0),
  notMetCount: integer("not_met_count").notNull().default(0),
  waitingCount: integer("waiting_count").notNull().default(0),
  invalidCount: integer("invalid_count").notNull().default(0),
  progressPercent: integer("progress_percent").notNull().default(0),
  lastEvaluationAt: timestamp("last_evaluation_at", { withTimezone: true }),
  lastMarketDataAt: timestamp("last_market_data_at", { withTimezone: true }),
  marketDataState: text("market_data_state").notNull().default("missing"),
  resetStatus: text("reset_status").notNull().default("not_configured"),
  resetReason: text("reset_reason"),
  evaluationRevision: integer("evaluation_revision").notNull().default(0),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, table => [
  uniqueIndex("strategy_monitor_session_version_unique").on(table.strategyVersionId),
]);

export const strategyMonitorConditionStatesTable = pgTable("strategy_monitor_condition_states", {
  id: serial("id").primaryKey(),
  monitorSessionId: integer("monitor_session_id").notNull().references(() => strategyMonitorSessionsTable.id, { onDelete: "cascade" }),
  strategyVersionConditionId: integer("strategy_version_condition_id").notNull().references(() => strategyVersionConditionsTable.id, { onDelete: "restrict" }),
  status: text("status").notNull().default("waiting"),
  reasonCode: text("reason_code"),
  reason: text("reason"),
  timeframeCode: text("timeframe_code").notNull(),
  timeframeId: integer("timeframe_id").references(() => timeframesTable.id, { onDelete: "restrict" }),
  evidence: text("evidence"),
  detectorId: text("detector_id"),
  detectorVersion: text("detector_version"),
  evaluatorState: text("evaluator_state"),
  lastEvaluationAt: timestamp("last_evaluation_at", { withTimezone: true }),
  lastMarketDataAt: timestamp("last_market_data_at", { withTimezone: true }),
  metAt: timestamp("met_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, table => [
  uniqueIndex("strategy_monitor_condition_state_unique").on(table.monitorSessionId, table.strategyVersionConditionId),
]);

export const strategyMonitorTransitionEventsTable = pgTable("strategy_monitor_transition_events", {
  id: serial("id").primaryKey(),
  monitorSessionId: integer("monitor_session_id").references(() => strategyMonitorSessionsTable.id, { onDelete: "set null" }),
  strategyVersionId: integer("strategy_version_id").notNull().references(() => strategyVersionsTable.id, { onDelete: "cascade" }),
  fromOverallStatus: text("from_overall_status"),
  toOverallStatus: text("to_overall_status").notNull(),
  changedConditionIds: integer("changed_condition_ids").array().notNull().default([]),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tradesTable = pgTable("trades", {
  id: serial("id").primaryKey(),
  strategyVersionId: integer("strategy_version_id").notNull().references(() => strategyVersionsTable.id, { onDelete: "restrict" }),
  marketId: integer("market_id").references(() => marketsTable.id, { onDelete: "set null" }),
  side: text("side").notNull(),
  status: text("status").notNull().default("planned"),
  quantity: numeric("quantity"),
  entryPrice: numeric("entry_price"),
  exitPrice: numeric("exit_price"),
  stopLoss: numeric("stop_loss"),
  takeProfit: numeric("take_profit"),
  riskUnit: text("risk_unit"),
  riskAmount: numeric("risk_amount"),
  pnl: numeric("pnl"),
  openedAt: timestamp("opened_at", { withTimezone: true }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  thesis: text("thesis"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const performanceRecordsTable = pgTable("performance_records", {
  id: serial("id").primaryKey(),
  periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
  periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
  tradeCount: integer("trade_count").notNull().default(0),
  netPnl: numeric("net_pnl"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const alertsTable = pgTable("alerts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  marketId: integer("market_id").references(() => marketsTable.id, { onDelete: "set null" }),
  strategyId: integer("strategy_id").references(() => strategiesTable.id, { onDelete: "set null" }),
  monitorSessionId: integer("monitor_session_id").references(() => strategyMonitorSessionsTable.id, { onDelete: "set null" }),
  strategyVersionId: integer("strategy_version_id").references(() => strategyVersionsTable.id, { onDelete: "set null" }),
  transitionEventId: integer("transition_event_id").references(() => strategyMonitorTransitionEventsTable.id, { onDelete: "set null" }),
  conditionId: integer("condition_id").references(() => strategyVersionConditionsTable.id, { onDelete: "set null" }),
  timeframeId: integer("timeframe_id").references(() => timeframesTable.id, { onDelete: "set null" }),
  timeframeCode: text("timeframe_code"),
  direction: text("direction"),
  reasonCode: text("reason_code"),
  reason: text("reason"),
  evidence: text("evidence"),
  triggeringCandleOpenTime: timestamp("triggering_candle_open_time", { withTimezone: true }),
  sourceType: text("source_type").notNull().default("manual"),
  condition: text("condition").notNull(),
  threshold: text("threshold"),
  status: text("status").notNull().default("paused"),
  message: text("message"),
  triggeredAt: timestamp("triggered_at", { withTimezone: true }),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, table => [
  uniqueIndex("alerts_transition_event_unique").on(table.transitionEventId),
]);

export const backtestConfigurationsTable = pgTable("backtest_configurations", {
  id: serial("id").primaryKey(),
  strategyId: integer("strategy_id").notNull().references(() => strategiesTable.id, { onDelete: "cascade" }),
  strategyVersionId: integer("strategy_version_id").notNull().references(() => strategyVersionsTable.id, { onDelete: "cascade" }),
  instrumentId: integer("instrument_id").notNull().references(() => marketsTable.id, { onDelete: "restrict" }),
  timeframeId: integer("timeframe_id").notNull().references(() => timeframesTable.id, { onDelete: "restrict" }),
  preset: text("preset").notNull(),
  startDate: timestamp("start_date", { withTimezone: true }).notNull(),
  endDate: timestamp("end_date", { withTimezone: true }).notNull(),
  status: text("status").notNull().default("configured"),
  candlesProcessed: integer("candles_processed").notNull().default(0),
  tradeCount: integer("trade_count").notNull().default(0),
  progress: jsonb("progress").notNull().default(sql`'{}'::jsonb`),
  resultMessage: text("result_message"),
  executionAssumptions: text("execution_assumptions"),
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const backtestTradesTable = pgTable("backtest_trades", {
  id: serial("id").primaryKey(),
  backtestId: integer("backtest_id").notNull().references(() => backtestConfigurationsTable.id, { onDelete: "cascade" }),
  strategyId: integer("strategy_id").notNull().references(() => strategiesTable.id, { onDelete: "cascade" }),
  strategyVersionId: integer("strategy_version_id").notNull().references(() => strategyVersionsTable.id, { onDelete: "cascade" }),
  instrumentId: integer("instrument_id").notNull().references(() => marketsTable.id, { onDelete: "restrict" }),
  timeframeId: integer("timeframe_id").notNull().references(() => timeframesTable.id, { onDelete: "restrict" }),
  side: text("side").notNull(),
  entryTime: timestamp("entry_time", { withTimezone: true }).notNull(),
  entryPrice: numeric("entry_price").notNull(),
  stopLoss: numeric("stop_loss"),
  takeProfit: numeric("take_profit"),
  exitTime: timestamp("exit_time", { withTimezone: true }).notNull(),
  exitPrice: numeric("exit_price").notNull(),
  pnl: numeric("pnl").notNull(),
  entryReason: text("entry_reason").notNull(),
  exitReason: text("exit_reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const backtestCandlesTable = pgTable("backtest_candles", {
  id: serial("id").primaryKey(),
  backtestId: integer("backtest_id").notNull().references(() => backtestConfigurationsTable.id, { onDelete: "cascade" }),
  sourceId: integer("source_id").notNull().references(() => marketDataSourcesTable.id, { onDelete: "restrict" }),
  instrumentId: integer("instrument_id").notNull().references(() => marketsTable.id, { onDelete: "restrict" }),
  timeframeId: integer("timeframe_id").notNull().references(() => timeframesTable.id, { onDelete: "restrict" }),
  openTime: timestamp("open_time", { withTimezone: true }).notNull(),
  closeTime: timestamp("close_time", { withTimezone: true }),
  open: numeric("open").notNull(),
  high: numeric("high").notNull(),
  low: numeric("low").notNull(),
  close: numeric("close").notNull(),
  volume: numeric("volume"),
  isClosed: boolean("is_closed").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const economicEventsTable = pgTable("economic_events", {
  id: serial("id").primaryKey(),
  providerKey: text("provider_key").notNull(),
  providerEventId: text("provider_event_id"),
  dedupeKey: text("dedupe_key").notNull(),
  name: text("name").notNull(),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
  timePrecision: text("time_precision").notNull().default("datetime"),
  impact: text("impact"),
  applicationImpact: text("application_impact"),
  impactClassificationReason: text("impact_classification_reason"),
  region: text("region"),
  currency: text("currency"),
  previous: text("previous"),
  forecast: text("forecast"),
  actual: text("actual"),
  releaseStatus: text("release_status").notNull().default("upcoming"),
  sourceName: text("source_name"),
  sourceUrl: text("source_url"),
  sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, table => [
  uniqueIndex("economic_events_dedupe_key_unique").on(table.dedupeKey),
  uniqueIndex("economic_events_provider_event_unique").on(table.providerKey, table.providerEventId),
]);

export const economicEventMarketMappingsTable = pgTable("economic_event_market_mappings", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull().references(() => economicEventsTable.id, { onDelete: "cascade" }),
  marketId: integer("market_id").references(() => marketsTable.id, { onDelete: "set null" }),
  marketLabel: text("market_label"),
  impactDirection: text("impact_direction"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, table => [
  uniqueIndex("economic_event_market_mapping_unique").on(table.eventId, table.marketId, table.marketLabel),
]);

export const userSettingsTable = pgTable("user_settings", {
  id: serial("id").primaryKey(),
  timezone: text("timezone").notNull().default("Europe/London"),
  baseCurrency: text("base_currency").notNull().default("GBP"),
  defaultRiskUnit: text("default_risk_unit").notNull().default("percent"),
  compactMode: boolean("compact_mode").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertStrategySchema = createInsertSchema(strategiesTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertStrategyVersionSchema = createInsertSchema(strategyVersionsTable).omit({ id: true, createdAt: true });
export const insertStrategyVersionConditionSchema = createInsertSchema(strategyVersionConditionsTable).omit({ id: true, createdAt: true });
export const insertTradingConceptSchema = createInsertSchema(tradingConceptsTable).omit({ id: true, createdAt: true });
export const insertConditionSchema = createInsertSchema(conditionsTable).omit({ id: true, createdAt: true });
export const insertMarketSchema = createInsertSchema(marketsTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertMarketDataSourceSchema = createInsertSchema(marketDataSourcesTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertSourceInstrumentMappingSchema = createInsertSchema(sourceInstrumentMappingsTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertTimeframeSchema = createInsertSchema(timeframesTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertMarketDataConnectionSchema = createInsertSchema(marketDataConnectionsTable).omit({ id: true, updatedAt: true });
export const insertCandleSchema = createInsertSchema(candlesTable).omit({ id: true, receivedAt: true });
export const insertStrategyMonitorSessionSchema = createInsertSchema(strategyMonitorSessionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertStrategyMonitorConditionStateSchema = createInsertSchema(strategyMonitorConditionStatesTable).omit({ id: true, updatedAt: true });
export const insertStrategyMonitorTransitionEventSchema = createInsertSchema(strategyMonitorTransitionEventsTable).omit({ id: true, occurredAt: true });
export const insertTradeSchema = createInsertSchema(tradesTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertPerformanceRecordSchema = createInsertSchema(performanceRecordsTable).omit({ id: true, createdAt: true });
export const insertAlertSchema = createInsertSchema(alertsTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertBacktestConfigurationSchema = createInsertSchema(backtestConfigurationsTable).omit({ id: true, createdAt: true });
export const insertBacktestTradeSchema = createInsertSchema(backtestTradesTable).omit({ id: true, createdAt: true });
export const insertBacktestCandleSchema = createInsertSchema(backtestCandlesTable).omit({ id: true, createdAt: true });
export const insertEconomicEventSchema = createInsertSchema(economicEventsTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertEconomicEventMarketMappingSchema = createInsertSchema(economicEventMarketMappingsTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertUserSettingsSchema = createInsertSchema(userSettingsTable).omit({ id: true, updatedAt: true });

export type Strategy = typeof strategiesTable.$inferSelect;
export type StrategyVersion = typeof strategyVersionsTable.$inferSelect;
export type StrategyVersionCondition = typeof strategyVersionConditionsTable.$inferSelect;
export type StrategyCondition = typeof strategyConditionsTable.$inferSelect;
export type TradingConcept = typeof tradingConceptsTable.$inferSelect;
export type Condition = typeof conditionsTable.$inferSelect;
export type Market = typeof marketsTable.$inferSelect;
export type Instrument = typeof instrumentsTable.$inferSelect;
export type MarketDataSource = typeof marketDataSourcesTable.$inferSelect;
export type SourceInstrumentMapping = typeof sourceInstrumentMappingsTable.$inferSelect;
export type Timeframe = typeof timeframesTable.$inferSelect;
export type MarketDataConnection = typeof marketDataConnectionsTable.$inferSelect;
export type Candle = typeof candlesTable.$inferSelect;
export type StrategyMonitorSession = typeof strategyMonitorSessionsTable.$inferSelect;
export type StrategyMonitorConditionState = typeof strategyMonitorConditionStatesTable.$inferSelect;
export type StrategyMonitorTransitionEvent = typeof strategyMonitorTransitionEventsTable.$inferSelect;
export type Trade = typeof tradesTable.$inferSelect;
export type PerformanceRecord = typeof performanceRecordsTable.$inferSelect;
export type Alert = typeof alertsTable.$inferSelect;
export type BacktestConfiguration = typeof backtestConfigurationsTable.$inferSelect;
export type BacktestTrade = typeof backtestTradesTable.$inferSelect;
export type BacktestCandle = typeof backtestCandlesTable.$inferSelect;
export type EconomicEvent = typeof economicEventsTable.$inferSelect;
export type EconomicEventMarketMapping = typeof economicEventMarketMappingsTable.$inferSelect;
export type UserSettings = typeof userSettingsTable.$inferSelect;
export type InsertStrategy = z.infer<typeof insertStrategySchema>;
export type InsertStrategyVersion = z.infer<typeof insertStrategyVersionSchema>;
export type InsertStrategyVersionCondition = z.infer<typeof insertStrategyVersionConditionSchema>;
export const insertStrategyConditionSchema = createInsertSchema(strategyConditionsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  canonicalId: true,
  registryVersion: true,
  canonicalStatus: true,
  executorKind: true,
  canonicalDefinition: true,
});
export type InsertStrategyCondition = z.infer<typeof insertStrategyConditionSchema>;
export type InsertTradingConcept = z.infer<typeof insertTradingConceptSchema>;
export type InsertCondition = z.infer<typeof insertConditionSchema>;
export type InsertMarket = z.infer<typeof insertMarketSchema>;
export type InsertMarketDataSource = z.infer<typeof insertMarketDataSourceSchema>;
export type InsertSourceInstrumentMapping = z.infer<typeof insertSourceInstrumentMappingSchema>;
export type InsertTimeframe = z.infer<typeof insertTimeframeSchema>;
export type InsertMarketDataConnection = z.infer<typeof insertMarketDataConnectionSchema>;
export type InsertCandle = z.infer<typeof insertCandleSchema>;
export type InsertStrategyMonitorSession = z.infer<typeof insertStrategyMonitorSessionSchema>;
export type InsertStrategyMonitorConditionState = z.infer<typeof insertStrategyMonitorConditionStateSchema>;
export type InsertStrategyMonitorTransitionEvent = z.infer<typeof insertStrategyMonitorTransitionEventSchema>;
export type InsertTrade = z.infer<typeof insertTradeSchema>;
export type InsertBacktestConfiguration = z.infer<typeof insertBacktestConfigurationSchema>;
export type InsertBacktestTrade = z.infer<typeof insertBacktestTradeSchema>;
export type InsertBacktestCandle = z.infer<typeof insertBacktestCandleSchema>;
export type InsertPerformanceRecord = z.infer<typeof insertPerformanceRecordSchema>;
export type InsertAlert = z.infer<typeof insertAlertSchema>;
export type InsertEconomicEvent = z.infer<typeof insertEconomicEventSchema>;
export type InsertEconomicEventMarketMapping = z.infer<typeof insertEconomicEventMarketMappingSchema>;
export type InsertUserSettings = z.infer<typeof insertUserSettingsSchema>;