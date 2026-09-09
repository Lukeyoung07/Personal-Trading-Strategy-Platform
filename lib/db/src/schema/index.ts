import {
  integer,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  boolean,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const strategiesTable = pgTable("strategies", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  status: text("status").notNull().default("draft"),
  marketId: integer("market_id"),
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
  label: text("label"),
  name: text("name").notNull().default("Untitled strategy"),
  description: text("description"),
  thesis: text("thesis"),
  entryRules: text("entry_rules"),
  exitRules: text("exit_rules"),
  riskRules: text("risk_rules"),
  notes: text("notes"),
  marketId: integer("market_id"),
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

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
  venue: text("venue"),
  symbol: text("symbol").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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
  condition: text("condition").notNull(),
  threshold: text("threshold"),
  status: text("status").notNull().default("paused"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

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
export const insertMarketSchema = createInsertSchema(marketsTable).omit({ id: true, createdAt: true });
export const insertTradeSchema = createInsertSchema(tradesTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertPerformanceRecordSchema = createInsertSchema(performanceRecordsTable).omit({ id: true, createdAt: true });
export const insertAlertSchema = createInsertSchema(alertsTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertUserSettingsSchema = createInsertSchema(userSettingsTable).omit({ id: true, updatedAt: true });

export type Strategy = typeof strategiesTable.$inferSelect;
export type StrategyVersion = typeof strategyVersionsTable.$inferSelect;
export type StrategyVersionCondition = typeof strategyVersionConditionsTable.$inferSelect;
export type StrategyCondition = typeof strategyConditionsTable.$inferSelect;
export type TradingConcept = typeof tradingConceptsTable.$inferSelect;
export type Condition = typeof conditionsTable.$inferSelect;
export type Market = typeof marketsTable.$inferSelect;
export type Trade = typeof tradesTable.$inferSelect;
export type PerformanceRecord = typeof performanceRecordsTable.$inferSelect;
export type Alert = typeof alertsTable.$inferSelect;
export type UserSettings = typeof userSettingsTable.$inferSelect;
export type InsertStrategy = z.infer<typeof insertStrategySchema>;
export type InsertStrategyVersion = z.infer<typeof insertStrategyVersionSchema>;
export type InsertStrategyVersionCondition = z.infer<typeof insertStrategyVersionConditionSchema>;
export const insertStrategyConditionSchema = createInsertSchema(strategyConditionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertStrategyCondition = z.infer<typeof insertStrategyConditionSchema>;
export type InsertTradingConcept = z.infer<typeof insertTradingConceptSchema>;
export type InsertCondition = z.infer<typeof insertConditionSchema>;
export type InsertMarket = z.infer<typeof insertMarketSchema>;
export type InsertTrade = z.infer<typeof insertTradeSchema>;
export type InsertPerformanceRecord = z.infer<typeof insertPerformanceRecordSchema>;
export type InsertAlert = z.infer<typeof insertAlertSchema>;
export type InsertUserSettings = z.infer<typeof insertUserSettingsSchema>;