import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, BookOpen, Plus, Trash2, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetDashboardSummaryQueryKey,
  getGetJournalPerformanceQueryKey,
  getGetPerformanceSummaryQueryKey,
  getListStrategiesQueryKey,
  getListStrategyVersionsQueryKey,
  getListTradesQueryKey,
  useCreateTrade,
  useDeleteTrade,
  useListMarkets,
  useListStrategies,
  useListStrategyVersions,
  useListTrades,
  useUpdateTrade,
  type Market,
  type Strategy,
  type StrategyVersion,
  type Trade,
  type TradeInputRiskUnit,
} from "@workspace/api-client-react";
import { JournalPerformance } from "@/components/journal-performance";

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-5" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <div className="panel w-full max-w-2xl max-h-[94dvh] overflow-y-auto p-6 rise">
      <div className="flex items-center justify-between mb-6"><h2 className="font-semibold text-lg">{title}</h2><button className="btn btn-ghost" onClick={onClose} aria-label="Close"><X size={16} /></button></div>
      {children}
    </div>
  </div>;
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="block"><span className="label">{label}</span>{children}{hint && <span className="block text-[11px] text-muted-foreground mt-1.5">{hint}</span>}</label>;
}

function money(value?: number | null) {
  return value == null ? "—" : `${value < 0 ? "−" : ""}$${Math.abs(value).toFixed(2)}`;
}

function date(value?: string | null) {
  return value ? new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—";
}

function dateTimeInput(value?: string | null) {
  return value ? new Date(value).toISOString().slice(0, 16) : "";
}

function TradeRow({ trade, onEdit, onDelete }: { trade: Trade; onEdit: () => void; onDelete: () => void }) {
  return <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 hover:bg-secondary/50 transition-colors" data-testid={`row-trade-${trade.id}`}>
    <div className={`w-8 h-8 rounded-md flex items-center justify-center shrink-0 ${trade.side === "long" ? "bg-primary/10 text-primary" : "bg-accent/10 text-accent"}`}>{trade.side === "long" ? <ArrowUpRight size={15} /> : <ArrowDownRight size={15} />}</div>
    <div className="min-w-0 flex-1">
      <div className="font-semibold text-sm">{trade.marketSymbol || "Unassigned market"}</div>
      <div className="text-[11px] text-muted-foreground mt-1">{trade.strategyName || "Unknown strategy"} · v{trade.strategyVersionNumber ?? "—"} · {date(trade.createdAt)}</div>
    </div>
    <span className={`tag tag-${trade.status}`}>{trade.status}</span>
    {trade.pnl != null && <span className={`mono text-xs font-semibold ${trade.pnl >= 0 ? "text-primary" : "text-destructive"}`}>{money(trade.pnl)}</span>}
    <div className="flex"><button className="btn btn-ghost" onClick={onEdit}>Edit</button><button className="btn btn-ghost text-destructive" onClick={onDelete}><Trash2 size={13} /></button></div>
  </div>;
}

