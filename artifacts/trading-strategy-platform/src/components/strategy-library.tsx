import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "wouter";
import {
  Archive, Boxes, CheckCircle2, Copy, Edit3, ExternalLink, MoreHorizontal,
  PauseCircle, Pencil, Plus, Search, Trash2, X,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetDashboardSummaryQueryKey,
  getListStrategiesQueryKey,
  useCreateStrategy,
  useDeleteStrategy,
  useDuplicateStrategy,
  useListMarkets,
  useListStrategies,
  useUpdateStrategy,
  type Market,
  type Strategy,
} from "@workspace/api-client-react";

type EditorState = { mode: "create" } | { mode: "edit"; strategy: Strategy } | { mode: "rename"; strategy: Strategy } | null;
type StatusFilter = "all" | "active" | "inactive" | "archived";

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-5" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <div className="panel w-full max-w-2xl max-h-[94dvh] overflow-y-auto p-6 rise">
      <div className="flex items-center justify-between mb-6">
        <h2 className="font-semibold text-lg">{title}</h2>
        <button type="button" className="btn btn-ghost" onClick={onClose} aria-label="Close"><X size={17} /></button>
      </div>
      {children}
    </div>
  </div>;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="block">
    <span className="label">{label}</span>
    {children}
    {hint && <span className="block text-[11px] text-muted-foreground mt-1.5">{hint}</span>}
  </label>;
}

function statusLabel(status: Strategy["status"]) {
  if (status === "active") return "Active";
  if (status === "archived") return "Archived";
  return "Inactive";
}

function readError(error: unknown) {
  if (error instanceof Error) return error.message;
  return "The strategy could not be updated.";
}

function StrategyEditor({
  strategy,
  markets,
  onClose,
}: {
  strategy: Strategy | null;
  markets: Market[];
  onClose: () => void;
}) {
  const create = useCreateStrategy();
  const update = useUpdateStrategy();
  const queryClient = useQueryClient();
  const [error, setError] = useState("");
  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    const data = {
      name: String(form.get("name") || "").trim(),
      description: String(form.get("description") || "") || null,
      status: (strategy?.status || "draft") as "draft" | "active" | "archived",
      marketId: form.get("marketId") ? Number(form.get("marketId")) : null,
      assetClass: String(form.get("assetClass") || "") || null,
      direction: String(form.get("direction") || "both") as "long" | "short" | "both",
      timeframes: String(form.get("timeframes") || "").split(",").map(value => value.trim()).filter(Boolean),
      riskManagementRules: String(form.get("riskManagementRules") || "") || null,
      resetRules: String(form.get("resetRules") || "") || null,
      alertRules: String(form.get("alertRules") || "") || null,
    };
    const done = () => {
      queryClient.invalidateQueries({ queryKey: getListStrategiesQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
      onClose();
    };
    const failed = (failure: unknown) => setError(readError(failure));
    if (strategy) update.mutate({ strategyId: strategy.id, data }, { onSuccess: done, onError: failed });
    else create.mutate({ data }, { onSuccess: done, onError: failed });
  };
  const busy = create.isPending || update.isPending;
  return <form onSubmit={save} className="space-y-5">
    {error && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">{error}</div>}
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Field label="Strategy name"><input className="input" name="name" required defaultValue={strategy?.name || ""} placeholder="Name your strategy" data-testid="input-library-strategy-name" /></Field>
      <Field label="Market / instrument">
        <select className="select" name="marketId" defaultValue={strategy?.marketId || ""} data-testid="select-library-strategy-market">
          <option value="">No specific instrument</option>
          {markets.map(market => <option key={market.id} value={market.id}>{market.symbol} · {market.assetClass}</option>)}
        </select>
      </Field>
    </div>
    <Field label="Description"><textarea className="textarea" name="description" defaultValue={strategy?.description || ""} placeholder="Describe the hypothesis in your own words" /></Field>
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <Field label="Asset class"><input className="input" name="assetClass" defaultValue={strategy?.assetClass || ""} placeholder="Optional" /></Field>
      <Field label="Direction">
        <select className="select" name="direction" defaultValue={strategy?.direction || "both"}>
          <option value="long">Long</option><option value="short">Short</option><option value="both">Both</option>
        </select>
      </Field>
      <Field label="Timeframes" hint="Separate with commas."><input className="input" name="timeframes" defaultValue={strategy?.timeframes?.join(", ") || ""} placeholder="Daily, 4H" /></Field>
    </div>
    <div className="border-t border-border pt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
      <Field label="Risk-management rules"><textarea className="textarea" name="riskManagementRules" defaultValue={strategy?.riskManagementRules || ""} /></Field>
      <Field label="Reset rules"><textarea className="textarea" name="resetRules" defaultValue={strategy?.resetRules || ""} /></Field>
    </div>
    <Field label="Alert notes" hint="Notes only. No live alerts are created here."><textarea className="textarea" name="alertRules" defaultValue={strategy?.alertRules || ""} /></Field>
    <div className="flex justify-end gap-3">
      <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
      <button className="btn btn-primary" disabled={busy} data-testid="button-save-library-strategy">{busy ? "Saving…" : "Save strategy"}</button>
    </div>
  </form>;
}

function RenameEditor({ strategy, onClose }: { strategy: Strategy; onClose: () => void }) {
  const update = useUpdateStrategy();
  const queryClient = useQueryClient();
  const [error, setError] = useState("");
  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("name") || "").trim();
    update.mutate({ strategyId: strategy.id, data: { name } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListStrategiesQueryKey() });
        onClose();
      },
      onError: failure => setError(readError(failure)),
    });
  };
  return <form onSubmit={save} className="space-y-5">
    {error && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">{error}</div>}
    <Field label="Strategy name"><input name="name" className="input" required defaultValue={strategy.name} autoFocus data-testid="input-rename-strategy" /></Field>
    <div className="flex justify-end gap-3">
      <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
      <button className="btn btn-primary" disabled={update.isPending} data-testid="button-confirm-rename-strategy">{update.isPending ? "Renaming…" : "Rename strategy"}</button>
    </div>
  </form>;
}

