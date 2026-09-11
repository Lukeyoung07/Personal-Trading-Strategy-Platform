import { Fragment, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import {
  ArrowDown, ArrowRight, ArrowUp, Check, ChevronDown, ChevronRight, Edit3, FileText, Pencil, Plus,
  Save, Search, ShieldCheck, SlidersHorizontal, Trash2, X, Zap,
} from "lucide-react";
import {
  getGetDashboardSummaryQueryKey,
  getListMarketsQueryKey,
  getListStrategiesQueryKey,
  getListStrategyConditionsQueryKey,
  useCreateStrategy,
  useCreateStrategyCondition,
  useDeleteStrategyCondition,
  useListConcepts,
  useListMarkets,
  useListStrategies,
  useListStrategyConditions,
  useListTimeframes,
  useReorderStrategyConditions,
  useUpdateStrategy,
  useUpdateStrategyCondition,
  type Market,
  type Strategy,
  type StrategyCondition,
  type Timeframe,
  type TradingConcept,
  type AssistantStrategyDraft,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { StrategyVersionManager } from "@/components/strategy-versioning";
import { clearPendingAssistantDraft, getPendingAssistantDraft } from "@/lib/assistant-draft-store";

const STAGES = [
  { value: "entry", label: "Entry" },
  { value: "confirmation", label: "Confirmation" },
  { value: "invalidation", label: "Invalidation" },
  { value: "exit", label: "Exit" },
] as const;

const DIRECTIONS = [
  { value: "long", label: "Long" },
  { value: "short", label: "Short" },
  { value: "both", label: "Both" },
] as const;

const RULE_PRESETS = [
  { value: "bullish", label: "Candle is bullish", rule: "bullish", description: "The candle closes above its open.", supported: true },
  { value: "bearish", label: "Candle is bearish", rule: "bearish", description: "The candle closes below its open.", supported: true },
  { value: "close_above_open", label: "Price is above the candle open", rule: "close > open", description: "The closing price is above the opening price.", supported: true },
  { value: "close_below_open", label: "Price is below the candle open", rule: "close < open", description: "The closing price is below the opening price.", supported: true },
  { value: "close_crosses_above_previous_high", label: "Price crosses above the previous high", rule: "close crosses above previous high", description: "The close moves above the prior candle high.", supported: true },
  { value: "close_crosses_below_previous_low", label: "Price crosses below the previous low", rule: "close crosses below previous low", description: "The close moves below the prior candle low.", supported: true },
  { value: "always", label: "Always true", rule: "always", description: "Useful for testing or a deliberately open checkpoint.", supported: true },
  { value: "rsi_above", label: "RSI is above a value", rule: "RSI above 70", description: "Stored as a descriptive rule for now. RSI is not currently supported by Backtesting.", supported: false },
] as const;

function rulePresetFor(value: string | null) {
  return RULE_PRESETS.find(preset => preset.rule === value?.trim().toLowerCase())?.value ?? "custom";
}

function friendlyMutationError(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message.replace(/^Error:\s*/i, "") : fallback;
}

function isBacktestCompatibleRule(rule: string | null | undefined) {
  if (!rule?.trim()) return false;
  const normalized = rule.trim().toLowerCase().replace(/[()[\],]/g, " ").replace(/\s+/g, " ");
  if (normalized === "always" || normalized === "bullish" || normalized === "bullish candle" || normalized === "bearish" || normalized === "bearish candle") return true;
  if (/^(open|high|low|close) crosses (above|below) previous[_ ](open|high|low|close)$/.test(normalized)) return true;
  return /^(open|high|low|close|previous[_ ](?:open|high|low|close))\s*(>=|<=|>|<|=|==)\s*(open|high|low|close|previous[_ ](?:open|high|low|close)|\d+(?:\.\d+)?)$/.test(normalized);
}

function isBacktestCompatibleRiskRules(riskRules: string | null | undefined) {
  if (!riskRules?.trim()) return true;
  const mentionsRisk = /(?:stop[- ]loss|sl|take[- ]profit|tp)/i.test(riskRules);
  if (!mentionsRisk) return true;
  return /(?:stop[- ]loss|sl)\s*[:=]?\s*\d+(?:\.\d+)?\s*%/i.test(riskRules)
    || /(?:take[- ]profit|tp)\s*[:=]?\s*\d+(?:\.\d+)?\s*%/i.test(riskRules);
}

function BuilderPage({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return <div className="page-wrap">
    <div className="page-heading flex items-start justify-between gap-5 mb-8">
      <div>
        <div className="eyebrow mb-3">Workbench</div>
        <h1 className="display text-3xl md:text-4xl font-bold">Strategy builder</h1>
        <p className="text-muted-foreground text-sm mt-3 max-w-2xl leading-relaxed">
          Turn your own concepts into a clear, ordered decision process. No code, market feed, or assumed strategy.
        </p>
      </div>
      {action}
    </div>
    {children}
  </div>;
}

function Panel({ title, eyebrow, children, className = "" }: { title: string; eyebrow?: string; children: ReactNode; className?: string }) {
  return <section className={`panel p-5 md:p-6 ${className}`}>
    {eyebrow && <div className="eyebrow">{eyebrow}</div>}
    <h2 className="font-semibold mt-2">{title}</h2>
    {children}
  </section>;
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="block">
    <span className="label">{label}</span>
    {children}
    {hint && <span className="block text-[11px] text-muted-foreground mt-1.5 leading-relaxed">{hint}</span>}
  </label>;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-5" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <div className="panel w-full max-w-2xl max-h-[94dvh] overflow-y-auto p-6 rise">
      <div className="flex items-center justify-between mb-6">
        <h2 className="font-semibold text-lg">{title}</h2>
        <button onClick={onClose} className="btn btn-ghost" data-testid="button-close-strategy-builder-modal"><X size={17} /></button>
      </div>
      {children}
    </div>
  </div>;
}

function SearchableConcept({ concepts, value, onChange }: { concepts: TradingConcept[]; value: number | null; onChange: (id: number) => void }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const selected = concepts.find(concept => concept.id === value);
  const filtered = concepts.filter(concept => `${concept.name} ${concept.category || ""}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="relative">
    <div className="relative">
      <Search size={15} className="absolute left-3 top-3 text-muted-foreground" />
      <input
        className="input pl-9 pr-9"
        value={open ? query : selected?.name || ""}
        onFocus={() => { setOpen(true); setQuery(""); }}
        onChange={event => { setQuery(event.target.value); setOpen(true); }}
        placeholder="Search the Trading Concept Library"
        data-testid="input-condition-concept"
      />
      <ChevronDown size={15} className="absolute right-3 top-3 text-muted-foreground" />
    </div>
    {open && <div className="absolute z-40 left-0 right-0 top-full mt-2 panel p-2 max-h-56 overflow-y-auto shadow-xl">
      {filtered.length ? filtered.map(concept => <button
        type="button"
        key={concept.id}
        className="w-full text-left flex items-center justify-between gap-3 px-3 py-2.5 rounded-md hover:bg-secondary transition-colors"
        onClick={() => { onChange(concept.id); setQuery(""); setOpen(false); }}
        data-testid={`option-condition-concept-${concept.id}`}
      >
        <span>
          <span className="block text-sm font-semibold">{concept.name}</span>
          <span className="block text-[10px] text-muted-foreground mt-1">{concept.category || "CUSTOM"}{concept.isBuiltIn ? " · Library" : " · Custom"}</span>
        </span>
        {concept.id === value && <Check size={15} className="text-primary shrink-0" />}
      </button>) : <div className="p-4 text-sm text-muted-foreground">No concepts match that search.</div>}
    </div>}
  </div>;
}

function StrategyForm({ strategy, markets, timeframes, onClose, onSaved, initialDraft }: { strategy: Strategy | null; markets: Market[]; timeframes: Timeframe[]; onClose?: () => void; onSaved: (strategy: Strategy) => void; initialDraft?: AssistantStrategyDraft | null }) {
  const create = useCreateStrategy();
  const update = useUpdateStrategy();
  const queryClient = useQueryClient();
  const [error, setError] = useState("");
  const draftMarketId = initialDraft?.marketSymbol
    ? markets.find(market => market.symbol.toLowerCase() === initialDraft.marketSymbol?.toLowerCase())?.id
    : undefined;
  const [selectedMarketId, setSelectedMarketId] = useState(() => String(strategy?.marketId || draftMarketId || ""));
  const initialTimeframes = strategy?.timeframes || initialDraft?.timeframes || [];
  const [selectedTimeframes, setSelectedTimeframes] = useState<string[]>(initialTimeframes);
  const marketSelectionTouched = useRef(false);
  useEffect(() => {
    if (marketSelectionTouched.current) return;
    setSelectedMarketId(String(strategy?.marketId || draftMarketId || ""));
  }, [strategy?.id, strategy?.marketId, draftMarketId]);
  useEffect(() => {
    setSelectedTimeframes(strategy?.timeframes || initialDraft?.timeframes || []);
  }, [strategy?.id, initialDraft?.name]);
  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") || "").trim();
    if (!name) {
      setError("Please give your strategy a name.");
      return;
    }
     const typedTimeframes = String(form.get("timeframes") || "").split(",").map(value => value.trim()).filter(Boolean);
     const savedTimeframes = timeframes.length ? selectedTimeframes : typedTimeframes;
    const data = {
      name,
      description: String(form.get("description") || "") || null,
       marketId: form.get("marketId") ? Number(form.get("marketId")) : null,
      assetClass: String(form.get("assetClass") || "") || null,
       direction: strategy ? strategy.direction : String(form.get("direction") || initialDraft?.direction || "both") as "long" | "short" | "both",
       timeframes: savedTimeframes,
       riskManagementRules: strategy ? strategy.riskManagementRules : String(form.get("riskManagementRules") || initialDraft?.riskManagementRules || "") || null,
      resetRules: String(form.get("resetRules") || "") || null,
      alertRules: String(form.get("alertRules") || "") || null,
    };
    setError("");
    const done = (saved: Strategy) => {
      queryClient.invalidateQueries({ queryKey: getListStrategiesQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
      onSaved(saved);
      onClose?.();
    };
    const onError = (failure: unknown) => setError(friendlyMutationError(failure, "Could not save this strategy. Please check the details and try again."));
    if (strategy) update.mutate({ strategyId: strategy.id, data }, { onSuccess: done, onError });
    else create.mutate({ data }, { onSuccess: done, onError });
  };
  const busy = create.isPending || update.isPending;
  return <form onSubmit={save} className="space-y-6" key={strategy?.id ?? initialDraft?.name ?? "new-strategy"}>
    {error && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive" role="alert" data-testid="status-builder-strategy-error">{error}</div>}
      <Field label="Strategy name"><input className="input" name="name" required defaultValue={strategy?.name || initialDraft?.name || ""} placeholder="Name your hypothesis" data-testid="input-builder-strategy-name" /></Field>
     <Field label="Description"><textarea className="textarea" name="description" defaultValue={strategy?.description || initialDraft?.description || ""} placeholder="What is this strategy trying to explain or capture?" data-testid="input-builder-strategy-description" /></Field>
     <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
       <Field label="Market / instrument" hint="Optional. Add instruments from Market Monitor first, or leave this strategy broad.">
        <select
          className="select"
          name="marketId"
          value={selectedMarketId}
          onChange={event => {
            marketSelectionTouched.current = true;
            setSelectedMarketId(event.target.value);
          }}
          data-testid="select-builder-market"
        >
          <option value="">No specific instrument</option>
          {markets.map(market => <option key={market.id} value={market.id}>{market.symbol} · {market.assetClass}</option>)}
        </select>
      </Field>
       {!strategy ? <Field label="Trading direction">
         <select className="select" name="direction" defaultValue={initialDraft?.direction || "both"} data-testid="select-builder-direction">
           {DIRECTIONS.map(direction => <option key={direction.value} value={direction.value}>{direction.label}</option>)}
         </select>
       </Field> : <div className="rounded-md border border-primary/25 bg-primary/5 p-3 text-xs text-muted-foreground self-end">
         <div className="font-semibold text-foreground">Logic lives below</div>
         <p className="mt-1">Direction and exit rules are edited once in the Builder controls after this strategy is saved.</p>
       </div>}
    </div>
     <Field label="Timeframes" hint="Choose from the active TradeX timeframes. These describe where the strategy is reviewed; they do not create signals.">
       {timeframes.length ? <div className="grid grid-cols-2 sm:grid-cols-3 gap-2" data-testid="builder-timeframe-options">
         {timeframes.filter(timeframe => timeframe.isActive).map(timeframe => {
           const selected = selectedTimeframes.some(value => value.toLowerCase() === timeframe.code.toLowerCase() || value.toLowerCase() === timeframe.label.toLowerCase());
           return <label key={timeframe.id} className={`rounded-md border p-3 cursor-pointer ${selected ? "border-primary bg-primary/10" : "border-border hover:bg-secondary"}`}>
             <span className="flex items-center gap-2"><input type="checkbox" checked={selected} onChange={event => setSelectedTimeframes(current => event.target.checked ? [...current.filter(value => value !== timeframe.code), timeframe.code] : current.filter(value => value.toLowerCase() !== timeframe.code.toLowerCase() && value.toLowerCase() !== timeframe.label.toLowerCase()))} data-testid={`checkbox-builder-timeframe-${timeframe.code}`} /><span className="text-sm font-semibold">{timeframe.label}</span></span>
             <span className="block text-[10px] text-muted-foreground mt-1 ml-5">{timeframe.code}</span>
           </label>;
         })}
       </div> : <input className="input mono" name="timeframes" defaultValue={initialTimeframes.join(", ")} placeholder="e.g. Daily, 4H, 15m" data-testid="input-builder-timeframes" />}
     </Field>
    <details className="border-t border-border pt-6 group" data-testid="builder-advanced-notes">
      <summary className="cursor-pointer list-none flex items-center justify-between">
        <span><span className="eyebrow">Advanced notes</span><span className="block text-xs text-muted-foreground mt-2">Optional reset, risk, and review notes.</span></span>
        <ChevronDown size={16} className="text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
       <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-5">
          <Field label="Asset class" hint="Keep this general if the strategy is not asset-specific."><input className="input" name="assetClass" defaultValue={strategy?.assetClass || ""} placeholder="Optional — e.g. equity, FX, crypto" data-testid="input-builder-asset-class" /></Field>
          {!strategy && <Field label="Risk-management notes"><textarea className="textarea" name="riskManagementRules" defaultValue={initialDraft?.riskManagementRules || ""} placeholder="For simple percentage exits, use the Risk management section after saving." data-testid="input-builder-risk-rules" /></Field>}
          <Field label="Reset notes"><textarea className="textarea" name="resetRules" defaultValue={strategy?.resetRules || ""} placeholder="When does this process reset or begin again?" data-testid="input-builder-reset-rules" /></Field>
      </div>
      <Field label="Review reminders" hint="Personal notes only. No live detection or notifications are connected."><textarea className="textarea" name="alertRules" defaultValue={strategy?.alertRules || ""} placeholder="What should prompt you to review this strategy?" data-testid="input-builder-alert-rules" /></Field>
    </details>
    <div className="flex items-center justify-end gap-3 pt-1">
      {onClose && <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>}
      <button className="btn btn-primary" disabled={busy} data-testid="button-save-builder-strategy">{busy ? "Saving…" : strategy ? "Save strategy" : "Create strategy"}</button>
    </div>
  </form>;
}

function ConditionModal({ strategyId, concepts, timeframes, condition, defaultStage, onClose, onSaved }: { strategyId: number; concepts: TradingConcept[]; timeframes: Timeframe[]; condition: StrategyCondition | null; defaultStage: "entry" | "confirmation" | "exit"; onClose: () => void; onSaved: () => void }) {
  const create = useCreateStrategyCondition();
  const update = useUpdateStrategyCondition();
  const queryClient = useQueryClient();
  const [conceptId, setConceptId] = useState<number | null>(condition?.conceptId || null);
  const [rulePreset, setRulePreset] = useState(rulePresetFor(condition?.triggerRules || null));
  const [error, setError] = useState("");
  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const customRule = String(form.get("customRule") || "").trim();
    const selectedPreset = RULE_PRESETS.find(preset => preset.value === rulePreset);
    const triggerRules = rulePreset === "custom" ? customRule : selectedPreset?.rule || "";
    const data = {
      conceptId: conceptId as number,
      stage: String(form.get("stage") || "entry") as "entry" | "confirmation" | "invalidation" | "exit",
      name: String(form.get("name") || "").trim(),
      description: String(form.get("description") || "") || null,
      timeframe: String(form.get("timeframe") || "").trim(),
      direction: String(form.get("direction") || "both") as "long" | "short" | "both",
      requirement: String(form.get("requirement") || "required") as "required" | "optional",
      triggerRules: triggerRules || null,
      invalidationRules: String(form.get("invalidationRules") || "") || null,
      resetBehavior: String(form.get("resetBehavior") || "") || null,
    };
    if (!conceptId) {
      setError("Please choose a concept for this condition.");
      return;
    }
    if (!data.name) {
      setError("Please give this condition a name.");
      return;
    }
    if (!data.timeframe) {
      setError("Please choose a timeframe for this condition.");
      return;
    }
    if (!triggerRules) {
      setError(rulePreset === "custom" ? "Please describe the rule, or choose a supported rule from the list." : "Please choose an entry condition.");
      return;
    }
    setError("");
    const done = () => {
      queryClient.invalidateQueries({ queryKey: getListStrategyConditionsQueryKey(strategyId) });
      onSaved();
      onClose();
    };
    const onError = (failure: unknown) => setError(friendlyMutationError(failure, "Could not save this condition. Check the highlighted choices and try again."));
    if (condition) update.mutate({ strategyId, conditionId: condition.id, data }, { onSuccess: done, onError });
    else create.mutate({ strategyId, data }, { onSuccess: done, onError });
  };
  const busy = create.isPending || update.isPending;
  const activeTimeframes = timeframes.filter(timeframe => timeframe.isActive);
  const timeframeKnown = activeTimeframes.some(timeframe => timeframe.code.toLowerCase() === (condition?.timeframe || "").toLowerCase() || timeframe.label.toLowerCase() === (condition?.timeframe || "").toLowerCase());
  return <Modal title={condition ? "Edit condition" : "Add condition"} onClose={onClose}>
    <form onSubmit={save} className="space-y-5">
      {error && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive" role="alert" data-testid="status-builder-condition-error">{error}</div>}
      <Field label="Concept from Trading Concept Library">
        <SearchableConcept concepts={concepts} value={conceptId} onChange={setConceptId} />
      </Field>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Condition name" hint="Use words you would say out loud."><input className="input" name="name" defaultValue={condition?.name || ""} placeholder="e.g. Candle confirms momentum" data-testid="input-builder-condition-name" /></Field>
        <Field label="Stage">
           <select className="select" name="stage" defaultValue={condition?.stage || defaultStage} data-testid="select-builder-condition-stage">
            {STAGES.map(stage => <option key={stage.value} value={stage.value}>{stage.label}</option>)}
          </select>
        </Field>
      </div>
      <section className="rounded-lg border border-primary/30 bg-primary/5 p-4 md:p-5" data-testid="builder-when-condition">
        <div className="eyebrow text-primary">When</div>
        <p className="text-sm font-semibold mt-2">What should be true?</p>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">Choose a plain-language rule. Supported rules are saved in the exact format the historical Backtesting engine understands.</p>
        <div className="mt-4">
          <select className="select bg-background" value={rulePreset} onChange={event => setRulePreset(event.target.value)} data-testid="select-builder-condition-rule">
            <option value="">Choose a condition</option>
            {RULE_PRESETS.map(preset => <option key={preset.value} value={preset.value}>{preset.label}</option>)}
            <option value="custom">Advanced technical rule</option>
          </select>
        </div>
        {rulePreset && rulePreset !== "custom" && <div className={`mt-3 rounded-md p-3 text-xs ${RULE_PRESETS.find(preset => preset.value === rulePreset)?.supported ? "bg-background/70 text-muted-foreground" : "border border-amber-500/40 bg-amber-500/10 text-amber-200"}`}><ShieldCheck size={14} className={`inline mr-2 ${RULE_PRESETS.find(preset => preset.value === rulePreset)?.supported ? "text-primary" : "text-amber-300"}`} />{RULE_PRESETS.find(preset => preset.value === rulePreset)?.description}{!RULE_PRESETS.find(preset => preset.value === rulePreset)?.supported && <strong className="block mt-1 ml-6">Not currently supported by Backtesting.</strong>}</div>}
        {rulePreset === "custom" && <Field label="Technical rule" hint="Only use this for a rule already supported by Backtesting: OHLC comparisons, bullish, bearish, always, or previous-candle crossing rules."><textarea className="textarea mt-2" name="customRule" defaultValue={condition?.triggerRules || ""} placeholder="e.g. close > previous_high" data-testid="input-builder-condition-custom-rule" /></Field>}
      </section>
       <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
         <Field label="Timeframe" hint="Choose an active timeframe for this condition.">
           {activeTimeframes.length ? <select className="select" name="timeframe" defaultValue={condition?.timeframe && timeframeKnown ? activeTimeframes.find(timeframe => timeframe.code.toLowerCase() === condition.timeframe?.toLowerCase() || timeframe.label.toLowerCase() === condition.timeframe?.toLowerCase())?.code : ""} data-testid="select-builder-condition-timeframe">
             <option value="">Choose timeframe</option>
             {condition?.timeframe && !timeframeKnown && <option value={condition.timeframe}>{condition.timeframe} · saved value</option>}
             {activeTimeframes.map(timeframe => <option key={timeframe.id} value={timeframe.code}>{timeframe.label} · {timeframe.code}</option>)}
           </select> : <input className="input" name="timeframe" defaultValue={condition?.timeframe || ""} placeholder="e.g. 4H" data-testid="input-builder-condition-timeframe" />}
         </Field>
        <Field label="Direction">
          <select className="select" name="direction" defaultValue={condition?.direction || "both"} data-testid="select-builder-condition-direction">
            {DIRECTIONS.map(direction => <option key={direction.value} value={direction.value}>{direction.value === "long" ? "BUY only" : direction.value === "short" ? "SELL only" : "BUY or SELL"}</option>)}
          </select>
        </Field>
        <Field label="Requirement">
          <select className="select" name="requirement" defaultValue={condition?.requirement || "required"} data-testid="select-builder-condition-requirement">
            <option value="required">Required</option>
            <option value="optional">Optional note</option>
          </select>
        </Field>
      </div>
      <details className="rounded-md border border-border p-4 group">
        <summary className="cursor-pointer text-sm font-semibold list-none flex items-center justify-between">Advanced details <ChevronDown size={15} className="text-muted-foreground transition-transform group-open:rotate-180" /></summary>
        <div className="space-y-4 mt-4 pt-4 border-t border-border">
          <Field label="Description"><textarea className="textarea" name="description" defaultValue={condition?.description || ""} placeholder="What does this condition mean in your process?" data-testid="input-builder-condition-description" /></Field>
          <Field label="Invalidation rules"><textarea className="textarea" name="invalidationRules" defaultValue={condition?.invalidationRules || ""} placeholder="What would make this condition no longer valid?" data-testid="input-builder-condition-invalidation-rules" /></Field>
          <Field label="Reset behaviour"><textarea className="textarea" name="resetBehavior" defaultValue={condition?.resetBehavior || ""} placeholder="How should this condition reset before the process begins again?" data-testid="input-builder-condition-reset-behaviour" /></Field>
        </div>
      </details>
      <div className="flex justify-end gap-3 pt-1">
        <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
         <button className="btn btn-primary" disabled={busy} data-testid="button-save-builder-condition">{busy ? "Saving…" : "Save condition"}</button>
      </div>
    </form>
  </Modal>;
}

function ConditionFlow({ strategyId, conditions, marketSymbol, onlyStage, onAdd, onEdit, onChanged }: { strategyId: number; conditions: StrategyCondition[]; marketSymbol: string | null; onlyStage?: "entry" | "confirmation" | "exit"; onAdd: (stage: "entry" | "confirmation" | "exit") => void; onEdit: (condition: StrategyCondition) => void; onChanged: () => void }) {
  const reorder = useReorderStrategyConditions();
  const remove = useDeleteStrategyCondition();
  const queryClient = useQueryClient();
  const ordered = [...conditions].sort((a, b) => a.order - b.order);
  const groups = [
    { key: "entry" as const, label: "Entry", description: "Conditions that must be met before the strategy can enter." },
    { key: "confirmation" as const, label: "Confirmation", description: "Additional conditions that confirm the setup." },
    { key: "exit" as const, label: "Exit", description: "Conditions that cause the strategy to leave, including invalidation rules." },
  ];
  const move = (index: number, delta: number) => {
    const next = [...ordered];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    reorder.mutate({ strategyId, data: { conditionIds: next.map(condition => condition.id) } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListStrategyConditionsQueryKey(strategyId) });
        onChanged();
      },
    });
  };
  const deleteCondition = (condition: StrategyCondition) => {
    if (!window.confirm(`Remove “${condition.name}” from this strategy?`)) return;
    remove.mutate({ strategyId, conditionId: condition.id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListStrategyConditionsQueryKey(strategyId) });
        onChanged();
      },
    });
  };
  const renderCard = (condition: StrategyCondition) => {
    const index = ordered.findIndex(item => item.id === condition.id);
    const supported = isBacktestCompatibleRule(condition.triggerRules);
    return <div key={condition.id}>
      <div className="panel panel-hover p-3 md:p-4">
        <div className="flex items-start gap-3">
          <div className="w-7 h-7 rounded-md bg-primary/10 text-primary flex items-center justify-center mono text-[10px] font-bold shrink-0">{String(index + 1).padStart(2, "0")}</div>
          <div className="min-w-0 flex-1">
            <div className="eyebrow">{condition.stage === "invalidation" ? "Exit condition" : `${condition.stage} condition`}</div>
            <h3 className="font-semibold mt-1">{condition.name}</h3>
            <div className="text-[11px] text-muted-foreground mt-1">{condition.conceptName} · {condition.direction.toUpperCase()} · {condition.timeframe}{marketSymbol ? ` · ${marketSymbol}` : ""}</div>
            {condition.triggerRules && <p className="text-xs text-foreground/80 mt-3 leading-relaxed">{condition.triggerRules}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className={`tag ${supported ? "tag-active" : "border-amber-500/40 text-amber-200"}`}>{supported ? "✓ Backtest supported" : "⚠ Review required"}</span>
              {!supported && <span className="text-[11px] text-amber-200">Backtesting cannot currently execute this concept.</span>}
            </div>
          </div>
          <div className="flex shrink-0">
            <button className="btn btn-ghost" onClick={() => move(index, -1)} disabled={index === 0 || reorder.isPending} aria-label="Move condition up" data-testid={`button-move-condition-up-${condition.id}`}><ArrowUp size={14} /></button>
            <button className="btn btn-ghost" onClick={() => move(index, 1)} disabled={index === ordered.length - 1 || reorder.isPending} aria-label="Move condition down" data-testid={`button-move-condition-down-${condition.id}`}><ArrowDown size={14} /></button>
            <button className="btn btn-ghost" onClick={() => onEdit(condition)} aria-label="Edit condition" data-testid={`button-edit-strategy-condition-${condition.id}`}><Pencil size={14} /></button>
            <button className="btn btn-ghost text-destructive" onClick={() => deleteCondition(condition)} aria-label="Remove condition" data-testid={`button-delete-strategy-condition-${condition.id}`}><Trash2 size={14} /></button>
          </div>
        </div>
      </div>
      {index < ordered.length - 1 && <div className="flex flex-col items-center py-2 text-primary/70" aria-hidden="true"><span className="w-px h-3 bg-primary/30" /><span className="tag tag-active my-1">AND</span><ChevronDown size={16} /></div>}
    </div>;
  };
  return <div className="space-y-5" data-testid={!onlyStage || onlyStage === "entry" ? "strategy-condition-flow" : undefined}>
    {groups.filter(group => !onlyStage || group.key === onlyStage).map(group => {
      const groupConditions = ordered.filter(condition => group.key === "exit" ? condition.stage === "exit" || condition.stage === "invalidation" : condition.stage === group.key);
      return <section key={group.key} className="space-y-3" data-testid={`condition-group-${group.key}`}>
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div><div className="eyebrow">{group.label}</div><h3 className="font-semibold mt-1">{group.description}</h3></div>
          <button className="btn btn-secondary shrink-0" onClick={() => onAdd(group.key)} data-testid={group.key === "entry" ? "button-add-strategy-condition" : `button-add-condition-${group.key}`}><Plus size={14} /> Add {group.label} condition</button>
        </div>
        {groupConditions.length ? groupConditions.map(renderCard) : <div className="panel border-dashed p-5 text-sm text-muted-foreground">No {group.label.toLowerCase()} conditions yet.</div>}
      </section>;
    })}
    {!onlyStage && <div className="panel border-primary/30 bg-primary/5 px-5 py-4 text-center">
      <div className="eyebrow text-primary">Review boundary</div>
      <div className="font-semibold mt-2 flex items-center justify-center gap-2"><Zap size={15} className="text-primary" /> Save, version, then backtest</div>
      <p className="text-[11px] text-muted-foreground mt-1">Conditions remain descriptive until an executable detector exists. Unsupported concepts are never converted into fake rules.</p>
    </div>}
  </div>;
}

function riskPercent(value: string | null, label: "stop-loss" | "take-profit") {
  const labelPattern = label === "stop-loss" ? "stop[- ]loss" : "take[- ]profit";
  const labelFirst = value?.match(new RegExp(`${labelPattern}\\s*[:=]?\\s*(\\d+(?:\\.\\d+)?)\\s*%`, "i"));
  const numberFirst = value?.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*%\\s*${labelPattern}`, "i"));
  return labelFirst?.[1] || numberFirst?.[1] || "";
}

function riskNarrative(value: string | null) {
  return value?.split(/[;\n]+/)
    .map(part => part.trim())
    .filter(part => part && !/(?:stop[- ]loss|sl|take[- ]profit|tp)\s*[:=]?\s*\d+(?:\.\d+)?\s*%/i.test(part))
    .join("; ") || "";
}

function riskManagementValue(value: string | null, label: "risk" | "risk amount" | "risk/reward") {
  const match = value?.match(new RegExp(`${label.replace("/", "\\/")}\\s*[:=]\\s*([^;\\n]+)`, "i"));
  return match?.[1]?.trim().replace(/R$/i, "") || "";
}

type BuilderSectionKey = "strategy" | "entry" | "confirmation" | "exit" | "risk" | "review";

const BUILDER_SECTIONS: { key: BuilderSectionKey; number: string; label: string; description: string }[] = [
  { key: "strategy", number: "01", label: "Strategy", description: "Set up the basic information." },
  { key: "entry", number: "02", label: "Entry", description: "Define when the strategy can enter." },
  { key: "confirmation", number: "03", label: "Confirmation", description: "Add conditions that confirm the setup." },
  { key: "exit", number: "04", label: "Exit", description: "Define when the trade should be closed." },
  { key: "risk", number: "05", label: "Risk management", description: "Set the amount and exits you are willing to accept." },
  { key: "review", number: "06", label: "Review", description: "Check the strategy before saving a version." },
];

function BuilderProgress({ current, onSelect }: { current: BuilderSectionKey; onSelect: (section: BuilderSectionKey) => void }) {
  return <nav className="panel p-2 md:p-3" aria-label="Builder progress" data-testid="builder-progress">
    <div className="grid grid-cols-3 gap-1 sm:flex sm:flex-wrap sm:items-center">
      {BUILDER_SECTIONS.map((section, index) => {
        const active = section.key === current;
        return <Fragment key={section.key}>
          <button type="button" className={`w-full sm:w-auto justify-center flex items-center gap-1.5 rounded-md px-1.5 sm:px-2.5 py-2 text-[11px] sm:text-xs transition-colors ${active ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-secondary hover:text-foreground"}`} onClick={() => onSelect(section.key)} aria-current={active ? "step" : undefined} data-testid={`button-builder-progress-${section.key}`}>
            <span className={`flex h-5 w-5 items-center justify-center rounded-full mono text-[10px] font-bold ${active ? "bg-primary text-primary-foreground" : "border border-border"}`}>{active ? "●" : section.number}</span>
            <span className="font-semibold">{section.label}</span>
          </button>
          {index < BUILDER_SECTIONS.length - 1 && <ChevronRight size={13} className="hidden sm:block text-border shrink-0" aria-hidden="true" />}
        </Fragment>;
      })}
    </div>
  </nav>;
}

function BuilderAccordion({ section, open, onOpen, children }: { section: typeof BUILDER_SECTIONS[number]; open: boolean; onOpen: () => void; children: ReactNode }) {
  return <section className={`panel overflow-hidden ${open ? "border-primary/35" : ""}`} data-testid={`builder-section-${section.key}`}>
    <button type="button" className="w-full text-left p-4 md:p-5 flex items-center gap-4 hover:bg-secondary/30 transition-colors" onClick={onOpen} aria-expanded={open} data-testid={`button-toggle-builder-${section.key}`}>
      <span className={`mono text-lg font-bold ${open ? "text-primary" : "text-muted-foreground"}`}>{section.number}</span>
      <span className="min-w-0 flex-1"><span className="eyebrow">{section.label}</span><span className="block text-sm text-muted-foreground mt-1">{section.description}</span></span>
      <ChevronDown size={17} className={`text-muted-foreground transition-transform shrink-0 ${open ? "rotate-180" : ""}`} />
    </button>
    <div hidden={!open} className="border-t border-border p-4 md:p-6">{children}</div>
  </section>;
}

type StrategyControlState = {
  direction: "long" | "short" | "both";
  setDirection: (value: "long" | "short" | "both") => void;
  stopLossEnabled: boolean;
  setStopLossEnabled: (value: boolean) => void;
  takeProfitEnabled: boolean;
  setTakeProfitEnabled: (value: boolean) => void;
  stopLoss: string;
  setStopLoss: (value: string) => void;
  takeProfit: string;
  setTakeProfit: (value: string) => void;
  riskBudget: string;
  setRiskBudget: (value: string) => void;
  riskAmount: string;
  setRiskAmount: (value: string) => void;
  riskReward: string;
  setRiskReward: (value: string) => void;
  error: string;
  updatePending: boolean;
  save: () => void;
  entryConditions: StrategyCondition[];
  confirmationConditions: StrategyCondition[];
  exitConditions: StrategyCondition[];
  unsupportedConditions: string[];
  missingEntryCondition: boolean;
  compatible: boolean;
  directionLabel: string;
}

function StrategyControls({ strategy, conditions, children }: { strategy: Strategy; conditions: StrategyCondition[]; children: (controls: StrategyControlState) => ReactNode }) {
  const update = useUpdateStrategy();
  const queryClient = useQueryClient();
  const [direction, setDirection] = useState<"long" | "short" | "both">(strategy.direction);
  const [stopLossEnabled, setStopLossEnabled] = useState(Boolean(riskPercent(strategy.riskManagementRules, "stop-loss")));
  const [takeProfitEnabled, setTakeProfitEnabled] = useState(Boolean(riskPercent(strategy.riskManagementRules, "take-profit")));
  const [stopLoss, setStopLoss] = useState(riskPercent(strategy.riskManagementRules, "stop-loss") || "1");
  const [takeProfit, setTakeProfit] = useState(riskPercent(strategy.riskManagementRules, "take-profit") || "2");
  const [riskBudget, setRiskBudget] = useState(riskManagementValue(strategy.riskManagementRules, "risk"));
  const [riskAmount, setRiskAmount] = useState(riskManagementValue(strategy.riskManagementRules, "risk amount"));
  const [riskReward, setRiskReward] = useState(riskManagementValue(strategy.riskManagementRules, "risk/reward"));
  const [error, setError] = useState("");

  useEffect(() => {
    setDirection(strategy.direction);
    setStopLossEnabled(Boolean(riskPercent(strategy.riskManagementRules, "stop-loss")));
    setTakeProfitEnabled(Boolean(riskPercent(strategy.riskManagementRules, "take-profit")));
    setStopLoss(riskPercent(strategy.riskManagementRules, "stop-loss") || "1");
    setTakeProfit(riskPercent(strategy.riskManagementRules, "take-profit") || "2");
    setRiskBudget(riskManagementValue(strategy.riskManagementRules, "risk"));
    setRiskAmount(riskManagementValue(strategy.riskManagementRules, "risk amount"));
    setRiskReward(riskManagementValue(strategy.riskManagementRules, "risk/reward"));
  }, [strategy.id, strategy.direction, strategy.riskManagementRules]);

  const entryConditions = conditions.filter(condition => condition.stage === "entry");
  const confirmationConditions = conditions.filter(condition => condition.stage === "confirmation");
  const entryAndConfirmationConditions = [...entryConditions, ...confirmationConditions];
  const exitConditions = conditions.filter(condition => condition.stage === "exit" || condition.stage === "invalidation");
  const unsupportedConditions = conditions.filter(condition => !isBacktestCompatibleRule(condition.triggerRules)).map(condition => condition.name || "Unnamed condition");
  const missingEntryCondition = entryAndConfirmationConditions.length === 0;
  const compatible = !missingEntryCondition && unsupportedConditions.length === 0 && isBacktestCompatibleRiskRules(strategy.riskManagementRules);
  const riskRules = [
    riskNarrative(strategy.riskManagementRules),
      riskBudget ? `risk: ${riskBudget}%` : "",
      riskAmount ? `risk amount: ${riskAmount}` : "",
      riskReward ? `risk/reward: ${riskReward}R` : "",
    stopLossEnabled && stopLoss ? `stop-loss: ${stopLoss}%` : "",
    takeProfitEnabled && takeProfit ? `take-profit: ${takeProfit}%` : "",
  ].filter(Boolean).join("; ") || null;
  const directionLabel = direction === "long" ? "Buy" : direction === "short" ? "Sell" : "Buy or sell";
  const save = () => {
    if ((stopLossEnabled && (!stopLoss || Number(stopLoss) <= 0)) || (takeProfitEnabled && (!takeProfit || Number(takeProfit) <= 0))) {
      setError("Please enter a positive percentage for each enabled exit rule.");
      return;
    }
    setError("");
    update.mutate({ strategyId: strategy.id, data: { direction, riskManagementRules: riskRules } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListStrategiesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
      },
      onError: failure => setError(friendlyMutationError(failure, "Could not save the strategy settings.")),
    });
  };

  return children({
    direction,
    setDirection,
    stopLossEnabled,
    setStopLossEnabled,
    takeProfitEnabled,
    setTakeProfitEnabled,
    stopLoss,
    setStopLoss,
    takeProfit,
    setTakeProfit,
    riskBudget,
    setRiskBudget,
    riskAmount,
    setRiskAmount,
    riskReward,
    setRiskReward,
    error,
    updatePending: update.isPending,
    save,
    entryConditions,
    confirmationConditions,
    exitConditions,
    unsupportedConditions,
    missingEntryCondition,
    compatible,
    directionLabel,
  });
}

function DirectionControls({ controls }: { controls: StrategyControlState }) {
  return <div data-testid="section-trade-direction">
    <h2 className="font-semibold">Trading direction</h2>
    <p className="text-xs text-muted-foreground mt-2">Choose whether this strategy can take Long, Short, or both directions.</p>
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
      {DIRECTIONS.map(item => <button key={item.value} type="button" className={`min-h-14 rounded-lg border px-4 py-3 text-left transition-colors ${controls.direction === item.value ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-secondary"}`} onClick={() => controls.setDirection(item.value)} aria-pressed={controls.direction === item.value} data-testid={`button-builder-direction-${item.value}`}>
        <span className="block text-sm font-semibold">{item.value === "long" ? "BUY" : item.value === "short" ? "SELL" : "BUY or SELL"}</span>
        <span className="block text-[11px] text-muted-foreground mt-1">{item.value === "both" ? "Let entry conditions choose" : `${item.label} trades only`}</span>
      </button>)}
    </div>
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mt-5 pt-5 border-t border-border">
      <span className="text-[11px] text-muted-foreground">Save your direction before creating an immutable version.</span>
      <button type="button" className="btn btn-primary" onClick={controls.save} disabled={controls.updatePending} data-testid="button-save-builder-strategy-settings"><Save size={14} />{controls.updatePending ? "Saving…" : "Save Strategy"}</button>
    </div>
    {controls.error && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive mt-4" role="alert" data-testid="status-builder-settings-error">{controls.error}</div>}
  </div>;
}

function RiskControls({ controls }: { controls: StrategyControlState }) {
  return <div data-testid="section-exit-rules">
    <h2 className="font-semibold">Set your risk limits</h2>
    <p className="text-xs text-muted-foreground mt-2">The maximum amount you are willing to risk on one trade and the percentage exits the historical backtester understands.</p>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
      <label className={`rounded-lg border p-4 cursor-pointer ${controls.stopLossEnabled ? "border-destructive/50 bg-destructive/5" : "border-border"}`}>
        <span className="flex items-center gap-3"><input type="checkbox" checked={controls.stopLossEnabled} onChange={event => controls.setStopLossEnabled(event.target.checked)} data-testid="checkbox-builder-stop-loss" /><span className="text-sm font-semibold">Stop Loss</span></span>
        <span className="block text-[11px] text-muted-foreground mt-2">Close the trade when price moves against you.</span>
        {controls.stopLossEnabled && <span className="flex items-center gap-2 mt-3"><input className="input w-24" type="number" min="0.01" step="0.01" value={controls.stopLoss} onChange={event => controls.setStopLoss(event.target.value)} aria-label="Stop loss percentage" data-testid="input-builder-stop-loss" /><span className="text-sm text-muted-foreground">%</span></span>}
      </label>
      <label className={`rounded-lg border p-4 cursor-pointer ${controls.takeProfitEnabled ? "border-primary/50 bg-primary/5" : "border-border"}`}>
        <span className="flex items-center gap-3"><input type="checkbox" checked={controls.takeProfitEnabled} onChange={event => controls.setTakeProfitEnabled(event.target.checked)} data-testid="checkbox-builder-take-profit" /><span className="text-sm font-semibold">Take Profit</span></span>
        <span className="block text-[11px] text-muted-foreground mt-2">Close the trade when your target is reached.</span>
        {controls.takeProfitEnabled && <span className="flex items-center gap-2 mt-3"><input className="input w-24" type="number" min="0.01" step="0.01" value={controls.takeProfit} onChange={event => controls.setTakeProfit(event.target.value)} aria-label="Take profit percentage" data-testid="input-builder-take-profit" /><span className="text-sm text-muted-foreground">%</span></span>}
      </label>
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
      <Field label="Risk per trade" hint="Maximum planned loss for one trade."><div className="flex items-center gap-2"><input className="input" type="number" min="0.01" step="0.01" value={controls.riskBudget} onChange={event => controls.setRiskBudget(event.target.value)} placeholder="e.g. 1" data-testid="input-builder-risk-percent" /><span className="text-sm text-muted-foreground">%</span></div></Field>
      <Field label="Risk amount" hint="Optional personal sizing note."><input className="input" value={controls.riskAmount} onChange={event => controls.setRiskAmount(event.target.value)} placeholder="e.g. £100" data-testid="input-builder-risk-amount" /></Field>
      <Field label="Risk / reward" hint="Planned reward relative to risk."><div className="flex items-center gap-2"><input className="input" type="number" min="0.01" step="0.01" value={controls.riskReward} onChange={event => controls.setRiskReward(event.target.value)} placeholder="e.g. 2" data-testid="input-builder-risk-reward" /><span className="text-sm text-muted-foreground">R</span></div></Field>
    </div>
    {controls.error && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive mt-4" role="alert" data-testid="status-builder-settings-error">{controls.error}</div>}
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mt-5 pt-5 border-t border-border">
      <span className="text-[11px] text-muted-foreground">Exit-stage conditions are managed in the Exit section.</span>
      <button type="button" className="btn btn-primary" onClick={controls.save} disabled={controls.updatePending} data-testid="button-save-builder-risk-settings"><Save size={14} />{controls.updatePending ? "Saving…" : "Save Risk Settings"}</button>
    </div>
  </div>;
}

function ReviewControls({ strategy, controls }: { strategy: Strategy; controls: StrategyControlState }) {
  return <div className="space-y-5">
    <section className="rounded-lg border border-border p-4 md:p-5" data-testid="section-strategy-summary">
      <div className="eyebrow">Strategy</div>
      <h2 className="font-semibold mt-2">{strategy.name}</h2>
      <p className="text-sm text-muted-foreground mt-2">{strategy.marketSymbol || "No specific instrument"} · {controls.directionLabel} · {strategy.timeframes?.join(" · ") || "No timeframe selected"}</p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-5">
        {[
          ["Entry", controls.entryConditions],
          ["Confirmation", controls.confirmationConditions],
          ["Exit", controls.exitConditions],
        ].map(([label, rows]) => <div key={label as string}><div className="eyebrow">{label as string}</div>{(rows as StrategyCondition[]).length ? <div className="mt-2 space-y-2">{(rows as StrategyCondition[]).map(condition => <div key={condition.id} className="text-xs"><div className="font-semibold">{condition.name}</div><div className="text-muted-foreground mt-1">{condition.direction.toUpperCase()} · {condition.timeframe}</div><div className="mt-1">{condition.triggerRules || "No rule text"}</div></div>)}</div> : <div className="text-xs text-muted-foreground mt-2">None added</div>}</div>)}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5 pt-5 border-t border-border">
        <Summary label="Risk" value={controls.riskBudget ? `${controls.riskBudget}%` : "Not set"} />
        <Summary label="Risk / reward" value={controls.riskReward ? `${controls.riskReward}R` : "Not set"} />
        <Summary label="Stop Loss" value={controls.stopLossEnabled ? `${controls.stopLoss}%` : "Disabled"} />
        <Summary label="Take Profit" value={controls.takeProfitEnabled ? `${controls.takeProfit}%` : "Disabled"} />
      </div>
    </section>
    <section className={`rounded-lg border p-4 md:p-5 ${controls.compatible ? "border-primary/30 bg-primary/5" : "border-amber-500/40 bg-amber-500/5"}`} data-testid="section-backtest-compatibility">
      <div className="flex items-start gap-3">
        <ShieldCheck size={18} className={controls.compatible ? "text-primary shrink-0 mt-0.5" : "text-amber-300 shrink-0 mt-0.5"} />
        <div className="min-w-0">
          <div className="eyebrow">Backtest status</div>
          <h2 className="font-semibold mt-2">{controls.compatible ? "This strategy can be backtested." : controls.missingEntryCondition ? "Add an entry condition before backtesting." : "Some conditions cannot currently be backtested."}</h2>
          {controls.compatible ? <><p className="text-xs text-muted-foreground mt-2">All saved conditions and percentage exit rules are supported by the current historical backtester.</p><Link className="btn btn-primary mt-4" href="#strategy-version-manager" data-testid="link-builder-backtest-version"><ArrowRight size={13} /> Save a version, then Backtest This Version</Link></> : <><p className="text-xs text-muted-foreground mt-2">Backtesting cannot currently execute:</p><ul className="mt-3 space-y-1.5 text-xs text-amber-100">{controls.missingEntryCondition && <li>• No entry condition has been added</li>}{controls.unsupportedConditions.map(condition => <li key={condition}>• {condition}</li>)}{!isBacktestCompatibleRiskRules(strategy.riskManagementRules) && <li>• The current risk rules</li>}</ul></>}
        </div>
      </div>
    </section>
  </div>;
}

function ConceptsCard({ concepts }: { concepts: TradingConcept[] }) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const filtered = concepts.filter(concept => `${concept.name} ${concept.category || ""}`.toLowerCase().includes(search.toLowerCase()));
  return <Panel title="Trading Concept Library" eyebrow="Use your own vocabulary">
    <p className="text-xs text-muted-foreground mt-2 leading-relaxed">Conditions reference concepts centrally. Definitions stay independent from this strategy and can be customised in the library.</p>
    <div className="relative mt-5">
      <Search size={15} className="absolute left-3 top-3 text-muted-foreground" />
      <input className="input pl-9 pr-9" value={search} onChange={event => { setSearch(event.target.value); setOpen(true); }} onFocus={() => setOpen(true)} placeholder="Search concepts to review" data-testid="input-builder-library-search" />
      <ChevronDown size={15} className="absolute right-3 top-3 text-muted-foreground" />
      {open && <div className="absolute z-30 left-0 right-0 top-full mt-2 panel p-2 max-h-56 overflow-y-auto shadow-xl">{filtered.length ? filtered.map(concept => <div key={concept.id} className="px-3 py-2 rounded-md hover:bg-secondary"><div className="text-sm font-semibold">{concept.name}</div><div className="text-[10px] text-muted-foreground mt-1">{concept.category || "CUSTOM"} · {concept.isBuiltIn ? "Library concept" : "Custom concept"}</div></div>) : <div className="p-4 text-sm text-muted-foreground">No concepts match that search.</div>}</div>}
    </div>
    <div className="flex items-center justify-between gap-3 mt-5 pt-4 border-t border-border">
      <span className="text-[11px] text-muted-foreground">{concepts.length} concepts available</span>
      <Link href="/strategy-builder" className="text-xs text-primary hover:underline">Manage definitions <ChevronRight size={13} className="inline" /></Link>
    </div>
  </Panel>;
}

function AssistantDraftReview({ draft, action }: { draft: AssistantStrategyDraft; action: "review" | "save-version" }) {
  const entryConditions = draft.conditions.filter(condition => condition.stage === "entry" || condition.stage === "confirmation");
  const exitConditions = draft.conditions.filter(condition => condition.stage === "exit" || condition.stage === "invalidation");
  const unsupported = draft.compatibility.unsupportedConditions;
  return <section className="mb-5 rounded-lg border border-primary/30 bg-primary/5 p-4 md:p-5" data-testid="assistant-draft-builder-preview">
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <div className="eyebrow text-primary">{action === "save-version" ? "AI draft · save as new version" : "AI draft · review"}</div>
        <h2 className="font-semibold mt-2">{draft.name}</h2>
        <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
          {action === "save-version"
            ? "Review and edit this AI-generated draft first. Nothing is saved until you create the strategy and explicitly save a new immutable version."
            : "Review and edit this AI-generated draft before creating the strategy. Nothing has been saved."}
        </p>
      </div>
      <span className={`tag shrink-0 ${draft.compatibility.compatible ? "tag-active" : "tag-draft"}`}>
        {draft.compatibility.compatible ? "Backtest compatible" : "Compatibility review"}
      </span>
    </div>
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5">
      <Summary label="Direction" value={draft.direction} />
      <Summary label="Market" value={draft.marketSymbol || "Open"} />
      <Summary label="Timeframes" value={draft.timeframes.length ? draft.timeframes.join(", ") : "Open"} />
      <Summary label="Risk rules" value={draft.riskManagementRules || "Not set"} />
    </div>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
      <div className="rounded-md border border-border p-3" data-testid="assistant-draft-entry-conditions">
        <div className="eyebrow">Entry conditions</div>
        {entryConditions.length ? <div className="space-y-3 mt-3">{entryConditions.map(condition => <DraftCondition key={`${condition.stage}-${condition.name}`} condition={condition} />)}</div> : <p className="text-xs text-muted-foreground mt-2">No entry conditions supplied.</p>}
      </div>
      <div className="rounded-md border border-border p-3" data-testid="assistant-draft-exit-conditions">
        <div className="eyebrow">Exit conditions</div>
        {exitConditions.length ? <div className="space-y-3 mt-3">{exitConditions.map(condition => <DraftCondition key={`${condition.stage}-${condition.name}`} condition={condition} />)}</div> : <p className="text-xs text-muted-foreground mt-2">No exit conditions supplied.</p>}
      </div>
    </div>
    {unsupported.length > 0 && <div className="mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-100" data-testid="assistant-draft-compatibility-warning">
      <div className="font-semibold">Compatibility warnings</div>
      <p className="mt-1 leading-relaxed">These draft items are preserved for review and are not silently removed or replaced:</p>
      <ul className="mt-2 space-y-1">{unsupported.map(condition => <li key={condition}>• {condition}</li>)}</ul>
    </div>}
  </section>;
}

function DraftCondition({ condition }: { condition: AssistantStrategyDraft["conditions"][number] }) {
  return <div className="rounded-md bg-secondary/50 p-3">
    <div className="flex flex-wrap items-center gap-2">
      <span className="tag tag-active">{condition.stage}</span>
      <span className="tag tag-draft">{condition.requirement}</span>
      {!condition.supported && <span className="tag border-amber-500/40 text-amber-200">Review</span>}
    </div>
    <div className="text-xs font-semibold mt-2">{condition.name}</div>
    <div className="text-[11px] text-primary mt-1">{condition.conceptName}</div>
    <div className="text-[11px] text-muted-foreground mt-2 leading-relaxed">{condition.triggerRules}</div>
  </div>;
}

export function StrategyBuilder() {
  const [routeLocation] = useLocation();
  const strategies = useListStrategies();
  const markets = useListMarkets();
  const concepts = useListConcepts();
  const timeframes = useListTimeframes();
  const queryClient = useQueryClient();
  const searchParams = useMemo(() => new URLSearchParams(window.location.search), [routeLocation]);
  const requestedStrategyId = Number(searchParams.get("strategyId")) || null;
  const requestedVersionId = Number(searchParams.get("versionId")) || null;
  const requestedAssistantDraft = searchParams.get("assistantDraft") === "1";
  const assistantDraftAction = searchParams.get("assistantAction") === "save-version" ? "save-version" : "review";
  const [selectedStrategyId, setSelectedStrategyId] = useState<number | null>(requestedStrategyId);
  const [strategyModal, setStrategyModal] = useState<"new" | "edit" | false>(false);
  const [conditionModal, setConditionModal] = useState<StrategyCondition | "new" | false>(false);
  const [newConditionStage, setNewConditionStage] = useState<"entry" | "confirmation" | "exit">("entry");
  const [builderSection, setBuilderSection] = useState<BuilderSectionKey>("strategy");
  const [assistantDraft, setAssistantDraft] = useState<AssistantStrategyDraft | null>(() => {
    if (!requestedAssistantDraft) return null;
    return getPendingAssistantDraft();
  });
  useEffect(() => {
    if (!requestedAssistantDraft) {
      setAssistantDraft(null);
      return;
    }
    setAssistantDraft(getPendingAssistantDraft());
  }, [requestedAssistantDraft, routeLocation]);
  const [draftImportMessage, setDraftImportMessage] = useState("");
  const [unmatchedDraftConditions, setUnmatchedDraftConditions] = useState<AssistantStrategyDraft["conditions"]>([]);
  const createDraftCondition = useCreateStrategyCondition();
  const activeStrategy = useMemo(() => {
    if (assistantDraft) return null;
    const rows = strategies.data || [];
    return rows.find(strategy => strategy.id === selectedStrategyId) || rows[0] || null;
  }, [assistantDraft, selectedStrategyId, strategies.data]);
  const strategyId = activeStrategy?.id || 0;
  const strategyConditions = useListStrategyConditions(strategyId, { query: { enabled: !!strategyId, queryKey: getListStrategyConditionsQueryKey(strategyId) } });
  const savedStrategy = async (strategy: Strategy) => {
    setSelectedStrategyId(strategy.id);
    if (!assistantDraft) return;
    const unmatched: AssistantStrategyDraft["conditions"] = [];
    for (const [index, condition] of assistantDraft.conditions.entries()) {
      const concept = concepts.data?.find(item => item.name.trim().toLowerCase() === condition.conceptName.trim().toLowerCase());
      if (!concept) {
        unmatched.push(condition);
        continue;
      }
      try {
        await createDraftCondition.mutateAsync({
          strategyId: strategy.id,
          data: {
            conceptId: concept.id,
            stage: condition.stage,
            name: condition.name,
            description: `Prepared by AI Assistant from the ${condition.conceptName} concept.`,
            timeframe: condition.timeframe || strategy.timeframes?.[0] || "Not specified",
            direction: strategy.direction,
            requirement: condition.requirement,
            triggerRules: condition.triggerRules || null,
            invalidationRules: null,
            resetBehavior: null,
          },
        });
      } catch {
        unmatched.push(condition);
      }
      if (index === assistantDraft.conditions.length - 1) {
        queryClient.invalidateQueries({ queryKey: getListStrategyConditionsQueryKey(strategy.id) });
      }
    }
    setUnmatchedDraftConditions(unmatched);
    setDraftImportMessage(unmatched.length ? `Strategy created. These draft conditions need review before they can be added: ${unmatched.map(condition => condition.name).join(", ")}.` : "Strategy created with the assistant’s conditions. Review it, then save a new immutable version.");
    setAssistantDraft(null);
    clearPendingAssistantDraft();
  };
  const refreshConditions = () => queryClient.invalidateQueries({ queryKey: getListStrategyConditionsQueryKey(strategyId) });
  const action = <button className="btn btn-primary" onClick={() => setStrategyModal("new")} data-testid="button-new-builder-strategy"><Plus size={15} /> New strategy</button>;

  if (strategies.isLoading) return <BuilderPage><div className="panel p-10 text-center text-sm text-muted-foreground">Loading your strategies…</div></BuilderPage>;
  if (strategies.isError || markets.isError || concepts.isError || timeframes.isError) return <BuilderPage><div className="panel p-10 text-center"><div className="font-semibold">Couldn’t load the builder records</div><p className="text-sm text-muted-foreground mt-2">Your workspace is intact. Try refreshing the page.</p></div></BuilderPage>;
  return <BuilderPage action={action}>
     {!activeStrategy ? <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-5">
       <Panel title="Create the strategy foundation" eyebrow="Start without assumptions">
         {assistantDraft && <AssistantDraftReview draft={assistantDraft} action={assistantDraftAction} />}
        <p className="text-sm text-muted-foreground mt-3 max-w-2xl leading-relaxed">Give your strategy a name and describe the market context in your own words. Everything else can stay open until you are ready to define it.</p>
          <div className="mt-6"><StrategyForm markets={markets.data || []} timeframes={timeframes.data || []} strategy={null} initialDraft={assistantDraft} onSaved={savedStrategy} /></div>
      </Panel>
      <ConceptsCard concepts={concepts.data || []} />
      </div> : <div className="space-y-5">
        {draftImportMessage && <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 text-xs leading-relaxed" role="status" data-testid="assistant-draft-import-status">{draftImportMessage}</div>}
        {unmatchedDraftConditions.length > 0 && <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-xs text-amber-100 leading-relaxed" data-testid="assistant-draft-unmatched-conditions"><div className="font-semibold">AI draft conditions still need review</div><p className="mt-1">The following information was preserved because it could not be imported into the concept library:</p><div className="space-y-2 mt-3">{unmatchedDraftConditions.map(condition => <DraftCondition key={`${condition.stage}-${condition.name}`} condition={condition} />)}</div></div>}
       <div className="panel p-3 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0"><FileText size={16} /></div>
          <div className="min-w-0"><div className="eyebrow">Editing strategy</div><div className="font-semibold truncate mt-1">{activeStrategy.name}</div></div>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <select className="select min-w-0 sm:min-w-56" value={activeStrategy.id} onChange={event => setSelectedStrategyId(Number(event.target.value))} data-testid="select-builder-strategy">
            {(strategies.data || []).map(strategy => <option key={strategy.id} value={strategy.id}>{strategy.name}</option>)}
          </select>
          <button className="btn btn-secondary" onClick={() => setStrategyModal("edit")} data-testid="button-edit-builder-strategy"><Edit3 size={14} /> Edit details</button>
        </div>
       </div>
       <BuilderProgress current={builderSection} onSelect={setBuilderSection} />
       <StrategyControls strategy={activeStrategy} conditions={strategyConditions.data || []}>
         {controls => <div className="space-y-3">
          <BuilderAccordion section={BUILDER_SECTIONS[0]} open={builderSection === "strategy"} onOpen={() => setBuilderSection("strategy")}>
             <div className="eyebrow mb-4">Strategy details</div>
             <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
               <Summary label="Strategy name" value={activeStrategy.name} />
               <Summary label="Market" value={activeStrategy.marketSymbol || "No specific instrument"} />
               <Summary label="Direction" value={controls.directionLabel} />
               <Summary label="Timeframe" value={activeStrategy.timeframes?.join(" · ") || "Not set"} />
             </div>
             {activeStrategy.description && <p className="text-sm text-muted-foreground mt-4 leading-relaxed">{activeStrategy.description}</p>}
             <div className="mt-6 pt-5 border-t border-border"><DirectionControls controls={controls} /></div>
           </BuilderAccordion>
           <BuilderAccordion section={BUILDER_SECTIONS[1]} open={builderSection === "entry"} onOpen={() => setBuilderSection("entry")}>
             <p className="text-sm text-muted-foreground mb-4">Entry conditions decide when your strategy can enter a trade.</p>
             <div className="flex flex-wrap items-center gap-2 mb-4 text-[11px]" data-testid="builder-logic-legend"><span className="tag tag-active">AND</span><span className="text-muted-foreground">required checkpoints must all match</span><span className="tag ml-2">OR</span><span className="text-muted-foreground">not currently supported by Backtesting</span><span className="tag ml-2">Review required</span></div>
             {strategyConditions.isLoading ? <div className="panel p-6 text-center text-sm text-muted-foreground">Loading conditions…</div> : strategyConditions.isError ? <div className="panel p-6 text-center text-sm text-muted-foreground">Couldn’t load conditions.</div> : <ConditionFlow strategyId={strategyId} conditions={strategyConditions.data || []} marketSymbol={activeStrategy.marketSymbol || null} onlyStage="entry" onAdd={stage => { setNewConditionStage(stage); setConditionModal("new"); }} onEdit={condition => setConditionModal(condition)} onChanged={refreshConditions} />}
           </BuilderAccordion>
           <BuilderAccordion section={BUILDER_SECTIONS[2]} open={builderSection === "confirmation"} onOpen={() => setBuilderSection("confirmation")}>
             <p className="text-sm text-muted-foreground mb-4">Additional conditions that confirm your setup.</p>
             {strategyConditions.isLoading ? <div className="panel p-6 text-center text-sm text-muted-foreground">Loading conditions…</div> : <ConditionFlow strategyId={strategyId} conditions={strategyConditions.data || []} marketSymbol={activeStrategy.marketSymbol || null} onlyStage="confirmation" onAdd={stage => { setNewConditionStage(stage); setConditionModal("new"); }} onEdit={condition => setConditionModal(condition)} onChanged={refreshConditions} />}
           </BuilderAccordion>
           <BuilderAccordion section={BUILDER_SECTIONS[3]} open={builderSection === "exit"} onOpen={() => setBuilderSection("exit")}>
             <p className="text-sm text-muted-foreground mb-4">Conditions that tell TradeX when the trade should be closed.</p>
             {strategyConditions.isLoading ? <div className="panel p-6 text-center text-sm text-muted-foreground">Loading conditions…</div> : <ConditionFlow strategyId={strategyId} conditions={strategyConditions.data || []} marketSymbol={activeStrategy.marketSymbol || null} onlyStage="exit" onAdd={stage => { setNewConditionStage(stage); setConditionModal("new"); }} onEdit={condition => setConditionModal(condition)} onChanged={refreshConditions} />}
           </BuilderAccordion>
           <BuilderAccordion section={BUILDER_SECTIONS[4]} open={builderSection === "risk"} onOpen={() => setBuilderSection("risk")}><RiskControls controls={controls} /></BuilderAccordion>
           <BuilderAccordion section={BUILDER_SECTIONS[5]} open={builderSection === "review"} onOpen={() => setBuilderSection("review")}><ReviewControls strategy={activeStrategy} controls={controls} /></BuilderAccordion>
         </div>}
       </StrategyControls>
       <details className="panel p-4 group" data-testid="builder-supporting-tools">
         <summary className="cursor-pointer list-none flex items-center justify-between"><span><span className="eyebrow">Supporting tools</span><span className="block text-sm font-semibold mt-1">Version history and trading concepts</span></span><ChevronDown size={17} className="text-muted-foreground transition-transform group-open:rotate-180" /></summary>
         <div className="space-y-5 mt-5"><StrategyVersionManager strategy={activeStrategy} compact initialVersionId={requestedVersionId} /><ConceptsCard concepts={concepts.data || []} /></div>
       </details>
    </div>}
     {strategyModal && <Modal title={strategyModal === "edit" ? "Edit strategy details" : "New strategy"} onClose={() => setStrategyModal(false)}><StrategyForm strategy={strategyModal === "edit" ? activeStrategy : null} markets={markets.data || []} timeframes={timeframes.data || []} onClose={() => setStrategyModal(false)} onSaved={savedStrategy} /></Modal>}
      {conditionModal && activeStrategy && <ConditionModal key={conditionModal === "new" ? `new-${newConditionStage}` : conditionModal.id} strategyId={activeStrategy.id} concepts={concepts.data || []} timeframes={timeframes.data || []} defaultStage={newConditionStage} condition={conditionModal === "new" ? null : conditionModal} onClose={() => setConditionModal(false)} onSaved={refreshConditions} />}
  </BuilderPage>;
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div className="p-3 rounded-md bg-secondary/50 min-w-0"><div className="eyebrow">{label}</div><div className="text-sm font-semibold mt-2 truncate">{value}</div></div>;
}

function RuleSummary({ label, value }: { label: string; value: string | null }) {
  return <div><div className="eyebrow">{label}</div><p className="text-xs text-muted-foreground mt-1.5 line-clamp-3">{value || "Not defined"}</p></div>;
}