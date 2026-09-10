import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "wouter";
import {
  ArrowDown, ArrowUp, Check, ChevronDown, ChevronRight, Edit3, FileText, Pencil, Plus,
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
  useReorderStrategyConditions,
  useUpdateStrategy,
  useUpdateStrategyCondition,
  type Market,
  type Strategy,
  type StrategyCondition,
  type TradingConcept,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { StrategyVersionManager } from "@/components/strategy-versioning";

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
    <div className="flex items-start justify-between gap-5 mb-8">
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

function StrategyForm({ strategy, markets, onClose, onSaved }: { strategy: Strategy | null; markets: Market[]; onClose?: () => void; onSaved: (strategy: Strategy) => void }) {
  const create = useCreateStrategy();
  const update = useUpdateStrategy();
  const queryClient = useQueryClient();
  const [error, setError] = useState("");
  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") || "").trim();
    if (!name) {
      setError("Please give your strategy a name.");
      return;
    }
    const timeframes = String(form.get("timeframes") || "").split(",").map(value => value.trim()).filter(Boolean);
    const data = {
      name,
      description: String(form.get("description") || "") || null,
      marketId: form.get("marketId") ? Number(form.get("marketId")) : null,
      assetClass: String(form.get("assetClass") || "") || null,
      direction: String(form.get("direction") || "both") as "long" | "short" | "both",
      timeframes,
      riskManagementRules: String(form.get("riskManagementRules") || "") || null,
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
  return <form onSubmit={save} className="space-y-6" key={strategy?.id ?? "new-strategy"}>
    {error && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive" role="alert" data-testid="status-builder-strategy-error">{error}</div>}
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Field label="Strategy name"><input className="input" name="name" required defaultValue={strategy?.name || ""} placeholder="Name your hypothesis" data-testid="input-builder-strategy-name" /></Field>
      <Field label="Asset class" hint="Keep this general if the strategy is not asset-specific."><input className="input" name="assetClass" defaultValue={strategy?.assetClass || ""} placeholder="Optional — e.g. equity, FX, crypto" data-testid="input-builder-asset-class" /></Field>
    </div>
    <Field label="Description"><textarea className="textarea" name="description" defaultValue={strategy?.description || ""} placeholder="What is this strategy trying to explain or capture?" data-testid="input-builder-strategy-description" /></Field>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Field label="Market / instrument" hint="Optional. Add instruments from Market Monitor first, or leave this strategy broad.">
        <select className="select" name="marketId" defaultValue={strategy?.marketId || ""} data-testid="select-builder-market">
          <option value="">No specific instrument</option>
          {markets.map(market => <option key={market.id} value={market.id}>{market.symbol} · {market.assetClass}</option>)}
        </select>
      </Field>
      <Field label="Trading direction">
        <select className="select" name="direction" defaultValue={strategy?.direction || "both"} data-testid="select-builder-direction">
          {DIRECTIONS.map(direction => <option key={direction.value} value={direction.value}>{direction.label}</option>)}
        </select>
      </Field>
    </div>
    <Field label="Timeframes" hint="Separate multiple timeframes with commas. This is descriptive only; it does not connect to market data.">
      <input className="input mono" name="timeframes" defaultValue={strategy?.timeframes?.join(", ") || ""} placeholder="e.g. Daily, 4H, 15m" data-testid="input-builder-timeframes" />
    </Field>
    <details className="border-t border-border pt-6 group" data-testid="builder-advanced-notes">
      <summary className="cursor-pointer list-none flex items-center justify-between">
        <span><span className="eyebrow">Advanced notes</span><span className="block text-xs text-muted-foreground mt-2">Optional reset, risk, and review notes.</span></span>
        <ChevronDown size={16} className="text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-5">
        <Field label="Risk-management notes"><textarea className="textarea" name="riskManagementRules" defaultValue={strategy?.riskManagementRules || ""} placeholder="For simple percentage exits, use the Exit Rules section after saving." data-testid="input-builder-risk-rules" /></Field>
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

function ConditionModal({ strategyId, concepts, condition, onClose, onSaved }: { strategyId: number; concepts: TradingConcept[]; condition: StrategyCondition | null; onClose: () => void; onSaved: () => void }) {
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
  return <Modal title={condition ? "Edit condition" : "Add condition"} onClose={onClose}>
    <form onSubmit={save} className="space-y-5">
      {error && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive" role="alert" data-testid="status-builder-condition-error">{error}</div>}
      <Field label="Concept from Trading Concept Library">
        <SearchableConcept concepts={concepts} value={conceptId} onChange={setConceptId} />
      </Field>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Condition name" hint="Use words you would say out loud."><input className="input" name="name" defaultValue={condition?.name || ""} placeholder="e.g. Candle confirms momentum" data-testid="input-builder-condition-name" /></Field>
        <Field label="Stage">
          <select className="select" name="stage" defaultValue={condition?.stage || "entry"} data-testid="select-builder-condition-stage">
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
        <Field label="Timeframe" hint="Example: 4H or 15m."><input className="input" name="timeframe" defaultValue={condition?.timeframe || ""} placeholder="e.g. 4H" data-testid="input-builder-condition-timeframe" /></Field>
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

function ConditionFlow({ strategyId, conditions, concepts, onAdd, onEdit, onChanged }: { strategyId: number; conditions: StrategyCondition[]; concepts: TradingConcept[]; onAdd: () => void; onEdit: (condition: StrategyCondition) => void; onChanged: () => void }) {
  const reorder = useReorderStrategyConditions();
  const remove = useDeleteStrategyCondition();
  const queryClient = useQueryClient();
  const ordered = [...conditions].sort((a, b) => a.order - b.order);
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
  if (!ordered.length) return <div className="panel empty-grid p-8 md:p-12 text-center" data-testid="builder-empty-entry-conditions">
    <div className="w-11 h-11 mx-auto rounded-xl border border-primary/30 bg-primary/10 text-primary flex items-center justify-center mb-5"><SlidersHorizontal size={20} /></div>
    <h3 className="font-semibold text-lg">No entry conditions yet.</h3>
    <p className="text-sm text-muted-foreground max-w-md mx-auto mt-2 leading-relaxed">Add a condition to tell the strategy when to enter a trade.</p>
    <button className="btn btn-primary mt-6" onClick={onAdd} data-testid="button-empty-add-strategy-condition"><Plus size={14} /> Add Condition</button>
  </div>;
  return <div className="space-y-0" data-testid="strategy-condition-flow">
    {ordered.map((condition, index) => <div key={condition.id}>
      <div className="panel panel-hover p-4 md:p-5">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center mono text-xs font-bold shrink-0">{String(index + 1).padStart(2, "0")}</div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="tag tag-active">{condition.stage}</span>
              <span className={`tag ${condition.requirement === "required" ? "tag-active" : "tag-draft"}`}>{condition.requirement}</span>
              <span className="tag tag-draft">{condition.timeframe}</span>
              <span className="tag tag-draft">{condition.direction}</span>
            </div>
            <h3 className="font-semibold mt-3">{condition.name}</h3>
            <div className="text-xs text-primary mt-1">{condition.conceptName}</div>
            {condition.description && <p className="text-xs text-muted-foreground mt-2 leading-relaxed">{condition.description}</p>}
            {condition.triggerRules && <div className="mt-4 p-3 rounded-md bg-secondary/50"><div className="eyebrow">Trigger rules</div><p className="text-xs text-muted-foreground mt-1 leading-relaxed">{condition.triggerRules}</p></div>}
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
    </div>)}
    <div className="panel border-primary/30 bg-primary/5 px-5 py-4 text-center">
      <div className="eyebrow text-primary">Strategy endpoint</div>
      <div className="font-semibold mt-2 flex items-center justify-center gap-2"><Zap size={15} className="text-primary" /> ENTRY</div>
      <p className="text-[11px] text-muted-foreground mt-1">Required conditions are combined as AND. No entry signal is generated here.</p>
    </div>
  </div>;
}

function riskPercent(value: string | null, label: "stop-loss" | "take-profit") {
  const match = value?.match(new RegExp(`${label}\\s*[:=]?\\s*(\\d+(?:\\.\\d+)?)\\s*%`, "i"));
  return match ? match[1] : "";
}

function riskNarrative(value: string | null) {
  return value?.split(/[;\n]+/)
    .map(part => part.trim())
    .filter(part => part && !/(?:stop[- ]loss|sl|take[- ]profit|tp)\s*[:=]?\s*\d+(?:\.\d+)?\s*%/i.test(part))
    .join("; ") || "";
}

function StrategyControls({ strategy, conditions }: { strategy: Strategy; conditions: StrategyCondition[] }) {
  const update = useUpdateStrategy();
  const queryClient = useQueryClient();
  const [direction, setDirection] = useState<"long" | "short" | "both">(strategy.direction);
  const [stopLossEnabled, setStopLossEnabled] = useState(Boolean(riskPercent(strategy.riskManagementRules, "stop-loss")));
  const [takeProfitEnabled, setTakeProfitEnabled] = useState(Boolean(riskPercent(strategy.riskManagementRules, "take-profit")));
  const [stopLoss, setStopLoss] = useState(riskPercent(strategy.riskManagementRules, "stop-loss") || "1");
  const [takeProfit, setTakeProfit] = useState(riskPercent(strategy.riskManagementRules, "take-profit") || "2");
  const [error, setError] = useState("");

  useEffect(() => {
    setDirection(strategy.direction);
    setStopLossEnabled(Boolean(riskPercent(strategy.riskManagementRules, "stop-loss")));
    setTakeProfitEnabled(Boolean(riskPercent(strategy.riskManagementRules, "take-profit")));
    setStopLoss(riskPercent(strategy.riskManagementRules, "stop-loss") || "1");
    setTakeProfit(riskPercent(strategy.riskManagementRules, "take-profit") || "2");
  }, [strategy.id, strategy.direction, strategy.riskManagementRules]);

  const entryConditions = conditions.filter(condition => condition.stage === "entry" || condition.stage === "confirmation");
  const exitConditions = conditions.filter(condition => condition.stage === "exit" || condition.stage === "invalidation");
  const unsupportedConditions = conditions.filter(condition => !isBacktestCompatibleRule(condition.triggerRules)).map(condition => condition.name || "Unnamed condition");
  const missingEntryCondition = entryConditions.length === 0;
  const compatible = !missingEntryCondition && unsupportedConditions.length === 0 && isBacktestCompatibleRiskRules(strategy.riskManagementRules);
  const riskRules = [
    riskNarrative(strategy.riskManagementRules),
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

  return <div className="space-y-5">
    <section className="panel p-5 md:p-6" data-testid="section-trade-direction">
      <div className="eyebrow">03 · Trade direction</div>
      <h2 className="font-semibold mt-2">Which way can this strategy trade?</h2>
      <p className="text-xs text-muted-foreground mt-2">Choose one direction. The choice is saved with the strategy.</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-5">
        {DIRECTIONS.map(item => <button key={item.value} type="button" className={`min-h-14 rounded-lg border px-4 py-3 text-left transition-colors ${direction === item.value ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-secondary"}`} onClick={() => setDirection(item.value)} aria-pressed={direction === item.value} data-testid={`button-builder-direction-${item.value}`}>
          <span className="block text-sm font-semibold">{item.value === "long" ? "BUY" : item.value === "short" ? "SELL" : "BUY or SELL"}</span>
          <span className="block text-[11px] text-muted-foreground mt-1">{item.value === "both" ? "Let entry conditions choose" : `${item.label} trades only`}</span>
        </button>)}
      </div>
    </section>

    <section className="panel p-5 md:p-6" data-testid="section-exit-rules">
      <div className="eyebrow">04 · Exit rules</div>
      <h2 className="font-semibold mt-2">Protect the trade simply</h2>
      <p className="text-xs text-muted-foreground mt-2">These percentages use the same saved risk rules the existing Backtesting engine understands.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-5">
        <label className={`rounded-lg border p-4 cursor-pointer ${stopLossEnabled ? "border-destructive/50 bg-destructive/5" : "border-border"}`}>
          <span className="flex items-center gap-3"><input type="checkbox" checked={stopLossEnabled} onChange={event => setStopLossEnabled(event.target.checked)} data-testid="checkbox-builder-stop-loss" /><span className="text-sm font-semibold">Stop Loss</span></span>
          {stopLossEnabled && <span className="flex items-center gap-2 mt-4"><input className="input w-24" type="number" min="0.01" step="0.01" value={stopLoss} onChange={event => setStopLoss(event.target.value)} aria-label="Stop loss percentage" data-testid="input-builder-stop-loss" /><span className="text-sm text-muted-foreground">%</span></span>}
        </label>
        <label className={`rounded-lg border p-4 cursor-pointer ${takeProfitEnabled ? "border-primary/50 bg-primary/5" : "border-border"}`}>
          <span className="flex items-center gap-3"><input type="checkbox" checked={takeProfitEnabled} onChange={event => setTakeProfitEnabled(event.target.checked)} data-testid="checkbox-builder-take-profit" /><span className="text-sm font-semibold">Take Profit</span></span>
          {takeProfitEnabled && <span className="flex items-center gap-2 mt-4"><input className="input w-24" type="number" min="0.01" step="0.01" value={takeProfit} onChange={event => setTakeProfit(event.target.value)} aria-label="Take profit percentage" data-testid="input-builder-take-profit" /><span className="text-sm text-muted-foreground">%</span></span>}
        </label>
      </div>
      <label className="block mt-4"><span className="label">Optional exit condition</span><select className="select" defaultValue="" data-testid="select-builder-exit-condition"><option value="">No condition selected</option>{exitConditions.map(condition => <option key={condition.id} value={condition.id}>{condition.name}</option>)}</select><span className="block text-[11px] text-muted-foreground mt-1.5">Add an exit-stage condition from the Entry Conditions area when you need one. Exit conditions are stored separately from risk percentages.</span></label>
      {error && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive mt-4" role="alert" data-testid="status-builder-settings-error">{error}</div>}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mt-5 pt-5 border-t border-border">
        <span className="text-[11px] text-muted-foreground">Save these editable settings first, then use “Save as New Version” below to create an immutable snapshot for Backtesting.</span>
        <button type="button" className="btn btn-primary" onClick={save} disabled={update.isPending} data-testid="button-save-builder-strategy-settings"><Save size={14} />{update.isPending ? "Saving…" : "Save Strategy"}</button>
      </div>
    </section>

    <section className="panel p-5 md:p-6" data-testid="section-strategy-summary">
      <div className="eyebrow">05 · Strategy summary</div>
      <h2 className="font-semibold mt-2">Your strategy</h2>
      <div className="mt-5 rounded-lg border border-primary/25 bg-primary/5 p-4 md:p-5 text-sm leading-relaxed">
        <p><strong>{directionLabel}</strong> when:</p>
        {entryConditions.length ? <div className="mt-3 space-y-2">{entryConditions.map((condition, index) => <div key={condition.id} className="flex gap-3"><span className="mono text-primary text-xs">{index ? "AND" : "01"}</span><span>{condition.triggerRules || condition.name}</span></div>)}</div> : <p className="text-muted-foreground mt-3">No entry conditions yet. Add a condition to tell the strategy when to enter a trade.</p>}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-5 pt-5 border-t border-primary/15">
          <div><div className="eyebrow">Stop Loss</div><div className="font-semibold mt-1">{stopLossEnabled ? `${stopLoss}%` : "Disabled"}</div></div>
          <div><div className="eyebrow">Take Profit</div><div className="font-semibold mt-1">{takeProfitEnabled ? `${takeProfit}%` : "Disabled"}</div></div>
        </div>
        {exitConditions.length > 0 && <p className="text-xs text-muted-foreground mt-4">Exit conditions: {exitConditions.map(condition => condition.name).join(", ")}.</p>}
      </div>
      <p className="text-[11px] text-muted-foreground mt-4">This is a plain-English view of saved conditions. It describes your process; it does not recommend trades or create signals.</p>
    </section>
    <section className={`panel p-5 md:p-6 ${compatible ? "border-primary/30 bg-primary/5" : "border-amber-500/40 bg-amber-500/5"}`} data-testid="section-backtest-compatibility">
      <div className="flex items-start gap-3">
        <ShieldCheck size={18} className={compatible ? "text-primary shrink-0 mt-0.5" : "text-amber-300 shrink-0 mt-0.5"} />
        <div className="min-w-0">
          <div className="eyebrow">Backtesting compatibility</div>
          <h2 className="font-semibold mt-2">{compatible ? "This strategy can be backtested." : missingEntryCondition ? "Add an entry condition before backtesting." : "Some conditions cannot currently be backtested."}</h2>
          {compatible ? <p className="text-xs text-muted-foreground mt-2 leading-relaxed">The saved conditions and percentage exit rules use capabilities available in the current historical backtester.</p> : <><p className="text-xs text-muted-foreground mt-2 leading-relaxed">You can still save this strategy, but the current backtester cannot evaluate:</p><ul className="mt-3 space-y-1.5 text-xs text-amber-100">{missingEntryCondition && <li>• No entry condition has been added</li>}{unsupportedConditions.map(condition => <li key={condition}>• {condition}</li>)}{!isBacktestCompatibleRiskRules(strategy.riskManagementRules) && <li>• The current risk rules</li>}</ul><p className="text-[11px] text-muted-foreground mt-3">This limitation is shown before you try to run a backtest.</p></>}
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

export function StrategyBuilder() {
  const strategies = useListStrategies();
  const markets = useListMarkets();
  const concepts = useListConcepts();
  const queryClient = useQueryClient();
  const requestedStrategyId = Number(new URLSearchParams(window.location.search).get("strategyId")) || null;
  const requestedVersionId = Number(new URLSearchParams(window.location.search).get("versionId")) || null;
  const [selectedStrategyId, setSelectedStrategyId] = useState<number | null>(requestedStrategyId);
  const [strategyModal, setStrategyModal] = useState<"new" | "edit" | false>(false);
  const [conditionModal, setConditionModal] = useState<StrategyCondition | "new" | false>(false);
  const activeStrategy = useMemo(() => {
    const rows = strategies.data || [];
    return rows.find(strategy => strategy.id === selectedStrategyId) || rows[0] || null;
  }, [selectedStrategyId, strategies.data]);
  const strategyId = activeStrategy?.id || 0;
  const strategyConditions = useListStrategyConditions(strategyId, { query: { enabled: !!strategyId, queryKey: getListStrategyConditionsQueryKey(strategyId) } });
  const savedStrategy = (strategy: Strategy) => setSelectedStrategyId(strategy.id);
  const refreshConditions = () => queryClient.invalidateQueries({ queryKey: getListStrategyConditionsQueryKey(strategyId) });
  const action = <button className="btn btn-primary" onClick={() => setStrategyModal("new")} data-testid="button-new-builder-strategy"><Plus size={15} /> New strategy</button>;

  if (strategies.isLoading) return <BuilderPage><div className="panel p-10 text-center text-sm text-muted-foreground">Loading your strategies…</div></BuilderPage>;
  if (strategies.isError || markets.isError || concepts.isError) return <BuilderPage><div className="panel p-10 text-center"><div className="font-semibold">Couldn’t load the builder records</div><p className="text-sm text-muted-foreground mt-2">Your workspace is intact. Try refreshing the page.</p></div></BuilderPage>;
  return <BuilderPage action={action}>
    {!activeStrategy ? <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-5">
      <Panel title="Create the strategy foundation" eyebrow="Start without assumptions">
        <p className="text-sm text-muted-foreground mt-3 max-w-2xl leading-relaxed">Give your strategy a name and describe the market context in your own words. Everything else can stay open until you are ready to define it.</p>
        <div className="mt-6"><StrategyForm markets={markets.data || []} strategy={null} onSaved={savedStrategy} /></div>
      </Panel>
      <ConceptsCard concepts={concepts.data || []} />
    </div> : <div className="space-y-5">
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
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-5">
        <div className="space-y-5">
           <Panel title="Strategy details" eyebrow="01 · Your operating frame">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5">
              <Summary label="Direction" value={activeStrategy.direction} />
              <Summary label="Asset class" value={activeStrategy.assetClass || "Open"} />
              <Summary label="Instrument" value={activeStrategy.marketSymbol || "Open"} />
              <Summary label="Timeframes" value={activeStrategy.timeframes?.length ? activeStrategy.timeframes.join(", ") : "Open"} />
            </div>
            {activeStrategy.description && <p className="text-sm text-muted-foreground mt-5 leading-relaxed">{activeStrategy.description}</p>}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-5 pt-5 border-t border-border">
              <RuleSummary label="Risk management" value={activeStrategy.riskManagementRules} />
              <RuleSummary label="Reset" value={activeStrategy.resetRules} />
              <RuleSummary label="Alerts" value={activeStrategy.alertRules} />
            </div>
          </Panel>
           <div className="flex items-end justify-between gap-4">
             <div><div className="eyebrow">02 · Entry conditions</div><h2 className="font-semibold mt-2">When should the strategy enter?</h2><p className="text-xs text-muted-foreground mt-2">Choose a plain-language condition. Required conditions are combined as AND.</p><div className="flex flex-wrap items-center gap-2 mt-3 text-[11px]" data-testid="builder-logic-legend"><span className="tag tag-active">AND</span><span className="text-muted-foreground">required checkpoints must all match</span><span className="tag ml-2">OR</span><span className="text-muted-foreground">not currently supported by Backtesting</span></div></div>
             <button className="btn btn-primary" onClick={() => setConditionModal("new")} data-testid="button-add-strategy-condition"><Plus size={14} /> Add Condition</button>
          </div>
          {strategyConditions.isLoading ? <div className="panel p-8 text-center text-sm text-muted-foreground">Loading conditions…</div> : strategyConditions.isError ? <div className="panel p-8 text-center text-sm text-muted-foreground">Couldn’t load conditions.</div> : <ConditionFlow strategyId={strategyId} conditions={strategyConditions.data || []} concepts={concepts.data || []} onAdd={() => setConditionModal("new")} onEdit={condition => setConditionModal(condition)} onChanged={refreshConditions} />}
           <StrategyControls strategy={activeStrategy} conditions={strategyConditions.data || []} />
        </div>
        <div className="space-y-5">
           <StrategyVersionManager strategy={activeStrategy} compact initialVersionId={requestedVersionId} />
          <ConceptsCard concepts={concepts.data || []} />
          <Panel title="Builder boundaries" eyebrow="What this page does not do">
            <ul className="mt-4 space-y-3 text-xs text-muted-foreground leading-relaxed">
              <li className="flex gap-2"><span className="text-primary">—</span><span>Records your definitions; it does not invent them.</span></li>
              <li className="flex gap-2"><span className="text-primary">—</span><span>Shows sequence; it does not detect live conditions.</span></li>
              <li className="flex gap-2"><span className="text-primary">—</span><span>Stores alert rules as notes; it does not generate signals.</span></li>
            </ul>
          </Panel>
        </div>
      </div>
    </div>}
    {strategyModal && <Modal title={strategyModal === "edit" ? "Edit strategy details" : "New strategy"} onClose={() => setStrategyModal(false)}><StrategyForm strategy={strategyModal === "edit" ? activeStrategy : null} markets={markets.data || []} onClose={() => setStrategyModal(false)} onSaved={savedStrategy} /></Modal>}
     {conditionModal && activeStrategy && <ConditionModal key={conditionModal === "new" ? "new" : conditionModal.id} strategyId={activeStrategy.id} concepts={concepts.data || []} condition={conditionModal === "new" ? null : conditionModal} onClose={() => setConditionModal(false)} onSaved={refreshConditions} />}
  </BuilderPage>;
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div className="p-3 rounded-md bg-secondary/50 min-w-0"><div className="eyebrow">{label}</div><div className="text-sm font-semibold mt-2 truncate">{value}</div></div>;
}

function RuleSummary({ label, value }: { label: string; value: string | null }) {
  return <div><div className="eyebrow">{label}</div><p className="text-xs text-muted-foreground mt-1.5 line-clamp-3">{value || "Not defined"}</p></div>;
}