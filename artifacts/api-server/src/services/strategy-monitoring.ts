import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  candlesTable,
  db,
  marketDataSourcesTable,
  marketsTable,
  sourceInstrumentMappingsTable,
  strategiesTable,
  strategyMonitorConditionStatesTable,
  strategyMonitorSessionsTable,
  strategyMonitorTransitionEventsTable,
  alertsTable,
  strategyVersionConditionsTable,
  strategyVersionsTable,
  timeframesTable,
  type StrategyVersion,
  type StrategyVersionCondition,
} from "@workspace/db";

export type ConditionEvaluationStatus = "not_met" | "met" | "waiting" | "invalid";
export type MonitoringStatus = "not_started" | "waiting" | "monitoring" | "paused" | "error";

export interface EvaluationCandle {
  id: number;
  openTime: Date;
  closeTime: Date | null;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
  isClosed: boolean;
  receivedAt: Date;
}

export interface DetectorResult {
  status: "met" | "not_met" | "waiting" | "invalid";
  reasonCode: string;
  reason: string;
  evidence?: Record<string, unknown>;
  state?: unknown;
}

export interface ConditionDetector {
  readonly id: string;
  readonly version: string;
  readonly conceptId: number;
  dependencies?(conditionId: number, allConditionIds: readonly number[]): number[];
  requiredCandleCount(): number;
  evaluate(input: {
    condition: {
      id: number;
      conceptId: number;
      timeframe: string;
      direction: string;
      requirement: string;
      order: number;
    };
    candles: readonly EvaluationCandle[];
    dependencyStates: ReadonlyMap<number, ConditionEvaluationStatus>;
    previousStatus: ConditionEvaluationStatus | null;
    previousState: unknown;
    evaluatedAt: Date;
  }): Promise<DetectorResult>;
}

export interface ResetPolicy {
  readonly id: string;
  readonly version: string;
  readonly strategyVersionId: number;
  evaluate(input: {
    strategyVersionId: number;
    conditionResults: ReadonlyArray<{ conditionId: number; status: ConditionEvaluationStatus; state: unknown }>;
    evaluatedAt: Date;
    loadCandles: (timeframeCode: string, limit: number) => Promise<readonly EvaluationCandle[]>;
  }): Promise<{ triggered: boolean; reason: string }>;
}

export interface EvaluatedCondition {
  condition: StrategyVersionCondition;
  timeframeId: number | null;
  status: ConditionEvaluationStatus;
  reasonCode: string;
  reason: string;
  evidence: Record<string, unknown> | null;
  detectorId: string | null;
  detectorVersion: string | null;
  evaluatorState: unknown;
  lastMarketDataAt: Date | null;
}

export interface StrategyMonitorSnapshot {
  monitorSessionId: number | null;
  strategyId: number;
  strategyName: string;
  strategyVersionId: number;
  versionNumber: number;
  instrumentId: number | null;
  instrumentSymbol: string | null;
  sourceId: number | null;
  monitoringStatus: MonitoringStatus;
  overallStatus: ConditionEvaluationStatus;
  statusReason: string | null;
  conditionCount: number;
  metCount: number;
  notMetCount: number;
  waitingCount: number;
  invalidCount: number;
  remainingCount: number;
  progressPercent: number;
  lastEvaluationAt: Date | null;
  lastMarketDataAt: Date | null;
  resetStatus: "not_configured" | "waiting" | "ready";
  resetReason: string | null;
  conditions: Array<{
    strategyVersionConditionId: number;
    conceptId: number;
    conceptName: string;
    conditionOrder: number;
    name: string;
    stage: string;
    requirement: "required" | "optional";
    timeframe: string;
    status: ConditionEvaluationStatus;
    reasonCode: string | null;
    reason: string | null;
    lastEvaluationAt: Date | null;
    lastMarketDataAt: Date | null;
  }>;
}

type ActiveStrategy = {
  strategy: typeof strategiesTable.$inferSelect;
  version: typeof strategyVersionsTable.$inferSelect;
};