function StrategyCard({
  strategy,
  busy,
  onEdit,
  onRename,
  onDuplicate,
  onStatus,
  onDelete,
}: {
  strategy: Strategy;
  busy: boolean;
  onEdit: () => void;
  onRename: () => void;
  onDuplicate: () => void;
  onStatus: (status: "draft" | "active" | "archived") => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const hasWinRate = strategy.tradeCount > 0 && strategy.winRate != null;
  return <article className="panel panel-hover p-5 md:p-6 flex flex-col" data-testid={`card-strategy-${strategy.id}`}>
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`tag tag-${strategy.status}`}>{statusLabel(strategy.status)}</span>
          <span className="tag tag-draft mono">{strategy.currentVersion ? `v${strategy.currentVersion}` : "No version"}</span>
        </div>
        <h2 className="font-semibold text-lg mt-4 truncate">{strategy.name}</h2>
        <p className="text-xs text-muted-foreground mt-2 line-clamp-2 leading-relaxed">{strategy.description || "No description yet."}</p>
      </div>
      <div className="relative shrink-0">
        <button className="btn btn-ghost" onClick={() => setMenuOpen(open => !open)} aria-label={`Actions for ${strategy.name}`} data-testid={`button-strategy-actions-${strategy.id}`}><MoreHorizontal size={17} /></button>
        {menuOpen && <div className="absolute right-0 top-full z-20 mt-2 panel p-1.5 w-48 shadow-xl">
          <button className="w-full px-3 py-2 text-left text-xs rounded-md hover:bg-secondary flex items-center gap-2" onClick={() => { setMenuOpen(false); onEdit(); }}><Edit3 size={13} /> Edit</button>
          <button className="w-full px-3 py-2 text-left text-xs rounded-md hover:bg-secondary flex items-center gap-2" onClick={() => { setMenuOpen(false); onRename(); }}><Pencil size={13} /> Rename</button>
          <button className="w-full px-3 py-2 text-left text-xs rounded-md hover:bg-secondary flex items-center gap-2" onClick={() => { setMenuOpen(false); onDuplicate(); }}><Copy size={13} /> Duplicate</button>
          {strategy.status === "active"
            ? <button className="w-full px-3 py-2 text-left text-xs rounded-md hover:bg-secondary flex items-center gap-2" onClick={() => { setMenuOpen(false); onStatus("draft"); }}><PauseCircle size={13} /> Deactivate</button>
            : <button className="w-full px-3 py-2 text-left text-xs rounded-md hover:bg-secondary flex items-center gap-2" onClick={() => { setMenuOpen(false); onStatus("active"); }}><CheckCircle2 size={13} /> Activate</button>}
          {strategy.status !== "archived" && <button className="w-full px-3 py-2 text-left text-xs rounded-md hover:bg-secondary flex items-center gap-2" onClick={() => { setMenuOpen(false); onStatus("archived"); }}><Archive size={13} /> Archive</button>}
          <button className="w-full px-3 py-2 text-left text-xs rounded-md hover:bg-secondary text-destructive flex items-center gap-2" onClick={() => { setMenuOpen(false); onDelete(); }}><Trash2 size={13} /> Delete</button>
        </div>}
      </div>
    </div>
    <div className="grid grid-cols-3 gap-3 mt-6 pt-5 border-t border-border">
      <div><div className="eyebrow">Market</div><div className="text-xs font-semibold mt-2 truncate">{strategy.marketSymbol || strategy.assetClass || "Not set"}</div></div>
      <div><div className="eyebrow">Trades</div><div className="text-xs font-semibold mt-2">{strategy.tradeCount}</div></div>
      <div><div className="eyebrow">Win rate</div><div className="text-xs font-semibold mt-2">{hasWinRate ? `${strategy.winRate!.toFixed(1)}%` : "—"}</div></div>
    </div>
    {!hasWinRate && <div className="mt-4 rounded-md bg-secondary/50 px-3 py-2 text-[11px] text-muted-foreground">Not enough data yet{strategy.tradeCount === 0 ? " — no recorded trades." : " — no closed trades with results."}</div>}
    <div className="mt-5 flex flex-col sm:flex-row gap-2">
      <Link href="/strategy-builder" className="btn btn-primary flex-1" data-testid={`link-open-strategy-builder-${strategy.id}`}>Open in Builder <ExternalLink size={13} /></Link>
      <button className="btn btn-secondary" disabled={busy} onClick={onEdit} data-testid={`button-edit-strategy-${strategy.id}`}><Pencil size={13} /> Edit</button>
    </div>
  </article>;
}

