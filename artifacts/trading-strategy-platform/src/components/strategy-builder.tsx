import { Fragment, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import {
  ArrowDown, ArrowRight, ArrowUp, Check, ChevronDown, ChevronRight, Edit3, FileText, Pencil, Plus,
  AlertTriangle, LoaderCircle, Save, Search, ShieldCheck, SlidersHorizontal, Sparkles, Trash2, X, Zap,
} from "lucide-react";
import {
  getGetDashboardSummaryQueryKey,
  getListMarketsQueryKey,
  getListStrategiesQueryKey,
  getListStrategyConditionsQueryKey,
  useCreateStrategyVersion,
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
  useChatAssistant,
  type Market,
  type Strategy,
  type StrategyCondition,
  type Timeframe,
  type TradingConcept,
  type AssistantStrategyDraft,
  type AssistantChatResponse,
} from "@workspace/api-client-react";
import {
  DEFAULT_FAIR_VALUE_GAP_PARAMETERS,
  DEFAULT_LIQUIDITY_SWEEP_PARAMETERS,
  DEFAULT_INDICATOR_PARAMETERS,
  DEFAULT_LIQUIDITY_LEVEL_PARAMETERS,
  DEFAULT_MARKET_STRUCTURE_PARAMETERS,
  DEFAULT_PRICE_ACTION_PARAMETERS,
  DEFAULT_RANGE_LOCATION_PARAMETERS,
  DEFAULT_DISPLACEMENT_PARAMETERS,
  DEFAULT_REJECTION_PARAMETERS,
  DEFAULT_FAILED_BREAKOUT_PARAMETERS,
  DEFAULT_SESSION_PARAMETERS,
  CANONICAL_SESSION_DEFINITIONS,
  executableConceptTriggerRules,
  executableConceptKind,
  isHistoricalRuleSupported,
  normalizeExecutableParameters,
  resolveTradingConcept,
} from "@workspace/api-zod";
import { useQueryClient } from "@tanstack/react-query";
import { StrategyVersionManager } from "@/components/strategy-versioning";
import { clearPendingAssistantDraft, getPendingAssistantDraft, setPendingAssistantDraft } from "@/lib/assistant-draft-store";

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

function conceptSearchText(concept: TradingConcept) {
  return `${concept.name} ${concept.category || ""} ${(concept.aliases || []).join(" ")}`.toLowerCase();
}

function conceptHasExecutableParameters(concept: TradingConcept) {
  return concept.canonicalStatus === "executable"
    && Boolean(normalizeExecutableParameters(concept.name, undefined));
}

function conditionNameFor(concept: TradingConcept | undefined, rule: string) {
  if (!concept) return "";
  const preset = RULE_PRESETS.find(candidate => candidate.value === rule);
  if (!preset) return concept.name;
  const lead = preset.label
    .replace(/^Candle is /, "")
    .replace(/^Price is /, "")
    .replace(/^Price /, "")
    .replace(/^Always true$/, "Always");
  return `${lead} ${concept.name}`;
}

function rulePresetFor(value: string | null) {
  return RULE_PRESETS.find(preset => preset.rule === value?.trim().toLowerCase())?.value ?? "custom";
}

function friendlyMutationError(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message.replace(/^Error:\s*/i, "") : fallback;
}

function isBacktestCompatibleRule(rule: string | null | undefined) {
  return isHistoricalRuleSupported(rule);
}

function isBacktestCompatibleCondition(condition: Pick<StrategyCondition, "conceptName" | "triggerRules" | "parameters">) {
  const canonical = resolveTradingConcept(condition.conceptName);
  if (canonical?.status === "review_required") return false;
  return isBacktestCompatibleRule(condition.triggerRules)
    || Boolean(normalizeExecutableParameters(condition.conceptName, condition.parameters));
}

function isBacktestCompatibleRiskRules(riskRules: string | null | undefined) {
  if (!riskRules?.trim()) return true;
  const mentionsRisk = /(?:stop[- ]loss|sl|take[- ]profit|tp|risk[\/ -]?reward|r\s*:\s*r)/i.test(riskRules);
  if (!mentionsRisk) return true;
  if (/(?:below|above)\s+(?:the\s+)?(?:fvg|fair value gap)|(?:trailing|break even|structural)\s+(?:stop|exit)|structural\s+fvg\s+boundary/i.test(riskRules)) return false;
  const hasStopLoss = /(?:stop[- ]loss|sl)\s*[:=]?\s*\d+(?:\.\d+)?\s*%/i.test(riskRules);
  const hasTakeProfit = /(?:take[- ]profit|tp)\s*[:=]?\s*\d+(?:\.\d+)?\s*%/i.test(riskRules);
  const hasRiskReward = /(?:risk[\/ -]?reward|r\s*:\s*r)\s*[:=]?\s*\d+(?:\.\d+)?\s*R\b/i.test(riskRules);
  return hasStopLoss || hasTakeProfit || (hasRiskReward && hasStopLoss);
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

function BuildWithAI({ onReview }: { onReview: (draft: AssistantStrategyDraft) => void }) {
  const chat = useChatAssistant();
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<AssistantChatResponse | null>(null);
  const [error, setError] = useState("");

  const close = () => {
    if (chat.isPending) return;
    setOpen(false);
    setPrompt("");
    setResult(null);
    setError("");
  };

  const generate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const message = prompt.trim();
    if (!message || chat.isPending) return;
    setError("");
    setResult(null);
    chat.mutate({
      data: {
        message,
        messages: [{ role: "user", content: message }],
        context: { page: "/strategy-builder-ai" },
      },
    }, {
      onSuccess: response => {
        if (response?.status === "available" && response.strategyDraft) {
          setResult(response);
          return;
        }
        setError("Unable to generate strategy.");
      },
      onError: () => setError("Unable to generate strategy."),
    });
  };

  const draft = result?.strategyDraft;
  const count = (stage: string) => draft?.conditions.filter(condition => condition.stage === stage).length || 0;

  return <>
    <button className="btn btn-secondary" onClick={() => { setOpen(true); setError(""); }} data-testid="button-build-with-ai">
      <Sparkles size={15} /> Build with AI
    </button>
    {open && <Modal title="BUILD A STRATEGY WITH AI" onClose={close}>
      {!draft ? <form onSubmit={generate} className="space-y-5">
        <p className="text-sm text-muted-foreground leading-relaxed">
          Describe the strategy you want to build and TradeX will turn it into a strategy you can review and edit.
        </p>
        {error && <div className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive" role="alert" data-testid="status-build-with-ai-error">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" /><span>{error}</span>
        </div>}
        <Field label="Describe your strategy">
          <textarea
            className="textarea min-h-36 resize-y"
            value={prompt}
            maxLength={2000}
            onChange={event => setPrompt(event.target.value)}
            placeholder="Describe your strategy..."
            autoFocus
            data-testid="input-build-with-ai-prompt"
          />
        </Field>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          You can use normal language or paste a structured TRADEX STRATEGY prompt with Entry, Confirmation, Exit, and Risk sections.
        </p>
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button type="button" className="btn btn-secondary" onClick={close} disabled={chat.isPending} data-testid="button-cancel-build-with-ai">Cancel</button>
          <button className="btn btn-primary" disabled={!prompt.trim() || chat.isPending} data-testid="button-generate-strategy">
            {chat.isPending ? <><LoaderCircle size={14} className="animate-spin" /> Generating…</> : <><Sparkles size={14} /> Generate Strategy</>}
          </button>
        </div>
      </form> : <div className="space-y-5" data-testid="build-with-ai-result">
        <div className="rounded-md border border-primary/30 bg-primary/5 p-4">
          <div className="eyebrow text-primary">STRATEGY GENERATED</div>
          <h3 className="mt-2 text-lg font-semibold">{draft.name}</h3>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{result?.reply}</p>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Summary label="Market" value={draft.marketSymbol || "Open"} />
          <Summary label="Direction" value={draft.direction} />
          <Summary label="Timeframes" value={draft.timeframes.length ? draft.timeframes.join(" · ") : "Review needed"} />
          <Summary label="Risk" value={draft.riskManagementRules || "Not set"} />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Summary label="Entry" value={`${count("entry")} condition${count("entry") === 1 ? "" : "s"}`} />
          <Summary label="Confirmation" value={`${count("confirmation")} condition${count("confirmation") === 1 ? "" : "s"}`} />
          <Summary label="Exit" value={`${count("exit") + count("invalidation")} condition${count("exit") + count("invalidation") === 1 ? "" : "s"}`} />
        </div>
        {!draft.compatibility.compatible && <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-100" data-testid="build-with-ai-review-warning">
          <div className="font-semibold">Review required</div>
          <p className="mt-1">The draft is preserved, but these items need review before it can be treated as backtest-compatible:</p>
          <ul className="mt-2 space-y-1">{draft.compatibility.unsupportedConditions.map(item => <li key={item}>• {item}</li>)}</ul>
        </div>}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button type="button" className="btn btn-secondary" onClick={() => { setResult(null); setError(""); }} data-testid="button-try-again-build-with-ai">Try Again</button>
          <button type="button" className="btn btn-primary" onClick={() => { onReview(draft); close(); }} data-testid="button-review-generated-strategy">
            <ArrowRight size={14} /> Review Strategy
          </button>
        </div>
        <p className="text-center text-[10px] text-muted-foreground">Nothing is saved, versioned, activated, backtested, or monitored until you use the normal Builder actions.</p>
      </div>}
    </Modal>}
  </>;
}

function SearchableConcept({ concepts, value, onChange }: { concepts: TradingConcept[]; value: number | null; onChange: (id: number) => void }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const selected = concepts.find(concept => concept.id === value);
  const filtered = concepts.filter(concept => conceptSearchText(concept).includes(query.toLowerCase()));
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

function StrategyForm({ strategy, markets, concepts, timeframes, onClose, onSaved, initialDraft, saveAsVersion = false }: { strategy: Strategy | null; markets: Market[]; concepts: TradingConcept[]; timeframes: Timeframe[]; onClose?: () => void; onSaved: (strategy: Strategy) => void; initialDraft?: AssistantStrategyDraft | null; saveAsVersion?: boolean }) {
  const create = useCreateStrategy();
  const createVersion = useCreateStrategyVersion();
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
     const baseData = {
      name,
      description: String(form.get("description") || "") || null,
       marketId: form.get("marketId") ? Number(form.get("marketId")) : null,
      assetClass: String(form.get("assetClass") || "") || null,
       direction: strategy ? strategy.direction : String(form.get("direction") || initialDraft?.direction || "both") as "long" | "short" | "both",
       timeframes: savedTimeframes,
       riskManagementRules: strategy ? strategy.riskManagementRules : String(form.get("riskManagementRules") || initialDraft?.riskManagementRules || "") || null,
       riskSnapshot: !strategy && initialDraft?.riskRules?.length
         ? {
           rules: initialDraft.riskRules,
           executionStatus: initialDraft.riskRules.some(rule => rule.executionStatus === "review_required") ? "review_required" : "executable",
           validation: {
             valid: initialDraft.riskRules.every(rule => rule.validation.valid),
             status: initialDraft.riskRules.some(rule => rule.executionStatus === "review_required") ? "review_required" : "valid",
             reasons: initialDraft.riskRules.flatMap(rule => rule.validation.reasons),
             warnings: initialDraft.riskRules.flatMap(rule => rule.validation.warnings),
           },
         }
         : null,
      resetRules: String(form.get("resetRules") || "") || null,
      alertRules: String(form.get("alertRules") || "") || null,
    };
     const initialConditions = !strategy && initialDraft
       ? authorizedDraftConditions(initialDraft).flatMap(condition => {
          const canonical = resolveTradingConcept(condition.conceptName);
          const concept = canonical
            ? concepts.find(item => item.canonicalId === canonical.canonicalId)
            : concepts.find(item => item.name.trim().toLowerCase() === condition.conceptName.trim().toLowerCase());
         if (!concept) return [];
         return [{
           conceptId: concept.id,
           stage: condition.stage,
           name: condition.name,
            description: `Prepared from the canonical ${concept.name} concept.`,
           timeframe: condition.timeframe || savedTimeframes[0] || "Not specified",
           direction: baseData.direction === "both" && ["long", "short", "both"].includes(condition.direction)
             ? condition.direction
             : baseData.direction,
           requirement: condition.requirement,
           triggerRules: condition.triggerRules || null,
           parameters: condition.parameters || null,
           canonicalState: {
             canonicalId: concept.canonicalId ?? canonical?.canonicalId ?? null,
             registryVersion: concept.registryVersion ?? canonical?.registryVersion ?? null,
             evaluatorVersion: canonical?.evaluatorVersion ?? null,
             executorKind: concept.executorKind ?? canonical?.executorKind ?? null,
             conceptName: concept.name,
             parameters: condition.parameters || {},
             direction: condition.direction || baseData.direction,
             timeframe: condition.timeframe || savedTimeframes[0] || "Not specified",
             relationship: condition.relationship || null,
             provenance: condition.provenance || "builder",
             executionStatus: condition.executionStatus || (canonical?.status === "executable" ? "executable" : "review_required"),
             validation: condition.validation || {
               valid: canonical?.status === "executable",
               status: canonical?.status === "executable" ? "valid" : "review_required",
               reasons: canonical?.status === "executable" ? [] : [canonical?.statusReason || "This condition requires review before execution."],
               warnings: [],
             },
           },
           invalidationRules: null,
           resetBehavior: null,
         }];
       })
       : undefined;
    setError("");
     const done = (saved: Strategy) => {
      queryClient.invalidateQueries({ queryKey: getListStrategiesQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
      onSaved(saved);
      onClose?.();
    };
    const onError = (failure: unknown) => setError(friendlyMutationError(failure, "Could not save this strategy. Please check the details and try again."));
      const afterCreate = (saved: Strategy) => {
        if (!saveAsVersion) {
          done(saved);
          return;
        }
        createVersion.mutate({
          strategyId: saved.id,
          data: {
            label: "AI draft",
            thesis: initialDraft?.description || null,
            riskSnapshot: baseData.riskSnapshot,
          },
        }, {
          onSuccess: () => done(saved),
          onError: failure => setError(friendlyMutationError(failure, "The strategy was created, but its AI draft version could not be saved. You can retry from Version History.")),
        });
      };
      if (strategy) update.mutate({ strategyId: strategy.id, data: baseData }, { onSuccess: done, onError });
      else create.mutate({ data: { ...baseData, conditions: initialConditions } }, { onSuccess: afterCreate, onError });
  };
   const busy = create.isPending || update.isPending || createVersion.isPending;
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

function ConditionModal({ strategyId, strategyDirection, concepts, timeframes, condition, defaultStage, onClose, onSaved }: { strategyId: number; strategyDirection: Strategy["direction"]; concepts: TradingConcept[]; timeframes: Timeframe[]; condition: StrategyCondition | null; defaultStage: "entry" | "confirmation" | "exit"; onClose: () => void; onSaved: () => void }) {
  const create = useCreateStrategyCondition();
  const update = useUpdateStrategyCondition();
  const queryClient = useQueryClient();
  const [conceptId, setConceptId] = useState<number | null>(condition?.conceptId || null);
  const [rulePreset, setRulePreset] = useState(rulePresetFor(condition?.triggerRules || null));
  const [executionParameters, setExecutionParameters] = useState<Record<string, unknown> | null>(() =>
    normalizeExecutableParameters(condition?.conceptName, condition?.parameters) as Record<string, unknown> | null,
  );
  const [conditionName, setConditionName] = useState(condition?.name || "");
  const nameTouched = useRef(Boolean(condition?.name));
  const [error, setError] = useState("");
  const selectedConcept = concepts.find(concept => concept.id === conceptId);
  const executableKind = executableConceptKind(selectedConcept?.name);
  useEffect(() => {
    if (executableKind) {
      setExecutionParameters(normalizeExecutableParameters(
        selectedConcept?.name,
        condition && condition.conceptName === selectedConcept?.name ? condition.parameters : null,
      ) as Record<string, unknown> | null);
    } else {
      setExecutionParameters(null);
    }
  }, [selectedConcept?.id, executableKind]);
  useEffect(() => {
    if (!nameTouched.current) setConditionName(conditionNameFor(selectedConcept, rulePreset));
  }, [selectedConcept?.id, rulePreset]);
  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const customRule = String(form.get("customRule") || "").trim();
    const selectedPreset = RULE_PRESETS.find(preset => preset.value === rulePreset);
    const triggerRules = executableKind
       ? executionParameters ? executableConceptTriggerRules(executionParameters as any) : ""
      : rulePreset === "custom" ? customRule : selectedPreset?.rule || "";
    const parameters = executableKind
      ? normalizeExecutableParameters(selectedConcept?.name, executionParameters)
      : null;
    const data = {
      conceptId: conceptId as number,
      stage: String(form.get("stage") || "entry") as "entry" | "confirmation" | "invalidation" | "exit",
      name: String(form.get("name") || "").trim(),
      description: String(form.get("description") || "") || null,
      timeframe: String(form.get("timeframe") || "").trim(),
      direction: String(form.get("direction") || "both") as "long" | "short" | "both",
      requirement: String(form.get("requirement") || "required") as "required" | "optional",
      triggerRules: triggerRules || null,
      parameters,
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
     if (!triggerRules || (executableKind && !parameters)) {
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
      <Field label="What are you looking for?">
        <SearchableConcept concepts={concepts} value={conceptId} onChange={setConceptId} />
      </Field>
      {!conceptId && <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">Choose a trading concept to continue.</div>}
      {conceptId && <>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Condition name" hint="A name is suggested from your concept and rule. You can edit it."><input className="input" name="name" value={conditionName} onChange={event => { nameTouched.current = true; setConditionName(event.target.value); }} placeholder="e.g. Bullish Liquidity Sweep" data-testid="input-builder-condition-name" /></Field>
          {defaultStage === "entry" ? <Field label="When should it matter?">
            <select className="select" name="stage" defaultValue={condition?.stage || defaultStage} data-testid="select-builder-condition-stage">
              {STAGES.filter(stage => stage.value !== "invalidation" || condition?.stage === "invalidation").map(stage => <option key={stage.value} value={stage.value}>{stage.value === "invalidation" ? "Exit" : stage.label}</option>)}
            </select>
          </Field> : <div className="rounded-md border border-border bg-secondary/30 p-3 self-end"><div className="label">When should it matter?</div><div className="text-sm font-semibold mt-2">{defaultStage === "confirmation" ? "Confirmation" : "Exit"}</div><input type="hidden" name="stage" value={condition?.stage || defaultStage} /></div>}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {strategyDirection === "both" ? <Field label="Which direction?">
            <select className="select" name="direction" defaultValue={condition?.direction || "both"} data-testid="select-builder-condition-direction">
              {DIRECTIONS.map(direction => <option key={direction.value} value={direction.value}>{direction.label}</option>)}
            </select>
          </Field> : <div className="rounded-md border border-border bg-secondary/30 p-3"><div className="label">Which direction?</div><div className="text-sm font-semibold mt-2">{strategyDirection === "long" ? "Long" : "Short"}</div><input type="hidden" name="direction" value={strategyDirection} /></div>}
          <Field label="Which timeframe?">
            {activeTimeframes.length ? <select className="select" name="timeframe" defaultValue={condition?.timeframe && timeframeKnown ? activeTimeframes.find(timeframe => timeframe.code.toLowerCase() === condition.timeframe?.toLowerCase() || timeframe.label.toLowerCase() === condition.timeframe?.toLowerCase())?.code : ""} data-testid="select-builder-condition-timeframe">
              <option value="">Choose timeframe</option>
              {condition?.timeframe && !timeframeKnown && <option value={condition.timeframe}>{condition.timeframe} · saved value</option>}
              {activeTimeframes.map(timeframe => <option key={timeframe.id} value={timeframe.code}>{timeframe.label} · {timeframe.code}</option>)}
            </select> : <input className="input" name="timeframe" defaultValue={condition?.timeframe || ""} placeholder="e.g. 4H" data-testid="input-builder-condition-timeframe" />}
          </Field>
        </div>
        <section className="rounded-lg border border-primary/30 bg-primary/5 p-4 md:p-5" data-testid="builder-when-condition">
          <div className="eyebrow text-primary">What should be true?</div>
          <p className="text-xs text-muted-foreground mt-2 leading-relaxed">Choose the clearest rule for this condition.</p>
           {executableKind === "liquidity_sweep" && <div className="space-y-4 rounded-md border border-primary/30 bg-background/60 p-4" data-testid="builder-liquidity-sweep-parameters">
             <div className="text-xs text-muted-foreground">This detector uses OHLC candles only. A sweep takes the selected prior level and must close back inside it.</div>
             <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
               <Field label="Liquidity level"><select className="select" value={String(executionParameters?.level || DEFAULT_LIQUIDITY_SWEEP_PARAMETERS.level)} onChange={event => setExecutionParameters(current => ({ ...current, kind: "liquidity_sweep", level: event.target.value }))}><option value="previous_candle">Previous candle high / low</option><option value="lookback_extreme">Extreme of the prior lookback</option></select></Field>
               <Field label="Sweep side"><select className="select" value={String(executionParameters?.sweepSide || "auto")} onChange={event => setExecutionParameters(current => ({ ...current, kind: "liquidity_sweep", sweepSide: event.target.value }))}><option value="auto">Auto by direction</option><option value="sell_side">Sell-side (long reversal)</option><option value="buy_side">Buy-side (short reversal)</option></select></Field>
             </div>
             <Field label="Lookback candles" hint="Used when the liquidity level is a lookback extreme."><input className="input" type="number" min="1" max="50" value={String(executionParameters?.lookback ?? DEFAULT_LIQUIDITY_SWEEP_PARAMETERS.lookback)} onChange={event => setExecutionParameters(current => ({ ...current, kind: "liquidity_sweep", lookback: Number(event.target.value) }))} /></Field>
           </div>}
           {executableKind === "fair_value_gap" && <div className="space-y-4 rounded-md border border-primary/30 bg-background/60 p-4" data-testid="builder-fvg-parameters">
             <div className="text-xs text-muted-foreground">A bullish gap is current low above the high two candles earlier. A bearish gap is the inverse.</div>
             <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
               <Field label="Gap direction"><select className="select" value={String(executionParameters?.polarity || DEFAULT_FAIR_VALUE_GAP_PARAMETERS.polarity)} onChange={event => setExecutionParameters(current => ({ ...current, kind: "fair_value_gap", polarity: event.target.value }))}><option value="auto">Auto by direction</option><option value="bullish">Bullish FVG</option><option value="bearish">Bearish FVG</option></select></Field>
               <Field label="Interaction"><select className="select" value={String(executionParameters?.interaction || DEFAULT_FAIR_VALUE_GAP_PARAMETERS.interaction)} onChange={event => setExecutionParameters(current => ({ ...current, kind: "fair_value_gap", interaction: event.target.value }))}><option value="formation">Formation / confirmation</option><option value="retest">Retest of a prior FVG</option></select></Field>
             </div>
             <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
               <Field label="Retest lookback" hint="Maximum candles back to search for a formed gap."><input className="input" type="number" min="1" max="100" value={String(executionParameters?.lookback ?? DEFAULT_FAIR_VALUE_GAP_PARAMETERS.lookback)} onChange={event => setExecutionParameters(current => ({ ...current, kind: "fair_value_gap", lookback: Number(event.target.value) }))} /></Field>
               <Field label="Minimum gap" hint="Price units; zero accepts any positive or zero-width boundary gap."><input className="input" type="number" min="0" step="any" value={String(executionParameters?.minimumGap ?? DEFAULT_FAIR_VALUE_GAP_PARAMETERS.minimumGap)} onChange={event => setExecutionParameters(current => ({ ...current, kind: "fair_value_gap", minimumGap: Number(event.target.value) }))} /></Field>
             </div>
           </div>}
            {executableKind === "market_structure" && <div className="space-y-4 rounded-md border border-primary/30 bg-background/60 p-4" data-testid="builder-market-structure-parameters">
              <div className="text-xs text-muted-foreground">Structure is causal: each candle is compared only with the completed prior rolling range, so no future candle is used.</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Structure event"><select className="select" value={String(executionParameters?.signal || DEFAULT_MARKET_STRUCTURE_PARAMETERS.signal)} onChange={event => setExecutionParameters(current => ({ ...current, kind: "market_structure", signal: event.target.value }))}>
                  <option value="bos">Break of Structure</option><option value="choch">Change of Character</option><option value="mss">Market Structure Shift</option><option value="higher_high">Higher High</option><option value="higher_low">Higher Low</option><option value="lower_high">Lower High</option><option value="lower_low">Lower Low</option><option value="swing_high">Swing High</option><option value="swing_low">Swing Low</option>
                </select></Field>
                <Field label="Structure direction"><select className="select" value={String(executionParameters?.polarity || "auto")} onChange={event => setExecutionParameters(current => ({ ...current, kind: "market_structure", polarity: event.target.value }))}><option value="auto">Auto</option><option value="bullish">Bullish</option><option value="bearish">Bearish</option></select></Field>
              </div>
              <Field label="Lookback candles" hint="Prior completed candles used to establish the rolling structure level."><input className="input" type="number" min="2" max="100" value={String(executionParameters?.lookback ?? DEFAULT_MARKET_STRUCTURE_PARAMETERS.lookback)} onChange={event => setExecutionParameters(current => ({ ...current, kind: "market_structure", lookback: Number(event.target.value) }))} /></Field>
            </div>}
            {executableKind === "liquidity_level" && <div className="space-y-4 rounded-md border border-primary/30 bg-background/60 p-4" data-testid="builder-liquidity-level-parameters">
              <div className="text-xs text-muted-foreground">Levels are derived from completed historical candles. Day and week levels use UTC calendar periods.</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Liquidity level"><select className="select" value={String(executionParameters?.level || DEFAULT_LIQUIDITY_LEVEL_PARAMETERS.level)} onChange={event => setExecutionParameters(current => ({ ...current, kind: "liquidity_level", level: event.target.value }))}><option value="buy_side">Buy-side liquidity</option><option value="sell_side">Sell-side liquidity</option><option value="equal_highs">Equal highs</option><option value="equal_lows">Equal lows</option><option value="previous_day_high">Previous day high</option><option value="previous_day_low">Previous day low</option><option value="previous_week_high">Previous week high</option><option value="previous_week_low">Previous week low</option></select></Field>
                <Field label="Lookback candles"><input className="input" type="number" min="2" max="100" value={String(executionParameters?.lookback ?? DEFAULT_LIQUIDITY_LEVEL_PARAMETERS.lookback)} onChange={event => setExecutionParameters(current => ({ ...current, kind: "liquidity_level", lookback: Number(event.target.value) }))} /></Field>
              </div>
              <Field label="Equal-level tolerance" hint="Price units allowed between equal highs or lows."><input className="input" type="number" min="0" step="any" value={String(executionParameters?.tolerance ?? DEFAULT_LIQUIDITY_LEVEL_PARAMETERS.tolerance)} onChange={event => setExecutionParameters(current => ({ ...current, kind: "liquidity_level", tolerance: Number(event.target.value) }))} /></Field>
            </div>}
            {executableKind === "indicator" && <div className="space-y-4 rounded-md border border-primary/30 bg-background/60 p-4" data-testid="builder-indicator-parameters">
              <div className="text-xs text-muted-foreground">Indicator values use completed historical candles only. Price comparisons use close versus the calculated value.</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Indicator"><select className="select" value={String(executionParameters?.indicator || DEFAULT_INDICATOR_PARAMETERS.indicator)} onChange={event => setExecutionParameters(current => ({ ...current, kind: "indicator", indicator: event.target.value }))}><option value="ema">EMA</option><option value="sma">SMA</option><option value="rsi">RSI</option><option value="macd">MACD</option><option value="vwap">VWAP</option><option value="atr">ATR</option></select></Field>
                <Field label="Comparison"><select className="select" value={String(executionParameters?.comparison || DEFAULT_INDICATOR_PARAMETERS.comparison)} onChange={event => setExecutionParameters(current => ({ ...current, kind: "indicator", comparison: event.target.value }))}><option value="above">Above</option><option value="below">Below</option><option value="cross_above">Crosses above</option><option value="cross_below">Crosses below</option></select></Field>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Field label="Period"><input className="input" type="number" min="1" max="500" value={String(executionParameters?.period ?? DEFAULT_INDICATOR_PARAMETERS.period)} onChange={event => setExecutionParameters(current => ({ ...current, kind: "indicator", period: Number(event.target.value) }))} /></Field>
                <Field label="Threshold" hint="Used by RSI, MACD, and ATR."><input className="input" type="number" step="any" value={String(executionParameters?.threshold ?? DEFAULT_INDICATOR_PARAMETERS.threshold)} onChange={event => setExecutionParameters(current => ({ ...current, kind: "indicator", threshold: Number(event.target.value) }))} /></Field>
                <Field label="MACD fast / slow / signal"><input className="input" value={`${executionParameters?.fastPeriod ?? 12}/${executionParameters?.slowPeriod ?? 26}/${executionParameters?.signalPeriod ?? 9}`} onChange={event => { const [fast, slow, signal] = event.target.value.split("/").map(Number); setExecutionParameters(current => ({ ...current, kind: "indicator", fastPeriod: fast, slowPeriod: slow, signalPeriod: signal })); }} placeholder="12/26/9" /></Field>
              </div>
            </div>}
            {executableKind === "price_action" && <div className="space-y-4 rounded-md border border-primary/30 bg-background/60 p-4" data-testid="builder-price-action-parameters">
              <div className="text-xs text-muted-foreground">Patterns use explicit OHLC relationships. Breakouts and support/resistance use a prior rolling range.</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Pattern"><select className="select" value={String(executionParameters?.pattern || DEFAULT_PRICE_ACTION_PARAMETERS.pattern)} onChange={event => setExecutionParameters(current => ({ ...current, kind: "price_action", pattern: event.target.value }))}><option value="breakout">Breakout</option><option value="breakout_retest">Breakout retest</option><option value="bullish_engulfing">Bullish engulfing</option><option value="bearish_engulfing">Bearish engulfing</option><option value="pin_bar">Pin bar</option><option value="inside_bar">Inside bar</option><option value="support">Support</option><option value="resistance">Resistance</option></select></Field>
                <Field label="Pattern direction"><select className="select" value={String(executionParameters?.polarity || "auto")} onChange={event => setExecutionParameters(current => ({ ...current, kind: "price_action", polarity: event.target.value }))}><option value="auto">Auto</option><option value="bullish">Bullish</option><option value="bearish">Bearish</option></select></Field>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4"><Field label="Lookback candles"><input className="input" type="number" min="2" max="100" value={String(executionParameters?.lookback ?? DEFAULT_PRICE_ACTION_PARAMETERS.lookback)} onChange={event => setExecutionParameters(current => ({ ...current, kind: "price_action", lookback: Number(event.target.value) }))} /></Field><Field label="Pin-bar wick ratio"><input className="input" type="number" min="1" max="20" step="any" value={String(executionParameters?.wickRatio ?? DEFAULT_PRICE_ACTION_PARAMETERS.wickRatio)} onChange={event => setExecutionParameters(current => ({ ...current, kind: "price_action", wickRatio: Number(event.target.value) }))} /></Field></div>
            </div>}
            {executableKind === "range_location" && <div className="space-y-4 rounded-md border border-primary/30 bg-background/60 p-4" data-testid="builder-range-location-parameters">
              <div className="text-xs text-muted-foreground">The range is the prior completed rolling high-low range; no range is invented when insufficient data exists.</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4"><Field label="Location"><select className="select" value={String(executionParameters?.location || DEFAULT_RANGE_LOCATION_PARAMETERS.location)} onChange={event => setExecutionParameters(current => ({ ...current, kind: "range_location", location: event.target.value }))}><option value="premium">Premium</option><option value="discount">Discount</option><option value="equilibrium">Equilibrium</option></select></Field><Field label="Lookback candles"><input className="input" type="number" min="2" max="100" value={String(executionParameters?.lookback ?? DEFAULT_RANGE_LOCATION_PARAMETERS.lookback)} onChange={event => setExecutionParameters(current => ({ ...current, kind: "range_location", lookback: Number(event.target.value) }))} /></Field></div>
            </div>}
            {executableKind === "displacement" && <div className="space-y-4 rounded-md border border-primary/30 bg-background/60 p-4" data-testid="builder-displacement-parameters">
              <div className="text-xs text-muted-foreground">A displacement candle has a body at least the configured multiple of prior ATR and closes near its directional extreme. It uses closed OHLC candles only.</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Displacement direction"><select className="select" value={String(executionParameters?.polarity || DEFAULT_DISPLACEMENT_PARAMETERS.polarity)} onChange={event => setExecutionParameters(current => ({ ...current, kind: "displacement", polarity: event.target.value }))}><option value="auto">Auto by strategy direction</option><option value="bullish">Bullish</option><option value="bearish">Bearish</option></select></Field>
                <Field label="ATR period"><input className="input" type="number" min="1" max="500" value={String(executionParameters?.atrPeriod ?? DEFAULT_DISPLACEMENT_PARAMETERS.atrPeriod)} onChange={event => setExecutionParameters(current => ({ ...current, kind: "displacement", atrPeriod: Number(event.target.value) }))} /></Field>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Minimum body / ATR" hint="The candle body must be at least this multiple of prior ATR."><input className="input" type="number" min="0" max="20" step="any" value={String(executionParameters?.minimumBodyAtr ?? DEFAULT_DISPLACEMENT_PARAMETERS.minimumBodyAtr)} onChange={event => setExecutionParameters(current => ({ ...current, kind: "displacement", minimumBodyAtr: Number(event.target.value) }))} /></Field>
                <Field label="Minimum close location" hint="0.75 means the close is in the outer 25% of the candle range."><input className="input" type="number" min="0.5" max="1" step="0.01" value={String(executionParameters?.minimumCloseLocation ?? DEFAULT_DISPLACEMENT_PARAMETERS.minimumCloseLocation)} onChange={event => setExecutionParameters(current => ({ ...current, kind: "displacement", minimumCloseLocation: Number(event.target.value) }))} /></Field>
              </div>
            </div>}
            {executableKind === "rejection" && <div className="space-y-4 rounded-md border border-primary/30 bg-background/60 p-4" data-testid="builder-rejection-parameters">
              <div className="text-xs text-muted-foreground">Rejection uses only the closed candle range: the directional wick must meet the configured fraction and the close must be in the directional portion of the range.</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Rejection direction"><select className="select" value={String(executionParameters?.polarity || DEFAULT_REJECTION_PARAMETERS.polarity)} onChange={event => setExecutionParameters(current => ({ ...current, kind: "rejection", polarity: event.target.value }))}><option value="auto">Auto by strategy direction</option><option value="bullish">Bullish</option><option value="bearish">Bearish</option></select></Field>
                <Field label="Minimum wick fraction" hint="0.50 means at least half of the candle range."><input className="input" type="number" min="0" max="1" step="0.01" value={String(executionParameters?.minimumWickFraction ?? DEFAULT_REJECTION_PARAMETERS.minimumWickFraction)} onChange={event => setExecutionParameters(current => ({ ...current, kind: "rejection", minimumWickFraction: Number(event.target.value) }))} /></Field>
              </div>
              <Field label="Minimum close location" hint="0.75 means the close is in the outer 25% toward the rejection direction."><input className="input" type="number" min="0.5" max="1" step="0.01" value={String(executionParameters?.minimumCloseLocation ?? DEFAULT_REJECTION_PARAMETERS.minimumCloseLocation)} onChange={event => setExecutionParameters(current => ({ ...current, kind: "rejection", minimumCloseLocation: Number(event.target.value) }))} /></Field>
            </div>}
            {executableKind === "failed_breakout" && <div className="space-y-4 rounded-md border border-primary/30 bg-background/60 p-4" data-testid="builder-failed-breakout-parameters">
              <div className="text-xs text-muted-foreground">A confirmed rolling support or resistance level is broken by a closed candle, then reclaimed within the configured number of later closed candles.</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Failure direction"><select className="select" value={String(executionParameters?.polarity || DEFAULT_FAILED_BREAKOUT_PARAMETERS.polarity)} onChange={event => setExecutionParameters(current => ({ ...current, kind: "failed_breakout", polarity: event.target.value }))}><option value="auto">Auto by strategy direction</option><option value="bullish">Bullish resistance failure</option><option value="bearish">Bearish support failure</option></select></Field>
                <Field label="Level type"><select className="select" value={String(executionParameters?.levelType || DEFAULT_FAILED_BREAKOUT_PARAMETERS.levelType)} onChange={event => setExecutionParameters(current => ({ ...current, kind: "failed_breakout", levelType: event.target.value }))}><option value="auto">Auto from direction</option><option value="resistance">Resistance</option><option value="support">Support</option></select></Field>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Level lookback"><input className="input" type="number" min="2" max="100" value={String(executionParameters?.lookback ?? DEFAULT_FAILED_BREAKOUT_PARAMETERS.lookback)} onChange={event => setExecutionParameters(current => ({ ...current, kind: "failed_breakout", lookback: Number(event.target.value) }))} /></Field>
                <Field label="Maximum bars to failure"><input className="input" type="number" min="1" max="20" value={String(executionParameters?.maxBarsToFailure ?? DEFAULT_FAILED_BREAKOUT_PARAMETERS.maxBarsToFailure)} onChange={event => setExecutionParameters(current => ({ ...current, kind: "failed_breakout", maxBarsToFailure: Number(event.target.value) }))} /></Field>
              </div>
            </div>}
            {executableKind === "session" && <div className="space-y-4 rounded-md border border-primary/30 bg-background/60 p-4" data-testid="builder-session-parameters">
              <div className="text-xs text-muted-foreground">Session membership is calculated from the candle timestamp in the configured IANA timezone, including daylight-saving changes. End time is exclusive.</div>
              <Field label="Session"><select className="select" value={String(executionParameters?.session || DEFAULT_SESSION_PARAMETERS.session)} onChange={event => { const session = event.target.value as keyof typeof CANONICAL_SESSION_DEFINITIONS; setExecutionParameters(current => ({ ...current, kind: "session", session, ...CANONICAL_SESSION_DEFINITIONS[session] })); }}><option value="london">London Session</option><option value="new_york">New York Session</option><option value="asian">Asian Session</option><option value="kill_zone">Kill Zone</option></select></Field>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Start time"><input className="input" type="time" value={String(executionParameters?.startTime || DEFAULT_SESSION_PARAMETERS.startTime)} onChange={event => setExecutionParameters(current => ({ ...current, kind: "session", startTime: event.target.value }))} /></Field>
                <Field label="End time"><input className="input" type="time" value={String(executionParameters?.endTime || DEFAULT_SESSION_PARAMETERS.endTime)} onChange={event => setExecutionParameters(current => ({ ...current, kind: "session", endTime: event.target.value }))} /></Field>
              </div>
              <Field label="IANA timezone" hint="Examples: Europe/London, America/New_York, Asia/Tokyo."><input className="input" value={String(executionParameters?.timezone || DEFAULT_SESSION_PARAMETERS.timezone)} onChange={event => setExecutionParameters(current => ({ ...current, kind: "session", timezone: event.target.value }))} /></Field>
            </div>}
           {!executableKind && <><div className="mt-4">
             <select className="select bg-background" value={rulePreset} onChange={event => setRulePreset(event.target.value)} data-testid="select-builder-condition-rule">
               <option value="">Choose a rule</option>
               {RULE_PRESETS.map(preset => <option key={preset.value} value={preset.value}>{preset.label}</option>)}
               <option value="custom">Custom rule</option>
             </select>
           </div>
           {rulePreset && rulePreset !== "custom" && <div className={`mt-3 rounded-md p-3 text-xs ${RULE_PRESETS.find(preset => preset.value === rulePreset)?.supported ? "bg-background/70 text-muted-foreground" : "border border-amber-500/40 bg-amber-500/10 text-amber-200"}`}><ShieldCheck size={14} className={`inline mr-2 ${RULE_PRESETS.find(preset => preset.value === rulePreset)?.supported ? "text-primary" : "text-amber-300"}`} />{RULE_PRESETS.find(preset => preset.value === rulePreset)?.description}{!RULE_PRESETS.find(preset => preset.value === rulePreset)?.supported && <strong className="block mt-1 ml-6">Not currently supported by Backtesting.</strong>}</div>}
           {rulePreset === "custom" && <Field label="Describe the rule" hint="Unsupported concepts remain visible for review and are never treated as executable."><textarea className="textarea mt-2" name="customRule" defaultValue={condition?.triggerRules || ""} placeholder="Describe what should be true" data-testid="input-builder-condition-custom-rule" /></Field>}</>}
        </section>
        <input type="hidden" name="requirement" value={condition?.requirement || "required"} />
        <details className="rounded-md border border-border p-4 group">
          <summary className="cursor-pointer text-sm font-semibold list-none flex items-center justify-between">More notes <ChevronDown size={15} className="text-muted-foreground transition-transform group-open:rotate-180" /></summary>
          <div className="space-y-4 mt-4 pt-4 border-t border-border">
            <Field label="Description"><textarea className="textarea" name="description" defaultValue={condition?.description || ""} placeholder="What does this condition mean in your process?" data-testid="input-builder-condition-description" /></Field>
            <Field label="Exit notes"><textarea className="textarea" name="invalidationRules" defaultValue={condition?.invalidationRules || ""} placeholder="What would make this condition no longer valid?" data-testid="input-builder-condition-invalidation-rules" /></Field>
            <Field label="Reset notes"><textarea className="textarea" name="resetBehavior" defaultValue={condition?.resetBehavior || ""} placeholder="How should this condition reset before the process begins again?" data-testid="input-builder-condition-reset-behaviour" /></Field>
          </div>
        </details>
      </>}
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
     const supported = isBacktestCompatibleCondition(condition);
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
   const unsupportedConditions = conditions.filter(condition => !isBacktestCompatibleCondition(condition)).map(condition => condition.name || "Unnamed condition");
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
  const [category, setCategory] = useState("All");
  const categories = ["All", ...Array.from(new Set(concepts.map(concept => concept.category || "CUSTOM"))).sort()];
  const filtered = concepts.filter(concept => (category === "All" || (concept.category || "CUSTOM") === category) && conceptSearchText(concept).includes(search.toLowerCase()));
  return <Panel title="Trading Concept Library" eyebrow="Use your own vocabulary">
    <p className="text-xs text-muted-foreground mt-2 leading-relaxed">Conditions reference concepts centrally. Definitions stay independent from this strategy and can be customised in the library.</p>
    <div className="relative mt-5">
      <Search size={15} className="absolute left-3 top-3 text-muted-foreground" />
      <input className="input pl-9 pr-9" value={search} onChange={event => { setSearch(event.target.value); setOpen(true); }} onFocus={() => setOpen(true)} placeholder="Search concepts to review" data-testid="input-builder-library-search" />
      <ChevronDown size={15} className="absolute right-3 top-3 text-muted-foreground" />
      {open && <div className="absolute z-30 left-0 right-0 top-full mt-2 panel p-2 max-h-56 overflow-y-auto shadow-xl">{filtered.length ? filtered.map(concept => <div key={concept.id} className="px-3 py-2 rounded-md hover:bg-secondary"><div className="flex items-center gap-2"><div className="text-sm font-semibold">{concept.name}</div><span className={`tag text-[9px] ${conceptHasExecutableParameters(concept) ? "tag-active" : "border-amber-500/40 text-amber-200"}`}>{conceptHasExecutableParameters(concept) ? "Supported" : "Review required"}</span></div><div className="text-[10px] text-muted-foreground mt-1">{concept.category || "CUSTOM"} · {concept.isBuiltIn ? "Library concept" : "Custom concept"}</div></div>) : <div className="p-4 text-sm text-muted-foreground">No concepts match that search.</div>}</div>}
    </div>
    <div className="flex flex-wrap gap-1.5 mt-4" data-testid="builder-concept-category-filters">
      {categories.map(option => <button key={option} type="button" className={`tag ${category === option ? "tag-active" : ""}`} onClick={() => setCategory(option)}>{option}</button>)}
    </div>
    <div className="flex items-center justify-between gap-3 mt-5 pt-4 border-t border-border">
      <span className="text-[11px] text-muted-foreground">{concepts.length} concepts available</span>
      <Link href="/strategy-builder" className="text-xs text-primary hover:underline">Manage definitions <ChevronRight size={13} className="inline" /></Link>
    </div>
  </Panel>;
}

function isAuthorizedDraftCondition(draft: AssistantStrategyDraft, condition: AssistantStrategyDraft["conditions"][number]) {
  const authorization = condition.authorization;
  if (!authorization || authorization.source !== "user_request" || !authorization.matchedText) return false;
  return draft.authorization.originalRequest.length > 0
    && draft.authorization.requestedConcepts.some(requested =>
      requested.requestedConcept === authorization.requestedConcept
      && requested.matchedText === authorization.matchedText,
    );
}

function authorizedDraftConditions(draft: AssistantStrategyDraft) {
  return draft.conditions.filter(condition => isAuthorizedDraftCondition(draft, condition));
}

function AssistantDraftReview({ draft, action }: { draft: AssistantStrategyDraft; action: "review" | "save-version" }) {
  const conditions = authorizedDraftConditions(draft);
  const entryConditions = conditions.filter(condition => condition.stage === "entry" || condition.stage === "confirmation");
  const exitConditions = conditions.filter(condition => condition.stage === "exit" || condition.stage === "invalidation");
  const unsupported = draft.compatibility.unsupportedConditions;
  const riskReview = draft.riskRules?.filter(rule => rule.executionStatus === "review_required") || [];
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
    {draft.riskRules && draft.riskRules.length > 0 && <div className="mt-4 rounded-md border border-border p-3" data-testid="assistant-draft-risk-rules">
      <div className="eyebrow">Canonical risk rules</div>
      <div className="flex flex-wrap gap-2 mt-3">
        {draft.riskRules.map((rule, index) => <span key={`${rule.type}-${rule.value}-${index}`} className={`tag ${rule.executionStatus === "executable" ? "tag-active" : "border-amber-500/40 text-amber-200"}`}>
          {rule.type.replaceAll("_", " ")}{rule.value == null ? "" : ` · ${rule.value}${rule.unit === "percent" ? "%" : rule.unit === "r" ? "R" : ""}`}
        </span>)}
      </div>
      {riskReview.length > 0 && <p className="text-[11px] text-amber-200 mt-2 leading-relaxed">{riskReview.flatMap(rule => rule.validation.reasons).join(" ")}</p>}
    </div>}
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
  const reviewRequired = condition.executionStatus === "review_required"
    || condition.validation?.valid === false
    || condition.supported === false;
  const typedParameters = condition.parameters && typeof condition.parameters === "object"
    ? JSON.stringify(condition.parameters)
    : null;
  return <div className="rounded-md bg-secondary/50 p-3">
    <div className="flex flex-wrap items-center gap-2">
      <span className="tag tag-active">{condition.stage}</span>
      <span className="tag tag-draft">{condition.requirement}</span>
      <span className={`tag ${reviewRequired ? "border-amber-500/40 text-amber-200" : "tag-active"}`}>
        {reviewRequired ? "Review required" : "Executable"}
      </span>
    </div>
    <div className="text-xs font-semibold mt-2">{condition.name}</div>
    <div className="text-[11px] text-primary mt-1">{condition.conceptName} · {condition.direction} · {condition.canonicalRuleType || "legacy rule"} · {condition.timeframe}</div>
    {typedParameters && <div className="text-[10px] text-muted-foreground mt-2 break-all">Parameters: {typedParameters}</div>}
    {condition.relationship && <div className="text-[10px] text-primary mt-1">Relationship: {condition.relationship.type.replaceAll("_", " ")}{condition.relationship.targetRuleIndex == null ? "" : ` → rule ${condition.relationship.targetRuleIndex + 1}`} · {condition.relationship.supported ? "executable" : "review required"}</div>}
    {condition.provenance?.detectedText && <div className="text-[10px] text-muted-foreground mt-1">Detected: “{condition.provenance.detectedText}” · source: {condition.provenance.source}</div>}
    <div className="text-[11px] text-muted-foreground mt-2 leading-relaxed">{condition.triggerRules}</div>
    {condition.validation?.reasons?.length ? <div className="text-[10px] text-amber-200 mt-2 leading-relaxed">{condition.validation.reasons.join(" ")}</div> : null}
  </div>;
}

export function StrategyBuilder() {
  const [routeLocation, setLocation] = useLocation();
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
  const activeStrategy = useMemo(() => {
    if (assistantDraft) return null;
    const rows = strategies.data || [];
    return rows.find(strategy => strategy.id === selectedStrategyId) || rows[0] || null;
  }, [assistantDraft, selectedStrategyId, strategies.data]);
  const strategyId = activeStrategy?.id || 0;
  const strategyConditions = useListStrategyConditions(strategyId, { query: { enabled: !!strategyId, queryKey: getListStrategyConditionsQueryKey(strategyId) } });
  const savedStrategy = (strategy: Strategy) => {
    setSelectedStrategyId(strategy.id);
    if (!assistantDraft) return;
    const unmatched = authorizedDraftConditions(assistantDraft).filter(condition =>
      !concepts.data?.some(item => {
        const canonical = resolveTradingConcept(condition.conceptName);
        return canonical ? item.canonicalId === canonical.canonicalId : item.name.trim().toLowerCase() === condition.conceptName.trim().toLowerCase();
      }),
    );
    queryClient.invalidateQueries({ queryKey: getListStrategyConditionsQueryKey(strategy.id) });
    setUnmatchedDraftConditions(unmatched);
    setDraftImportMessage(unmatched.length ? `Strategy created. These draft conditions need review before they can be added: ${unmatched.map(condition => condition.name).join(", ")}.` : "Strategy created with the assistant’s conditions. Review it, then save a new immutable version.");
    setAssistantDraft(null);
    clearPendingAssistantDraft();
  };
  const refreshConditions = () => queryClient.invalidateQueries({ queryKey: getListStrategyConditionsQueryKey(strategyId) });
  const action = <div className="flex flex-col-reverse gap-2 sm:flex-row">
    <BuildWithAI onReview={draft => {
      setPendingAssistantDraft(draft);
      setAssistantDraft(draft);
      setDraftImportMessage("");
      setUnmatchedDraftConditions([]);
      setLocation("/strategy-builder?assistantDraft=1&assistantAction=review");
    }} />
    <button className="btn btn-primary" onClick={() => setStrategyModal("new")} data-testid="button-new-builder-strategy"><Plus size={15} /> New strategy</button>
  </div>;

  if (strategies.isLoading) return <BuilderPage><div className="panel p-10 text-center text-sm text-muted-foreground">Loading your strategies…</div></BuilderPage>;
  if (strategies.isError || markets.isError || concepts.isError || timeframes.isError) return <BuilderPage><div className="panel p-10 text-center"><div className="font-semibold">Couldn’t load the builder records</div><p className="text-sm text-muted-foreground mt-2">Your workspace is intact. Try refreshing the page.</p></div></BuilderPage>;
  return <BuilderPage action={action}>
     {!activeStrategy ? <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-5">
       <Panel title="Create the strategy foundation" eyebrow="Start without assumptions">
         {assistantDraft && <AssistantDraftReview draft={assistantDraft} action={assistantDraftAction} />}
        <p className="text-sm text-muted-foreground mt-3 max-w-2xl leading-relaxed">Give your strategy a name and describe the market context in your own words. Everything else can stay open until you are ready to define it.</p>
           <div className="mt-6"><StrategyForm markets={markets.data || []} concepts={concepts.data || []} timeframes={timeframes.data || []} strategy={null} initialDraft={assistantDraft} saveAsVersion={assistantDraftAction === "save-version"} onSaved={savedStrategy} /></div>
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
     {strategyModal && <Modal title={strategyModal === "edit" ? "Edit strategy details" : "New strategy"} onClose={() => setStrategyModal(false)}><StrategyForm strategy={strategyModal === "edit" ? activeStrategy : null} markets={markets.data || []} concepts={concepts.data || []} timeframes={timeframes.data || []} onClose={() => setStrategyModal(false)} onSaved={savedStrategy} /></Modal>}
      {conditionModal && activeStrategy && <ConditionModal key={conditionModal === "new" ? `new-${newConditionStage}` : conditionModal.id} strategyId={activeStrategy.id} strategyDirection={activeStrategy.direction} concepts={concepts.data || []} timeframes={timeframes.data || []} defaultStage={newConditionStage} condition={conditionModal === "new" ? null : conditionModal} onClose={() => setConditionModal(false)} onSaved={refreshConditions} />}
  </BuilderPage>;
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div className="p-3 rounded-md bg-secondary/50 min-w-0"><div className="eyebrow">{label}</div><div className="text-sm font-semibold mt-2 truncate">{value}</div></div>;
}

function RuleSummary({ label, value }: { label: string; value: string | null }) {
  return <div><div className="eyebrow">{label}</div><p className="text-xs text-muted-foreground mt-1.5 line-clamp-3">{value || "Not defined"}</p></div>;
}