function TradeEditor({
  trade,
  markets,
  strategies,
  onClose,
}: {
  trade: Trade | null;
  markets: Market[];
  strategies: Strategy[];
  onClose: () => void;
}) {
  const initialStrategy = trade ? strategies.find(strategy => strategy.id === trade.strategyId) : strategies.find(strategy => strategy.status === "active") || strategies[0];
  const [strategyId, setStrategyId] = useState(initialStrategy?.id || 0);
  const versions = useListStrategyVersions(strategyId, { query: { enabled: !!strategyId, queryKey: getListStrategyVersionsQueryKey(strategyId) } });
  const create = useCreateTrade();
  const update = useUpdateTrade();
  const queryClient = useQueryClient();
  const [error, setError] = useState("");
  const availableVersions = versions.data || [];
  const defaultVersionId = trade?.strategyVersionId || availableVersions.find(version => version.isActive)?.id || availableVersions[0]?.id || 0;
  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const numberOrNull = (key: string) => form.get(key) ? Number(form.get(key)) : null;
    const common = {
      marketId: form.get("marketId") ? Number(form.get("marketId")) : null,
      side: String(form.get("side") || "long") as "long" | "short",
      status: String(form.get("status") || "planned") as "planned" | "open" | "closed" | "cancelled",
      quantity: numberOrNull("quantity"),
      entryPrice: numberOrNull("entryPrice"),
      exitPrice: numberOrNull("exitPrice"),
      stopLoss: numberOrNull("stopLoss"),
      takeProfit: numberOrNull("takeProfit"),
      riskUnit: (String(form.get("riskUnit") || "") || null) as TradeInputRiskUnit,
      riskAmount: numberOrNull("riskAmount"),
      pnl: numberOrNull("pnl"),
      openedAt: String(form.get("openedAt") || "") ? new Date(String(form.get("openedAt"))).toISOString() : null,
      closedAt: String(form.get("closedAt") || "") ? new Date(String(form.get("closedAt"))).toISOString() : null,
      thesis: String(form.get("thesis") || "") || null,
      notes: String(form.get("notes") || "") || null,
    };
    const done = () => {
      queryClient.invalidateQueries({ queryKey: getListTradesQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetJournalPerformanceQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetPerformanceSummaryQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListStrategiesQueryKey() });
      const affectedStrategyId = trade?.strategyId || strategyId;
      if (affectedStrategyId) queryClient.invalidateQueries({ queryKey: getListStrategyVersionsQueryKey(affectedStrategyId) });
      onClose();
    };
    const failed = (failure: unknown) => setError(failure instanceof Error ? failure.message : "Could not save this trade.");
    if (trade) update.mutate({ tradeId: trade.id, data: common }, { onSuccess: done, onError: failed });
    else {
      const strategyVersionId = Number(form.get("strategyVersionId"));
      if (!strategyVersionId) {
        setError("Select the exact strategy version used for this trade.");
        return;
      }
      create.mutate({ data: { ...common, strategyVersionId } }, { onSuccess: done, onError: failed });
    }
  };
  return <form onSubmit={save} className="space-y-4">
    {error && <div className="rounded-md bg-destructive/10 border border-destructive/40 p-3 text-xs text-destructive">{error}</div>}
    {trade ? <div className="rounded-md border border-primary/30 bg-primary/5 p-4">
      <div className="eyebrow">Strategy version used</div>
      <div className="font-semibold text-sm mt-2">{trade.strategyName} · v{trade.strategyVersionNumber}</div>
      <p className="text-[11px] text-muted-foreground mt-1">This association is locked so the historical record cannot silently move to another version.</p>
    </div> : <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <Field label="Strategy">
        <select className="select" value={strategyId} onChange={event => setStrategyId(Number(event.target.value))} required data-testid="select-trade-strategy">
          <option value="">Select strategy</option>{strategies.map(strategy => <option key={strategy.id} value={strategy.id}>{strategy.name}</option>)}
        </select>
      </Field>
      <Field label="Exact version" hint="Every trade remains attached to this saved version.">
        <select className="select" name="strategyVersionId" key={`${strategyId}-${defaultVersionId}`} defaultValue={defaultVersionId || ""} required disabled={!strategyId || versions.isLoading} data-testid="select-trade-strategy-version">
          <option value="">Select version</option>{availableVersions.map((version: StrategyVersion) => <option key={version.id} value={version.id}>v{version.versionNumber}{version.isActive ? " · Active" : ""}{version.label ? ` · ${version.label}` : ""}</option>)}
        </select>
      </Field>
    </div>}
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <Field label="Market"><select className="select" name="marketId" defaultValue={trade?.marketId || ""}><option value="">Unassigned</option>{markets.map(market => <option key={market.id} value={market.id}>{market.symbol}</option>)}</select></Field>
      <Field label="Side"><select className="select" name="side" defaultValue={trade?.side || "long"}><option value="long">Long</option><option value="short">Short</option></select></Field>
    </div>
    <Field label="Status"><select className="select" name="status" defaultValue={trade?.status || "planned"}><option value="planned">Planned</option><option value="open">Open</option><option value="closed">Closed</option><option value="cancelled">Cancelled</option></select></Field>
    <div className="grid grid-cols-2 gap-4">
      <Field label="Quantity"><input className="input" type="number" step="any" name="quantity" defaultValue={trade?.quantity ?? ""} /></Field>
      <Field label="Entry price"><input className="input" type="number" step="any" name="entryPrice" defaultValue={trade?.entryPrice ?? ""} /></Field>
      <Field label="Exit price"><input className="input" type="number" step="any" name="exitPrice" defaultValue={trade?.exitPrice ?? ""} /></Field>
      <Field label="Stop loss"><input className="input" type="number" step="any" name="stopLoss" defaultValue={trade?.stopLoss ?? ""} /></Field>
      <Field label="Take profit"><input className="input" type="number" step="any" name="takeProfit" defaultValue={trade?.takeProfit ?? ""} /></Field>
      <Field label="P&L"><input className="input" type="number" step="any" name="pnl" defaultValue={trade?.pnl ?? ""} /></Field>
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <Field label="Risk unit" hint="Optional position-risk context for later review.">
        <select className="select" name="riskUnit" defaultValue={trade?.riskUnit ?? ""}>
          <option value="">Not specified</option><option value="percent">Percent</option><option value="amount">Amount</option><option value="r">R multiple</option>
        </select>
      </Field>
      <Field label="Risk amount"><input className="input" type="number" step="any" name="riskAmount" defaultValue={trade?.riskAmount ?? ""} /></Field>
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <Field label="Opened at"><input className="input" type="datetime-local" name="openedAt" defaultValue={dateTimeInput(trade?.openedAt)} /></Field>
      <Field label="Closed at"><input className="input" type="datetime-local" name="closedAt" defaultValue={dateTimeInput(trade?.closedAt)} /></Field>
    </div>
    <Field label="Thesis"><textarea className="textarea" name="thesis" defaultValue={trade?.thesis || ""} placeholder="Why did this trade make sense?" /></Field>
    <Field label="Notes"><textarea className="textarea" name="notes" defaultValue={trade?.notes || ""} /></Field>
    <div className="flex justify-end gap-3"><button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={create.isPending || update.isPending || (!trade && !strategies.length)} data-testid="button-submit-trade">{create.isPending || update.isPending ? "Saving…" : "Save trade"}</button></div>
  </form>;
}