export function StrategyLibraryPage() {
  const strategies = useListStrategies();
  const markets = useListMarkets();
  const update = useUpdateStrategy();
  const duplicate = useDuplicateStrategy();
  const remove = useDeleteStrategy();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [editor, setEditor] = useState<EditorState>(null);
  const [confirmDelete, setConfirmDelete] = useState<Strategy | null>(null);
  const [actionError, setActionError] = useState("");

  const rows = useMemo(() => (strategies.data || []).filter(strategy => {
    const matchesSearch = `${strategy.name} ${strategy.marketSymbol || ""} ${strategy.assetClass || ""}`.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = status === "all"
      || (status === "active" && strategy.status === "active")
      || (status === "inactive" && strategy.status === "draft")
      || (status === "archived" && strategy.status === "archived");
    return matchesSearch && matchesStatus;
  }), [search, status, strategies.data]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: getListStrategiesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
  };
  const setStrategyStatus = (strategy: Strategy, nextStatus: "draft" | "active" | "archived") => {
    setActionError("");
    update.mutate({ strategyId: strategy.id, data: { status: nextStatus } }, { onSuccess: refresh, onError: error => setActionError(readError(error)) });
  };
  const duplicateStrategy = (strategy: Strategy) => {
    setActionError("");
    duplicate.mutate({ strategyId: strategy.id, data: { name: `${strategy.name} Copy` } }, { onSuccess: refresh, onError: error => setActionError(readError(error)) });
  };
  const deleteStrategy = () => {
    if (!confirmDelete) return;
    setActionError("");
    remove.mutate({ strategyId: confirmDelete.id }, {
      onSuccess: () => { setConfirmDelete(null); refresh(); },
      onError: error => { setConfirmDelete(null); setActionError(readError(error)); },
    });
  };
  const busy = update.isPending || duplicate.isPending || remove.isPending;

  return <div className="page-wrap">
    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-5 mb-8">
      <div>
        <div className="eyebrow mb-3">Strategy library</div>
        <h1 className="display text-3xl md:text-4xl font-bold">Saved strategies</h1>
        <p className="text-muted-foreground text-sm mt-3 max-w-2xl leading-relaxed">Manage the strategies you define in the Builder. Performance appears only when recorded trades provide enough data.</p>
      </div>
      <button className="btn btn-primary whitespace-nowrap" onClick={() => setEditor({ mode: "create" })} data-testid="button-create-strategy"><Plus size={15} /> New strategy</button>
    </div>
    <div className="panel p-3 mb-5 flex flex-col sm:flex-row gap-3">
      <div className="relative flex-1 min-w-0"><Search size={15} className="absolute left-3 top-3 text-muted-foreground" /><input className="input pl-9" placeholder="Search by strategy or market" value={search} onChange={event => setSearch(event.target.value)} data-testid="input-search-strategies" /></div>
      <div className="sm:w-48 shrink-0"><select className="select" value={status} onChange={event => setStatus(event.target.value as StatusFilter)} data-testid="select-filter-strategies">
        <option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option><option value="archived">Archived</option>
      </select></div>
    </div>
    {actionError && <div className="mb-5 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">{actionError}</div>}
    {strategies.isLoading || markets.isLoading
      ? <div className="panel p-10 text-center text-sm text-muted-foreground">Loading strategies…</div>
      : strategies.isError || markets.isError
        ? <div className="panel p-10 text-center"><div className="font-semibold">Couldn’t load the Strategy Library</div><button className="btn btn-secondary mt-4" onClick={() => strategies.refetch()}>Try again</button></div>
        : rows.length
          ? <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-4">{rows.map(strategy => <StrategyCard key={strategy.id} strategy={strategy} busy={busy} onEdit={() => setEditor({ mode: "edit", strategy })} onRename={() => setEditor({ mode: "rename", strategy })} onDuplicate={() => duplicateStrategy(strategy)} onStatus={nextStatus => setStrategyStatus(strategy, nextStatus)} onDelete={() => setConfirmDelete(strategy)} />)}</div>
          : <div className="panel empty-grid p-10 md:p-14 text-center">
            <div className="w-12 h-12 mx-auto rounded-xl bg-primary/10 text-primary flex items-center justify-center"><Boxes size={21} /></div>
            <h2 className="font-semibold text-lg mt-5">{strategies.data?.length ? "No strategies match these filters" : "No saved strategies yet"}</h2>
            <p className="text-sm text-muted-foreground mt-2">{strategies.data?.length ? "Adjust the search or status filter." : "Create a strategy here or start in the Strategy Builder."}</p>
            {!strategies.data?.length && <div className="flex flex-col sm:flex-row justify-center gap-3 mt-6"><button className="btn btn-primary" onClick={() => setEditor({ mode: "create" })}><Plus size={14} /> Create strategy</button><Link href="/strategy-builder" className="btn btn-secondary">Open Builder</Link></div>}
          </div>}
    {editor?.mode === "create" && <Modal title="Create strategy" onClose={() => setEditor(null)}><StrategyEditor strategy={null} markets={markets.data || []} onClose={() => setEditor(null)} /></Modal>}
    {editor?.mode === "edit" && <Modal title="Edit strategy" onClose={() => setEditor(null)}><StrategyEditor strategy={editor.strategy} markets={markets.data || []} onClose={() => setEditor(null)} /></Modal>}
    {editor?.mode === "rename" && <Modal title="Rename strategy" onClose={() => setEditor(null)}><RenameEditor strategy={editor.strategy} onClose={() => setEditor(null)} /></Modal>}
    {confirmDelete && <Modal title={`Delete “${confirmDelete.name}”?`} onClose={() => setConfirmDelete(null)}>
      <p className="text-sm text-muted-foreground leading-relaxed">This permanently deletes the strategy when it has no recorded trades. Strategies with trade history must be archived so their records remain intact.</p>
      <div className="flex justify-end gap-3 mt-6"><button className="btn btn-secondary" onClick={() => setConfirmDelete(null)}>Cancel</button><button className="btn bg-destructive text-destructive-foreground hover:opacity-90" disabled={remove.isPending} onClick={deleteStrategy} data-testid="button-confirm-delete-strategy">{remove.isPending ? "Deleting…" : "Delete strategy"}</button></div>
    </Modal>}
  </div>;
}