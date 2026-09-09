import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "wouter";
import {
  ArrowDown, ArrowUp, Check, ChevronDown, ChevronRight, Edit3, FileText, Pencil, Plus,
  Search, SlidersHorizontal, Trash2, X, Zap,
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
        required={!value}
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
  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const timeframes = String(form.get("timeframes") || "").split(",").map(value => value.trim()).filter(Boolean);
    const data = {
      name: String(form.get("name") || "").trim(),
      description: String(form.get("description") || "") || null,
      marketId: form.get("marketId") ? Number(form.get("marketId")) : null,
      assetClass: String(form.get("assetClass") || "") || null,
      direction: String(form.get("direction") || "both") as "long" | "short" | "both",
      timeframes,
      riskManagementRules: String(form.get("riskManagementRules") || "") || null,
      resetRules: String(form.get("resetRules") || "") || null,
      alertRules: String(form.get("alertRules") || "") || null,
    };
    const done = (saved: Strategy) => {
      queryClient.invalidateQueries({ queryKey: getListStrategiesQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
      onSaved(saved);
      onClose?.();
    };
    if (strategy) update.mutate({ strategyId: strategy.id, data }, { onSuccess: done });
    else create.mutate({ data }, { onSuccess: done });
  };
  const busy = create.isPending || update.isPending;
  return <form onSubmit={save} className="space-y-6" key={strategy?.id ?? "new-strategy"}>
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
    <div className="border-t border-border pt-6">
      <div className="eyebrow">Operating rules</div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-5">
        <Field label="Risk-management rules"><textarea className="textarea" name="riskManagementRules" defaultValue={strategy?.riskManagementRules || ""} placeholder="Write the risk boundaries you choose to follow." data-testid="input-builder-risk-rules" /></Field>
        <Field label="Reset rules"><textarea className="textarea" name="resetRules" defaultValue={strategy?.resetRules || ""} placeholder="When does this process reset or begin again?" data-testid="input-builder-reset-rules" /></Field>
      </div>
      <Field label="Alert rules" hint="Record personal reminders only. No live detection is connected."><textarea className="textarea" name="alertRules" defaultValue={strategy?.alertRules || ""} placeholder="What should prompt you to review this strategy?" data-testid="input-builder-alert-rules" /></Field>
    </div>
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
  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const data = {
      conceptId: conceptId as number,
      stage: String(form.get("stage") || "entry") as "entry" | "confirmation" | "invalidation" | "exit",
      name: String(form.get("name") || "").trim(),
      description: String(form.get("description") || "") || null,
      timeframe: String(form.get("timeframe") || "").trim(),
      direction: String(form.get("direction") || "both") as "long" | "short" | "both",
      requirement: String(form.get("requirement") || "required") as "required" | "optional",
      triggerRules: String(form.get("triggerRules") || "") || null,
      invalidationRules: String(form.get("invalidationRules") || "") || null,
      resetBehavior: String(form.get("resetBehavior") || "") || null,
    };
    if (!conceptId) return;
    const done = () => {
      queryClient.invalidateQueries({ queryKey: getListStrategyConditionsQueryKey(strategyId) });
      onSaved();
      onClose();
    };
    if (condition) update.mutate({ strategyId, conditionId: condition.id, data }, { onSuccess: done });
    else create.mutate({ strategyId, data }, { onSuccess: done });
  };
  const busy = create.isPending || update.isPending;
  return <Modal title={condition ? "Edit condition" : "Add condition"} onClose={onClose}>
    <form onSubmit={save} className="space-y-5">
      <Field label="Concept from Trading Concept Library">
        <SearchableConcept concepts={concepts} value={conceptId} onChange={setConceptId} />
      </Field>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Condition name"><input className="input" name="name" required defaultValue={condition?.name || ""} placeholder="Name this checkpoint" data-testid="input-builder-condition-name" /></Field>
        <Field label="Stage">
          <select className="select" name="stage" defaultValue={condition?.stage || "entry"} data-testid="select-builder-condition-stage">
            {STAGES.map(stage => <option key={stage.value} value={stage.value}>{stage.label}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Description"><textarea className="textarea" name="description" defaultValue={condition?.description || ""} placeholder="What does this condition mean in your process?" data-testid="input-builder-condition-description" /></Field>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Field label="Timeframe"><input className="input mono" name="timeframe" required defaultValue={condition?.timeframe || ""} placeholder="e.g. 4H" data-testid="input-builder-condition-timeframe" /></Field>
        <Field label="Direction">
          <select className="select" name="direction" defaultValue={condition?.direction || "both"} data-testid="select-builder-condition-direction">
            {DIRECTIONS.map(direction => <option key={direction.value} value={direction.value}>{direction.label}</option>)}
          </select>
        </Field>
        <Field label="Requirement">
          <select className="select" name="requirement" defaultValue={condition?.requirement || "required"} data-testid="select-builder-condition-requirement">
            <option value="required">Required</option>
            <option value="optional">Optional</option>
          </select>
        </Field>
      </div>
      <Field label="Trigger rules" hint="Describe the evidence you personally need. This stays as text until detection logic is connected later."><textarea className="textarea" name="triggerRules" defaultValue={condition?.triggerRules || ""} placeholder="What must be observable before this condition is considered met?" data-testid="input-builder-condition-trigger-rules" /></Field>
      <Field label="Invalidation rules"><textarea className="textarea" name="invalidationRules" defaultValue={condition?.invalidationRules || ""} placeholder="What would make this condition no longer valid?" data-testid="input-builder-condition-invalidation-rules" /></Field>
      <Field label="Reset behaviour"><textarea className="textarea" name="resetBehavior" defaultValue={condition?.resetBehavior || ""} placeholder="How should this condition reset before the process begins again?" data-testid="input-builder-condition-reset-behaviour" /></Field>
      <div className="flex justify-end gap-3 pt-1">
        <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={busy || !conceptId} data-testid="button-save-builder-condition">{busy ? "Saving…" : "Save condition"}</button>
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
  if (!ordered.length) return <div className="panel empty-grid p-8 md:p-12 text-center">
    <div className="w-11 h-11 mx-auto rounded-xl border border-primary/30 bg-primary/10 text-primary flex items-center justify-center mb-5"><SlidersHorizontal size={20} /></div>
    <h3 className="font-semibold text-lg">Your strategy path is empty</h3>
    <p className="text-sm text-muted-foreground max-w-md mx-auto mt-2 leading-relaxed">Add a condition from your concept library. You decide what it means, when it matters, and whether it is required.</p>
    <button className="btn btn-primary mt-6" onClick={onAdd} data-testid="button-empty-add-strategy-condition"><Plus size={14} /> Add first condition</button>
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
      <div className="flex flex-col items-center py-2 text-primary/70" aria-hidden="true"><span className="w-px h-3 bg-primary/30" /><ChevronDown size={16} /></div>
    </div>)}
    <div className="panel border-primary/30 bg-primary/5 px-5 py-4 text-center">
      <div className="eyebrow text-primary">Strategy endpoint</div>
      <div className="font-semibold mt-2 flex items-center justify-center gap-2"><Zap size={15} className="text-primary" /> ENTRY</div>
      <p className="text-[11px] text-muted-foreground mt-1">A visual endpoint only. No entry signal is generated.</p>
    </div>
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
          <Panel title="Strategy definition" eyebrow="Your operating frame">
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
            <div><div className="eyebrow">Ordered condition flow</div><h2 className="font-semibold mt-2">From observation to entry</h2><p className="text-xs text-muted-foreground mt-2">Move conditions up or down to make the process explicit.</p></div>
            <button className="btn btn-primary" onClick={() => setConditionModal("new")} data-testid="button-add-strategy-condition"><Plus size={14} /> Add condition</button>
          </div>
          {strategyConditions.isLoading ? <div className="panel p-8 text-center text-sm text-muted-foreground">Loading conditions…</div> : strategyConditions.isError ? <div className="panel p-8 text-center text-sm text-muted-foreground">Couldn’t load conditions.</div> : <ConditionFlow strategyId={strategyId} conditions={strategyConditions.data || []} concepts={concepts.data || []} onAdd={() => setConditionModal("new")} onEdit={condition => setConditionModal(condition)} onChanged={refreshConditions} />}
        </div>
        <div className="space-y-5">
          <StrategyVersionManager strategy={activeStrategy} compact />
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
    {conditionModal && activeStrategy && <ConditionModal strategyId={activeStrategy.id} concepts={concepts.data || []} condition={conditionModal === "new" ? null : conditionModal} onClose={() => setConditionModal(false)} onSaved={refreshConditions} />}
  </BuilderPage>;
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div className="p-3 rounded-md bg-secondary/50 min-w-0"><div className="eyebrow">{label}</div><div className="text-sm font-semibold mt-2 truncate">{value}</div></div>;
}

function RuleSummary({ label, value }: { label: string; value: string | null }) {
  return <div><div className="eyebrow">{label}</div><p className="text-xs text-muted-foreground mt-1.5 line-clamp-3">{value || "Not defined"}</p></div>;
}