export function TradeJournalPage() {
  const trades = useListTrades();
  const markets = useListMarkets();
  const strategies = useListStrategies();
  const remove = useDeleteTrade();
  const queryClient = useQueryClient();
  const [modal, setModal] = useState<Trade | "new" | null>(() => new URLSearchParams(window.location.search).get("record") === "1" ? "new" : null);
  const [confirm, setConfirm] = useState<Trade | null>(null);
  const [filter, setFilter] = useState("all");
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const rows = useMemo(() => (trades.data || []).filter(trade => filter === "all" || trade.status === filter), [filter, trades.data]);
  const deleteTrade = () => {
    if (!confirm) return;
    remove.mutate({ tradeId: confirm.id }, { onSuccess: () => {
      setConfirm(null);
      queryClient.invalidateQueries({ queryKey: getListTradesQueryKey() });
       queryClient.invalidateQueries({ queryKey: getGetJournalPerformanceQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetPerformanceSummaryQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListStrategiesQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListStrategyVersionsQueryKey(confirm.strategyId) });
    } });
  };
   return <div className="page-wrap">
     <div className="page-heading flex flex-col sm:flex-row sm:items-start justify-between gap-5 mb-8">
      <div><div className="eyebrow mb-3">Journal</div><h1 className="display text-3xl md:text-4xl font-bold">Trade journal</h1><p className="text-muted-foreground text-sm mt-3 max-w-2xl">Every trade is stored against the exact saved strategy version used.</p></div>
      <button className="btn btn-primary" onClick={() => setModal("new")} disabled={!strategies.data?.length} data-testid="button-create-trade"><Plus size={15} /> Record trade</button>
    </div>
     <JournalPerformance month={month} setMonth={setMonth} strategies={strategies.data || []} markets={markets.data || []} trades={trades.data || []} />
     <div className="journal-trades-heading flex flex-col sm:flex-row sm:items-center justify-between gap-3"><div><div className="eyebrow">The record</div><h2 className="font-semibold mt-2">Trade entries</h2></div><div className="text-xs text-muted-foreground">Edit or remove the source records behind the review.</div></div>
    <div className="flex gap-2 mb-5 overflow-x-auto">{["all", "planned", "open", "closed", "cancelled"].map(status => <button key={status} className={`btn whitespace-nowrap ${filter === status ? "btn-primary" : "btn-secondary"}`} onClick={() => setFilter(status)}>{status === "all" ? "All" : status}</button>)}</div>
     {trades.isError || markets.isError || strategies.isError ? <div className="panel p-10 text-center"><p className="text-sm text-muted-foreground">The journal could not be loaded.</p><button className="btn btn-secondary mt-4" onClick={() => { trades.refetch(); markets.refetch(); strategies.refetch(); }}>Try again</button></div> : trades.isLoading || markets.isLoading || strategies.isLoading ? <div className="panel p-10 text-center text-sm text-muted-foreground">Loading journal…</div> : rows.length ? <div className="panel divide-y divide-border">{rows.map(trade => <TradeRow key={trade.id} trade={trade} onEdit={() => setModal(trade)} onDelete={() => setConfirm(trade)} />)}</div> : <div className="panel empty-grid p-10 md:p-14 text-center"><BookOpen size={22} className="text-primary mx-auto" /><h2 className="font-semibold text-lg mt-5">{filter === "all" ? "No recorded trades yet" : "Nothing in this view"}</h2><p className="text-sm text-muted-foreground mt-2">{strategies.data?.length ? "Record a trade and select the exact strategy version used." : "Create a strategy before recording a trade."}</p></div>}
    {modal && <Modal title={modal === "new" ? "Record trade" : "Edit trade"} onClose={() => setModal(null)}><TradeEditor trade={modal === "new" ? null : modal} markets={markets.data || []} strategies={strategies.data || []} onClose={() => setModal(null)} /></Modal>}
    {confirm && <Modal title="Delete trade?" onClose={() => setConfirm(null)}><p className="text-sm text-muted-foreground">This removes the journal entry and its contribution to version performance.</p><div className="flex justify-end gap-3 mt-6"><button className="btn btn-secondary" onClick={() => setConfirm(null)}>Cancel</button><button className="btn bg-destructive text-destructive-foreground" onClick={deleteTrade} disabled={remove.isPending}>Delete trade</button></div></Modal>}
  </div>;
}