type TransitionListener = (snapshot: StrategyMonitorSnapshot) => void | Promise<void>;

export function transitionConditionStatus(
  _previous: ConditionEvaluationStatus | null,
  next: ConditionEvaluationStatus,
  resetTriggered = false,
): ConditionEvaluationStatus {
  return resetTriggered ? "waiting" : next;
}

export class StrategyMonitoringEngine {
  private readonly detectors: ConditionDetector[] = [];
  private readonly resetPolicies: ResetPolicy[] = [];
  private readonly listeners = new Set<TransitionListener>();

  registerDetector(detector: ConditionDetector) {
    if (this.detectors.some(current => current.conceptId === detector.conceptId)) {
      throw new Error(`A condition detector is already registered for concept ${detector.conceptId}`);
    }
    this.detectors.push(detector);
  }

  registerResetPolicy(policy: ResetPolicy) {
    if (this.resetPolicies.some(current => current.id === policy.id && current.version === policy.version)) {
      throw new Error(`Reset policy '${policy.id}@${policy.version}' is already registered`);
    }
    this.resetPolicies.push(policy);
  }

  subscribe(listener: TransitionListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async listActiveMonitors(): Promise<StrategyMonitorSnapshot[]> {
    const active = await this.loadActiveStrategies();
    return Promise.all(active.map(item => this.snapshotFor(item)));
  }

  async evaluateActiveStrategies(input: { strategyId?: number; sourceId?: number | null } = {}) {
    const active = await this.loadActiveStrategies(input.strategyId);
    const snapshots: StrategyMonitorSnapshot[] = [];
    for (const item of active) snapshots.push(await this.evaluateOne(item, input.sourceId ?? null));
    return snapshots;
  }

  private async loadActiveStrategies(strategyId?: number): Promise<ActiveStrategy[]> {
    const filters = [
      eq(strategiesTable.status, "active"),
      eq(strategyVersionsTable.isActive, true),
    ];
    if (strategyId) filters.push(eq(strategiesTable.id, strategyId));
    const rows = await db.select({
      strategy: strategiesTable,
      version: strategyVersionsTable,
    }).from(strategiesTable)
      .innerJoin(strategyVersionsTable, eq(strategyVersionsTable.strategyId, strategiesTable.id))
      .where(and(...filters))
      .orderBy(asc(strategiesTable.name));
    return rows;
  }

  private async snapshotFor(item: ActiveStrategy): Promise<StrategyMonitorSnapshot> {
    const [session] = await db.select().from(strategyMonitorSessionsTable)
      .where(eq(strategyMonitorSessionsTable.strategyVersionId, item.version.id));
    const conditions = await db.select().from(strategyVersionConditionsTable)
      .where(eq(strategyVersionConditionsTable.strategyVersionId, item.version.id))
      .orderBy(asc(strategyVersionConditionsTable.conditionOrder));
    if (!session) return this.notStartedSnapshot(item, conditions);

    const states = await db.select().from(strategyMonitorConditionStatesTable)
      .where(eq(strategyMonitorConditionStatesTable.monitorSessionId, session.id));
    const byCondition = new Map(states.map(state => [state.strategyVersionConditionId, state]));
    return {
      monitorSessionId: session.id,
      strategyId: item.strategy.id,
      strategyName: item.version.name,
      strategyVersionId: item.version.id,
      versionNumber: item.version.versionNumber,
      instrumentId: item.version.marketId,
      instrumentSymbol: item.version.marketSymbol,
      sourceId: session.sourceId,
      monitoringStatus: session.monitoringStatus as MonitoringStatus,
      overallStatus: session.overallStatus as ConditionEvaluationStatus,
      statusReason: session.statusReason,
      conditionCount: session.conditionCount,
      metCount: session.metCount,
      notMetCount: session.notMetCount,
      waitingCount: session.waitingCount,
      invalidCount: session.invalidCount,
      remainingCount: Math.max(0, session.conditionCount - session.metCount),
      progressPercent: session.progressPercent,
      lastEvaluationAt: session.lastEvaluationAt,
      lastMarketDataAt: session.lastMarketDataAt,
      resetStatus: session.resetStatus as StrategyMonitorSnapshot["resetStatus"],
      resetReason: session.resetReason,
      conditions: conditions.map(condition => {
        const state = byCondition.get(condition.id);
        return {
          strategyVersionConditionId: condition.id,
          conceptId: condition.conceptId,
          conceptName: condition.conceptName,
          conditionOrder: condition.conditionOrder,
          name: condition.name,
          stage: condition.stage,
          requirement: condition.requirement as "required" | "optional",
          timeframe: condition.timeframe,
          status: (state?.status ?? "waiting") as ConditionEvaluationStatus,
          reasonCode: state?.reasonCode ?? "NOT_EVALUATED",
          reason: state?.reason ?? "This condition has not been evaluated yet.",
          lastEvaluationAt: state?.lastEvaluationAt ?? null,
          lastMarketDataAt: state?.lastMarketDataAt ?? null,
        };
      }),
    };
  }

  private notStartedSnapshot(item: ActiveStrategy, conditions: StrategyVersionCondition[]): StrategyMonitorSnapshot {
    return {
      monitorSessionId: null,
      strategyId: item.strategy.id,
      strategyName: item.version.name,
      strategyVersionId: item.version.id,
      versionNumber: item.version.versionNumber,
      instrumentId: item.version.marketId,
      instrumentSymbol: item.version.marketSymbol,
      sourceId: null,
      monitoringStatus: "not_started",
      overallStatus: "waiting",
      statusReason: "Evaluation has not run for this active strategy version.",
      conditionCount: conditions.length,
      metCount: 0,
      notMetCount: 0,
      waitingCount: conditions.length,
      invalidCount: 0,
      remainingCount: conditions.length,
      progressPercent: 0,
      lastEvaluationAt: null,
      lastMarketDataAt: null,
      resetStatus: item.version.resetRules?.trim() ? "waiting" : "not_configured",
      resetReason: item.version.resetRules?.trim()
        ? "Reset rules are descriptive and have no registered executable policy."
        : null,
      conditions: conditions.map(condition => ({
        strategyVersionConditionId: condition.id,
        conceptId: condition.conceptId,
        conceptName: condition.conceptName,
        conditionOrder: condition.conditionOrder,
        name: condition.name,
        stage: condition.stage,
        requirement: condition.requirement as "required" | "optional",
        timeframe: condition.timeframe,
        status: "waiting",
        reasonCode: "NOT_EVALUATED",
        reason: "This condition has not been evaluated yet.",
        lastEvaluationAt: null,
        lastMarketDataAt: null,
      })),
    };
  }

  private async evaluateOne(item: ActiveStrategy, requestedSourceId: number | null, attempt = 0): Promise<StrategyMonitorSnapshot> {
    const evaluatedAt = new Date();
    const conditions = await db.select().from(strategyVersionConditionsTable)
      .where(eq(strategyVersionConditionsTable.strategyVersionId, item.version.id))
      .orderBy(asc(strategyVersionConditionsTable.conditionOrder));
    const [existingSession] = await db.select().from(strategyMonitorSessionsTable)
      .where(eq(strategyMonitorSessionsTable.strategyVersionId, item.version.id));
    const previousStates = existingSession
      ? await db.select().from(strategyMonitorConditionStatesTable)
        .where(eq(strategyMonitorConditionStatesTable.monitorSessionId, existingSession.id))
      : [];
    const previousByCondition = new Map(previousStates.map(state => [state.strategyVersionConditionId, state]));
    const timeframes = await db.select().from(timeframesTable).where(eq(timeframesTable.isActive, true));
    const timeframeByName = new Map<string, typeof timeframesTable.$inferSelect>();
    for (const timeframe of timeframes) {
      timeframeByName.set(timeframe.code.trim().toLowerCase(), timeframe);
      timeframeByName.set(timeframe.label.trim().toLowerCase(), timeframe);
    }
    const sourceId = await this.resolveSource(item.version.marketId, requestedSourceId);
    const orderCounts = new Map<number, number>();
    for (const condition of conditions) orderCounts.set(condition.conditionOrder, (orderCounts.get(condition.conditionOrder) ?? 0) + 1);
    const dependenciesByCondition = new Map<number, number[]>();
    const invalidDependencyByCondition = new Map<number, string>();
    for (const condition of conditions) {
      const detector = this.detectors.find(candidate => candidate.conceptId === condition.conceptId);
      const dependencies = detector?.dependencies?.(condition.id, conditions.map(candidate => candidate.id)) ?? [];
      dependenciesByCondition.set(condition.id, dependencies);
      const unique = new Set(dependencies);
      const invalid = dependencies.find(dependencyId => {
        const dependency = conditions.find(candidate => candidate.id === dependencyId);
        return dependencyId === condition.id
          || !dependency
          || dependency.conditionOrder >= condition.conditionOrder;
      });
      if (unique.size !== dependencies.length || invalid != null) {
        invalidDependencyByCondition.set(condition.id, "Dependencies must be unique conditions that appear earlier in saved order; self, forward, missing, and cyclic dependencies are invalid.");
      }
    }

    const results: EvaluatedCondition[] = [];
    const dependencyStates = new Map<number, ConditionEvaluationStatus>();
    const candleCache = new Map<string, Promise<readonly EvaluationCandle[]>>();
    const loadCandles = async (timeframeCode: string, limit: number) => {
      const timeframe = timeframeByName.get(timeframeCode.trim().toLowerCase());
      if (!timeframe || !item.version.marketId || !sourceId) return [];
      const cacheKey = `${timeframe.id}:${limit}`;
      let request = candleCache.get(cacheKey);
      if (!request) {
        request = db.select().from(candlesTable).where(and(
          eq(candlesTable.instrumentId, item.version.marketId),
          eq(candlesTable.sourceId, sourceId),
          eq(candlesTable.timeframeId, timeframe.id),
          eq(candlesTable.isClosed, true),
        )).orderBy(desc(candlesTable.openTime)).limit(limit).then(rows => rows.map(candle => {
          const normalized = {
            ...candle,
            open: Number(candle.open),
            high: Number(candle.high),
            low: Number(candle.low),
            close: Number(candle.close),
            volume: candle.volume == null ? null : Number(candle.volume),
          };
          if (![normalized.open, normalized.high, normalized.low, normalized.close].every(Number.isFinite)
            || (normalized.volume != null && !Number.isFinite(normalized.volume))) {
            throw new Error("Stored market data contains a non-finite numeric value");
          }
          return normalized;
        }).reverse());
        candleCache.set(cacheKey, request);
      }
      return request;
    };

    for (const condition of conditions) {
      const timeframe = timeframeByName.get(condition.timeframe.trim().toLowerCase());
      let result: EvaluatedCondition;
      if (!item.version.marketId) {
        result = this.conditionResult(condition, null, "invalid", "INSTRUMENT_MISSING", "The active version does not reference an instrument.");
      } else if (!condition.name.trim() || !condition.conceptName.trim()) {
        result = this.conditionResult(condition, timeframe?.id ?? null, "invalid", "CONDITION_DEFINITION_MISSING", "The saved condition or concept identity is incomplete.");
      } else if (!["entry", "confirmation", "invalidation", "exit"].includes(condition.stage)
        || !["long", "short", "both"].includes(condition.direction)
        || !["required", "optional"].includes(condition.requirement)
        || condition.conditionOrder < 1
        || (orderCounts.get(condition.conditionOrder) ?? 0) > 1) {
        result = this.conditionResult(condition, timeframe?.id ?? null, "invalid", "CONDITION_STRUCTURE_INVALID", "The saved condition has invalid stage, direction, requirement, or ordering metadata.");
      } else if (!timeframe) {
        result = this.conditionResult(condition, null, "invalid", "TIMEFRAME_UNMAPPED", `No active market-data timeframe matches '${condition.timeframe}'.`);
      } else if (invalidDependencyByCondition.has(condition.id)) {
        result = this.conditionResult(condition, timeframe.id, "invalid", "DEPENDENCY_INVALID", invalidDependencyByCondition.get(condition.id)!);
      } else if (!sourceId) {
        result = this.conditionResult(condition, timeframe.id, "waiting", "MARKET_DATA_SOURCE_UNAVAILABLE", "No single configured source with stored data is available for this instrument.");
      } else {
        const detector = this.detectors.find(candidate => candidate.conceptId === condition.conceptId);
        const requiredCount = Math.max(1, detector?.requiredCandleCount() ?? 1);
        let candles: readonly EvaluationCandle[];
        try {
          candles = await loadCandles(condition.timeframe, requiredCount);
        } catch {
          result = this.conditionResult(condition, timeframe.id, "invalid", "MARKET_DATA_INVALID", "Stored normalized market data is not safe to evaluate.");
          results.push(result);
          dependencyStates.set(condition.id, result.status);
          continue;
        }
        const lastMarketDataAt = candles[candles.length - 1]?.receivedAt ?? null;
        if (candles.length < requiredCount) {
          result = this.conditionResult(condition, timeframe.id, "waiting", "INSUFFICIENT_MARKET_DATA", `This condition needs ${requiredCount} closed candle${requiredCount === 1 ? "" : "s"} on ${condition.timeframe}; ${candles.length} are available.`, null, lastMarketDataAt);
        } else if (!detector) {
          result = this.conditionResult(condition, timeframe.id, "waiting", "EVALUATOR_UNAVAILABLE", "The saved concept and rules are descriptive; no executable detector is registered.", null, lastMarketDataAt);
        } else {
          const dependencies = dependenciesByCondition.get(condition.id) ?? [];
          const waitingDependency = dependencies.find(id => dependencyStates.get(id) !== "met");
          if (waitingDependency) {
            result = this.conditionResult(condition, timeframe.id, "waiting", "DEPENDENCY_WAITING", `Waiting for condition ${waitingDependency} to be met first.`, null, lastMarketDataAt);
          } else {
            const previous = previousByCondition.get(condition.id);
            const detectorResult = await detector.evaluate({
              condition: {
                id: condition.id,
                conceptId: condition.conceptId,
                timeframe: condition.timeframe,
                direction: condition.direction,
                requirement: condition.requirement,
                order: condition.conditionOrder,
              },
              candles,
              dependencyStates,
              previousStatus: (previous?.status as ConditionEvaluationStatus | undefined) ?? null,
              previousState: this.parseState(previous?.evaluatorState),
              evaluatedAt,
            });
            result = this.conditionResult(
              condition,
              timeframe.id,
              transitionConditionStatus((previous?.status as ConditionEvaluationStatus | undefined) ?? null, detectorResult.status),
              detectorResult.reasonCode,
              detectorResult.reason,
              detectorResult.evidence ?? null,
              lastMarketDataAt,
              detector.id,
              detector.version,
              detectorResult.state ?? null,
            );
          }
        }
      }
      results.push(result);
      dependencyStates.set(condition.id, result.status);
    }

    let resetStatus: StrategyMonitorSnapshot["resetStatus"] = "not_configured";
    let resetReason: string | null = null;
    let resetTriggered = false;
    if (item.version.resetRules?.trim()) {
      const policy = this.resetPolicies.find(candidate => candidate.strategyVersionId === item.version.id);
      if (!policy) {
        resetStatus = "waiting";
        resetReason = "Reset rules are descriptive and have no registered executable policy.";
      } else {
        const reset = await policy.evaluate({
          strategyVersionId: item.version.id,
          conditionResults: results.map(result => ({
            conditionId: result.condition.id,
            status: result.status,
            state: result.evaluatorState,
          })),
          evaluatedAt,
          loadCandles,
        });
        resetStatus = "ready";
        resetReason = reset.reason;
        resetTriggered = reset.triggered;
      }
    }
    if (resetTriggered) {
      for (const result of results) {
        result.status = transitionConditionStatus(result.status, result.status, true);
        result.reasonCode = "RESET_TRIGGERED";
        result.reason = resetReason ?? "The registered reset policy reset condition progress.";
        result.evidence = null;
        result.evaluatorState = null;
      }
    }

    const summary = this.summarize(results, conditions);
    let changed = false;
    const persisted = await db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(${item.strategy.id})`);
      const [activeGuard] = await tx.select({
        id: strategyVersionsTable.id,
        monitoringEpoch: strategyVersionsTable.monitoringEpoch,
      })
        .from(strategyVersionsTable)
        .innerJoin(strategiesTable, eq(strategiesTable.id, strategyVersionsTable.strategyId))
        .where(and(
          eq(strategyVersionsTable.id, item.version.id),
          eq(strategyVersionsTable.isActive, true),
          eq(strategiesTable.status, "active"),
        ));
      if (!activeGuard || activeGuard.monitoringEpoch !== item.version.monitoringEpoch) return false;

      const [currentSession] = await tx.select().from(strategyMonitorSessionsTable)
        .where(eq(strategyMonitorSessionsTable.strategyVersionId, item.version.id));
      if ((currentSession?.evaluationRevision ?? null) !== (existingSession?.evaluationRevision ?? null)) {
        return false;
      }
      const sessionChanged = !currentSession
        || currentSession.instrumentId !== item.version.marketId
        || currentSession.sourceId !== sourceId
        || currentSession.monitoringStatus !== summary.monitoringStatus
        || currentSession.overallStatus !== summary.overallStatus
        || currentSession.statusReason !== summary.statusReason
        || currentSession.conditionCount !== results.length
        || currentSession.metCount !== summary.metCount
        || currentSession.notMetCount !== summary.notMetCount
        || currentSession.waitingCount !== summary.waitingCount
        || currentSession.invalidCount !== summary.invalidCount
        || currentSession.progressPercent !== summary.progressPercent
        || currentSession.lastMarketDataAt?.getTime() !== summary.lastMarketDataAt?.getTime()
        || currentSession.resetStatus !== resetStatus
        || currentSession.resetReason !== resetReason;
      let session = currentSession;
      if (!session) {
        [session] = await tx.insert(strategyMonitorSessionsTable).values({
          strategyId: item.strategy.id,
          strategyVersionId: item.version.id,
          instrumentId: item.version.marketId,
          sourceId,
          monitoringStatus: summary.monitoringStatus,
          overallStatus: summary.overallStatus,
          statusReason: summary.statusReason,
          conditionCount: results.length,
          metCount: summary.metCount,
          notMetCount: summary.notMetCount,
          waitingCount: summary.waitingCount,
          invalidCount: summary.invalidCount,
          progressPercent: summary.progressPercent,
          lastEvaluationAt: evaluatedAt,
          lastMarketDataAt: summary.lastMarketDataAt,
          resetStatus,
          resetReason,
          evaluationRevision: 1,
        }).returning();
      } else {
        [session] = await tx.update(strategyMonitorSessionsTable).set({
          instrumentId: item.version.marketId,
          sourceId,
          monitoringStatus: summary.monitoringStatus,
          overallStatus: summary.overallStatus,
          statusReason: summary.statusReason,
          conditionCount: results.length,
          metCount: summary.metCount,
          notMetCount: summary.notMetCount,
          waitingCount: summary.waitingCount,
          invalidCount: summary.invalidCount,
          progressPercent: summary.progressPercent,
          lastEvaluationAt: evaluatedAt,
          lastMarketDataAt: summary.lastMarketDataAt,
          resetStatus,
          resetReason,
          evaluationRevision: currentSession.evaluationRevision + 1,
        }).where(eq(strategyMonitorSessionsTable.id, session.id)).returning();
      }

      const existing = await tx.select().from(strategyMonitorConditionStatesTable)
        .where(eq(strategyMonitorConditionStatesTable.monitorSessionId, session.id));
      const existingByCondition = new Map(existing.map(state => [state.strategyVersionConditionId, state]));
      const changedConditionIds: number[] = [];
      for (const result of results) {
        const previous = existingByCondition.get(result.condition.id);
        const evidence = result.evidence ? JSON.stringify(result.evidence) : null;
        const evaluatorState = result.evaluatorState == null ? null : JSON.stringify(result.evaluatorState);
        const unchanged = previous
          && previous.status === result.status
          && previous.reasonCode === result.reasonCode
          && previous.reason === result.reason
          && previous.timeframeCode === result.condition.timeframe
          && previous.timeframeId === result.timeframeId
          && previous.evidence === evidence
          && previous.detectorId === result.detectorId
          && previous.detectorVersion === result.detectorVersion
          && previous.evaluatorState === evaluatorState
          && previous.lastMarketDataAt?.getTime() === result.lastMarketDataAt?.getTime();
        if (unchanged) continue;
        changedConditionIds.push(result.condition.id);
        await tx.insert(strategyMonitorConditionStatesTable).values({
          monitorSessionId: session.id,
          strategyVersionConditionId: result.condition.id,
          status: result.status,
          reasonCode: result.reasonCode,
          reason: result.reason,
          timeframeCode: result.condition.timeframe,
          timeframeId: result.timeframeId,
          evidence,
          detectorId: result.detectorId,
          detectorVersion: result.detectorVersion,
          evaluatorState,
          lastEvaluationAt: evaluatedAt,
          lastMarketDataAt: result.lastMarketDataAt,
          metAt: result.status === "met" ? (previous?.metAt ?? evaluatedAt) : null,
        }).onConflictDoUpdate({
          target: [strategyMonitorConditionStatesTable.monitorSessionId, strategyMonitorConditionStatesTable.strategyVersionConditionId],
          set: {
            status: result.status,
            reasonCode: result.reasonCode,
            reason: result.reason,
            timeframeCode: result.condition.timeframe,
            timeframeId: result.timeframeId,
            evidence,
            detectorId: result.detectorId,
            detectorVersion: result.detectorVersion,
            evaluatorState,
            lastEvaluationAt: evaluatedAt,
            lastMarketDataAt: result.lastMarketDataAt,
            metAt: result.status === "met" ? (previous?.metAt ?? evaluatedAt) : null,
          },
        });
      }
      changed = sessionChanged || changedConditionIds.length > 0;
      if (changed) {
        await tx.insert(strategyMonitorTransitionEventsTable).values({
          monitorSessionId: session.id,
          strategyVersionId: item.version.id,
          fromOverallStatus: currentSession?.overallStatus ?? null,
          toOverallStatus: summary.overallStatus,
          changedConditionIds,
          occurredAt: evaluatedAt,
        });
        if (!currentSession || currentSession.overallStatus !== summary.overallStatus) {
          const meaningfulTransition = summary.overallStatus === "met" || summary.overallStatus === "invalid";
          if (meaningfulTransition) {
              const previousStatus = currentSession?.overallStatus ?? "waiting";
            await tx.insert(alertsTable).values({
              name: `${item.strategy.name} monitoring`,
              marketId: item.version.marketId,
              monitorSessionId: session.id,
              strategyVersionId: item.version.id,
              sourceType: "monitoring",
                condition: "Overall monitoring state changed",
                threshold: `${previousStatus} → ${summary.overallStatus}`,
              status: "triggered",
              message: summary.statusReason,
              triggeredAt: evaluatedAt,
            });
          }
        }
      }
      return true;
    });
    if (!persisted && attempt < 2) {
      const current = (await this.loadActiveStrategies(item.strategy.id))
        .find(candidate => candidate.version.id === item.version.id);
      if (current) return this.evaluateOne(current, requestedSourceId, attempt + 1);
    }
    if (!persisted) throw new Error("The active strategy version changed during evaluation; no stale monitoring state was written.");

    const snapshot = await this.snapshotFor(item);
    if (changed) await Promise.allSettled([...this.listeners].map(listener => listener(snapshot)));
    return snapshot;
  }

  private async resolveSource(instrumentId: number | null, requestedSourceId: number | null) {
    if (!instrumentId) return null;
    if (requestedSourceId) {
      const [mapping] = await db.select({ sourceId: sourceInstrumentMappingsTable.sourceId })
        .from(sourceInstrumentMappingsTable)
        .innerJoin(marketDataSourcesTable, eq(marketDataSourcesTable.id, sourceInstrumentMappingsTable.sourceId))
        .where(and(
          eq(sourceInstrumentMappingsTable.instrumentId, instrumentId),
          eq(sourceInstrumentMappingsTable.sourceId, requestedSourceId),
          eq(marketDataSourcesTable.isEnabled, true),
        ));
      return mapping?.sourceId ?? null;
    }
    const mappings = await db.select({ sourceId: sourceInstrumentMappingsTable.sourceId })
      .from(sourceInstrumentMappingsTable)
      .innerJoin(marketDataSourcesTable, eq(marketDataSourcesTable.id, sourceInstrumentMappingsTable.sourceId))
      .where(and(
        eq(sourceInstrumentMappingsTable.instrumentId, instrumentId),
        eq(marketDataSourcesTable.isEnabled, true),
      ));
    return mappings.length === 1 ? mappings[0].sourceId : null;
  }

  private conditionResult(
    condition: StrategyVersionCondition,
    timeframeId: number | null,
    status: ConditionEvaluationStatus,
    reasonCode: string,
    reason: string,
    evidence: Record<string, unknown> | null = null,
    lastMarketDataAt: Date | null = null,
    detectorId: string | null = null,
    detectorVersion: string | null = null,
    evaluatorState: unknown = null,
  ): EvaluatedCondition {
    return { condition, timeframeId, status, reasonCode, reason, evidence, detectorId, detectorVersion, evaluatorState, lastMarketDataAt };
  }

  private parseState(value: string | null | undefined): unknown {
    if (!value) return null;
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  private summarize(results: EvaluatedCondition[], conditions: StrategyVersionCondition[]) {
    const metCount = results.filter(result => result.status === "met").length;
    const notMetCount = results.filter(result => result.status === "not_met").length;
    const waitingCount = results.filter(result => result.status === "waiting").length;
    const invalidCount = results.filter(result => result.status === "invalid").length;
    const required = results.filter(result => result.condition.requirement === "required");
    let overallStatus: ConditionEvaluationStatus;
    let statusReason: string;
    if (!conditions.length) {
      overallStatus = "waiting";
      statusReason = "The active strategy version has no saved conditions.";
    } else if (invalidCount > 0) {
      overallStatus = "invalid";
      statusReason = "One or more conditions have invalid or unmapped configuration.";
    } else if (required.some(result => result.status === "not_met")) {
      overallStatus = "not_met";
      statusReason = "At least one required condition is not met.";
    } else if (!required.length || required.some(result => result.status === "waiting")) {
      overallStatus = "waiting";
      statusReason = "Required conditions are waiting for evaluable rules or market data.";
    } else {
      overallStatus = "met";
      statusReason = "All required conditions are met by registered evaluators.";
    }
    return {
      metCount,
      notMetCount,
      waitingCount,
      invalidCount,
      progressPercent: results.length ? Math.round((metCount / results.length) * 100) : 0,
      overallStatus,
      monitoringStatus: (overallStatus === "met" || overallStatus === "not_met" ? "monitoring" : overallStatus === "invalid" ? "error" : "waiting") as MonitoringStatus,
      statusReason,
      lastMarketDataAt: results.reduce<Date | null>((latest, result) => !result.lastMarketDataAt || (latest && latest >= result.lastMarketDataAt) ? latest : result.lastMarketDataAt, null),
    };
  }
}

export const strategyMonitoringEngine = new StrategyMonitoringEngine();