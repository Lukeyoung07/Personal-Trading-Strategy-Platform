import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "wouter";
import {
  ArrowRight, Check, Copy, GitCompareArrows, History, Plus, RotateCcw, X,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListStrategiesQueryKey,
  getListStrategyConditionsQueryKey,
  getListStrategyVersionConditionsQueryKey,
  getListStrategyVersionsQueryKey,
  useActivateStrategyVersion,
  useCloneStrategyVersion,
  useCreateStrategyVersion,
  useListStrategyVersionConditions,
  useListStrategyVersions,
  type Strategy,
  type StrategyVersion,
  type StrategyVersionCondition,
} from "@workspace/api-client-react";

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return <div className="fixed inset-0 z-[70] bg-black/65 flex items-end sm:items-center justify-center p-0 sm:p-5" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <div className="panel w-full max-w-xl max-h-[92dvh] overflow-y-auto p-6 rise">
      <div className="flex items-center justify-between gap-4 mb-6">
        <h2 className="font-semibold text-lg">{title}</h2>
        <button type="button" className="btn btn-ghost" onClick={onClose} aria-label="Close"><X size={16} /></button>
      </div>
      {children}
    </div>
  </div>;
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="block">
    <span className="label">{label}</span>
    {children}
    {hint && <span className="block text-[11px] text-muted-foreground mt-1.5">{hint}</span>}
  </label>;
}

function metric(value: number | null, suffix = "") {
  return value == null ? "Not enough data" : `${value.toFixed(2)}${suffix}`;
}

function versionTitle(version: StrategyVersion) {
  return `v${version.versionNumber}${version.label ? ` · ${version.label}` : ""}`;
}

function SnapshotSummary({ version, compact = false }: { version: StrategyVersion; compact?: boolean }) {
  return <div className="space-y-4">
    <div className={`grid grid-cols-2 ${compact ? "" : "md:grid-cols-4"} gap-3`}>
      <Summary label="Market" value={version.marketSymbol || "Not set"} />
      <Summary label="Direction" value={version.direction} />
      <Summary label="Timeframes" value={version.timeframes.length ? version.timeframes.join(", ") : "Not set"} />
      <Summary label="Conditions" value={String(version.conditionCount)} />
    </div>
    <div className={`grid grid-cols-2 ${compact ? "" : "md:grid-cols-4"} gap-3`}>
      <Summary label="Trades" value={String(version.tradeCount)} />
      <Summary label="Win rate" value={metric(version.winRate, "%")} />
      <Summary label="Net P&L" value={metric(version.netPnl)} />
      <Summary label="Average P&L" value={metric(version.averagePnl)} />
    </div>
    <div className={`grid grid-cols-1 ${compact ? "" : "md:grid-cols-2"} gap-3`}>
      <Rule label="Risk management" value={version.riskManagementRules || version.riskRules} />
      <Rule label="Reset rules" value={version.resetRules} />
      <Rule label="Entry rules" value={version.entryRules} />
      <Rule label="Exit rules" value={version.exitRules} />
      <Rule label="Alert notes" value={version.alertRules} />
      <Rule label="Version notes" value={version.notes} />
    </div>
  </div>;
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md bg-secondary/55 p-3 min-w-0"><div className="eyebrow">{label}</div><div className="text-xs font-semibold mt-2 break-words">{value}</div></div>;
}

function Rule({ label, value }: { label: string; value?: string | null }) {
  return <div className="rounded-md border border-border p-3"><div className="eyebrow">{label}</div><p className="text-xs text-muted-foreground mt-2 leading-relaxed whitespace-pre-wrap">{value || "Not defined"}</p></div>;
}

function ConditionsSnapshot({ conditions }: { conditions: StrategyVersionCondition[] }) {
  if (!conditions.length) return <div className="rounded-md bg-secondary/50 p-4 text-xs text-muted-foreground">No conditions were saved in this version.</div>;
  return <div className="space-y-2">{conditions.map((condition, index) => <div key={condition.id} className="rounded-md border border-border p-3">
    <div className="flex flex-wrap items-center gap-2"><span className="mono text-[10px] text-primary">{String(index + 1).padStart(2, "0")}</span><span className="tag tag-active">{condition.stage}</span><span className="tag tag-draft">{condition.requirement}</span></div>
    <div className="text-xs font-semibold mt-2">{condition.name}</div>
    <div className="text-[11px] text-primary mt-1">{condition.conceptName} · {condition.timeframe}</div>
    {condition.triggerRules && <p className="text-[11px] text-muted-foreground mt-2 leading-relaxed">{condition.triggerRules}</p>}
  </div>)}</div>;
}

function VersionComparison({ strategyId, versions }: { strategyId: number; versions: StrategyVersion[] }) {
  const [leftId, setLeftId] = useState(versions[1]?.id || versions[0]?.id || 0);
  const [rightId, setRightId] = useState(versions[0]?.id || 0);
  const left = versions.find(version => version.id === leftId) || versions[0];
  const right = versions.find(version => version.id === rightId) || versions[0];
  const leftConditions = useListStrategyVersionConditions(strategyId, left?.id || 0, { query: { enabled: !!left?.id, queryKey: getListStrategyVersionConditionsQueryKey(strategyId, left?.id || 0) } });
  const rightConditions = useListStrategyVersionConditions(strategyId, right?.id || 0, { query: { enabled: !!right?.id, queryKey: getListStrategyVersionConditionsQueryKey(strategyId, right?.id || 0) } });
  if (!left || !right) return null;
  const rows = [
    ["Name", left.name, right.name],
    ["Market", left.marketSymbol || "Not set", right.marketSymbol || "Not set"],
    ["Direction", left.direction, right.direction],
    ["Timeframes", left.timeframes.join(", ") || "Not set", right.timeframes.join(", ") || "Not set"],
    ["Risk rules", left.riskManagementRules || left.riskRules || "Not defined", right.riskManagementRules || right.riskRules || "Not defined"],
    ["Reset rules", left.resetRules || "Not defined", right.resetRules || "Not defined"],
    ["Alert notes", left.alertRules || "Not defined", right.alertRules || "Not defined"],
    ["Conditions", String(left.conditionCount), String(right.conditionCount)],
    ["Trades", String(left.tradeCount), String(right.tradeCount)],
    ["Win rate", metric(left.winRate, "%"), metric(right.winRate, "%")],
  ];
  return <div className="mt-5 border-t border-border pt-5" data-testid="version-comparison">
    <div className="flex items-center gap-2"><GitCompareArrows size={15} className="text-primary" /><h3 className="font-semibold">Compare versions</h3></div>
    <div className="grid grid-cols-2 gap-3 mt-4">
      <select className="select" value={left.id} onChange={event => setLeftId(Number(event.target.value))} data-testid="select-compare-version-left">{versions.map(version => <option key={version.id} value={version.id}>{versionTitle(version)}</option>)}</select>
      <select className="select" value={right.id} onChange={event => setRightId(Number(event.target.value))} data-testid="select-compare-version-right">{versions.map(version => <option key={version.id} value={version.id}>{versionTitle(version)}</option>)}</select>
    </div>
    <div className="mt-4 overflow-x-auto"><table><thead><tr><th>Setting</th><th>{`v${left.versionNumber}`}</th><th>{`v${right.versionNumber}`}</th></tr></thead><tbody>{rows.map(([label, a, b]) => <tr key={label}><td className="font-semibold">{label}</td><td className={a !== b ? "text-accent" : "text-muted-foreground"}>{a}</td><td className={a !== b ? "text-primary" : "text-muted-foreground"}>{b}</td></tr>)}</tbody></table></div>
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-5">
      <div><div className="eyebrow mb-3">{`v${left.versionNumber} conditions`}</div><ConditionsSnapshot conditions={leftConditions.data || []} /></div>
      <div><div className="eyebrow mb-3">{`v${right.versionNumber} conditions`}</div><ConditionsSnapshot conditions={rightConditions.data || []} /></div>
    </div>
  </div>;
}

function SaveVersionForm({ strategyId, onClose }: { strategyId: number; onClose: () => void }) {
  const create = useCreateStrategyVersion();
  const queryClient = useQueryClient();
  const [error, setError] = useState("");
  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    create.mutate({ strategyId, data: {
      label: String(form.get("label") || "") || null,
      thesis: String(form.get("thesis") || "") || null,
      entryRules: String(form.get("entryRules") || "") || null,
      exitRules: String(form.get("exitRules") || "") || null,
      riskRules: String(form.get("riskRules") || "") || null,
      notes: String(form.get("notes") || "") || null,
    } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListStrategyVersionsQueryKey(strategyId) });
        queryClient.invalidateQueries({ queryKey: getListStrategiesQueryKey() });
        onClose();
      },
      onError: error => setError(error instanceof Error ? error.message : "Could not save this version."),
    });
  };
  return <form onSubmit={save} className="space-y-4">
    {error && <div className="rounded-md bg-destructive/10 border border-destructive/40 p-3 text-xs text-destructive">{error}</div>}
    <div className="rounded-md border border-primary/25 bg-primary/5 p-3 text-xs text-muted-foreground leading-relaxed">This creates a new immutable version from the current Builder state. Earlier versions and their backtests stay unchanged.</div>
    <Field label="Version label"><input className="input" name="label" placeholder="What changed?" data-testid="input-new-version-label" /></Field>
    <Field label="Thesis"><textarea className="textarea" name="thesis" placeholder="What must be true for this version?" /></Field>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <Field label="Entry rules"><textarea className="textarea" name="entryRules" /></Field>
      <Field label="Exit rules"><textarea className="textarea" name="exitRules" /></Field>
    </div>
    <Field label="Additional risk rules"><textarea className="textarea" name="riskRules" /></Field>
    <Field label="Version notes"><textarea className="textarea" name="notes" /></Field>
    <p className="text-[11px] text-muted-foreground leading-relaxed">The current Builder settings and ordered conditions will be copied into a new immutable version. Earlier versions remain unchanged.</p>
    <div className="flex justify-end gap-3"><button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={create.isPending} data-testid="button-confirm-save-version">{create.isPending ? "Saving…" : "Save as new version"}</button></div>
  </form>;
}

export function StrategyVersionManager({ strategy, compact = false, initialVersionId }: { strategy: Strategy; compact?: boolean; initialVersionId?: number | null }) {
  const versionsQuery = useListStrategyVersions(strategy.id, { query: { queryKey: getListStrategyVersionsQueryKey(strategy.id) } });
  const activate = useActivateStrategyVersion();
  const clone = useCloneStrategyVersion();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showCompare, setShowCompare] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [cloneSource, setCloneSource] = useState<StrategyVersion | null>(null);
  const [error, setError] = useState("");
  const versions = versionsQuery.data || [];
  const selected = useMemo(() => versions.find(version => version.id === selectedId) || versions.find(version => version.isActive) || versions[0] || null, [selectedId, versions]);
  useEffect(() => {
    if (initialVersionId && versions.some(version => version.id === initialVersionId)) setSelectedId(initialVersionId);
  }, [initialVersionId, versions]);
  const conditions = useListStrategyVersionConditions(strategy.id, selected?.id || 0, { query: { enabled: !!selected?.id, queryKey: getListStrategyVersionConditionsQueryKey(strategy.id, selected?.id || 0) } });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: getListStrategyVersionsQueryKey(strategy.id) });
    queryClient.invalidateQueries({ queryKey: getListStrategiesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListStrategyConditionsQueryKey(strategy.id) });
  };
  const activateVersion = (version: StrategyVersion) => {
    if (version.isActive) return;
    if (!window.confirm(`Activate v${version.versionNumber}? Unsaved Builder changes will be replaced by this saved snapshot.`)) return;
    setError("");
    activate.mutate({ strategyId: strategy.id, versionId: version.id }, { onSuccess: refresh, onError: failure => setError(failure instanceof Error ? failure.message : "Could not activate this version.") });
  };
  const cloneVersion = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!cloneSource) return;
    const label = String(new FormData(event.currentTarget).get("label") || "") || null;
    clone.mutate({ strategyId: strategy.id, versionId: cloneSource.id, data: { label } }, {
      onSuccess: version => { setSelectedId(version.id); setCloneSource(null); refresh(); },
      onError: failure => setError(failure instanceof Error ? failure.message : "Could not create this version."),
    });
  };
  return <section id="strategy-version-manager" className={compact ? "panel p-5" : ""} data-testid="strategy-version-manager">
    <div className={`flex flex-col ${compact ? "" : "sm:flex-row sm:items-center"} justify-between gap-3`}>
      <div><div className="eyebrow">Version history</div><h2 className="font-semibold mt-2">{strategy.name}</h2><p className="text-xs text-muted-foreground mt-1">Saved versions are immutable. Current Builder edits become a new version when you choose to save one.</p></div>
      <div className={`grid ${compact ? "grid-cols-2" : "grid-cols-2"} gap-2`}><button className="btn btn-secondary" disabled={versions.length < 2} onClick={() => setShowCompare(value => !value)} data-testid="button-compare-versions"><GitCompareArrows size={14} /> Compare</button><button className="btn btn-primary" onClick={() => setSaveOpen(true)} data-testid="button-save-new-version"><Plus size={14} /> Save as New Version</button></div>
    </div>
    {error && <div className="rounded-md bg-destructive/10 border border-destructive/40 p-3 text-xs text-destructive mt-4">{error}</div>}
    {versionsQuery.isLoading ? <div className="rounded-md bg-secondary/50 p-5 text-xs text-muted-foreground mt-5">Loading versions…</div> : versionsQuery.isError ? <div className="rounded-md bg-destructive/10 p-5 text-xs text-destructive mt-5">Couldn’t load version history.</div> : versions.length ? <>
      <div className="flex gap-2 mt-5 overflow-x-auto pb-2">{versions.map(version => <button key={version.id} className={`shrink-0 rounded-md border px-3 py-2 text-left transition-colors ${selected?.id === version.id ? "border-primary bg-primary/10" : "border-border hover:bg-secondary"}`} onClick={() => setSelectedId(version.id)} data-testid={`button-select-version-${version.id}`}>
        <div className="flex items-center gap-2"><span className="mono text-xs font-semibold">{`v${version.versionNumber}`}</span>{version.isActive && <span className="tag tag-active">Active</span>}</div>
        <div className="text-[10px] text-muted-foreground mt-1 max-w-36 truncate">{version.label || "Saved snapshot"}</div>
      </button>)}</div>
      {selected && <div className="mt-4 rounded-lg border border-border p-4 md:p-5">
          <div className={`flex flex-col ${compact ? "" : "sm:flex-row sm:items-start"} justify-between gap-3 mb-5`}>
          <div><div className="flex items-center gap-2"><History size={15} className="text-primary" /><h3 className="font-semibold">{versionTitle(selected)}</h3>{selected.isActive && <Check size={14} className="text-primary" />}</div><div className="text-[11px] text-muted-foreground mt-2">{new Date(selected.createdAt).toLocaleString()}</div></div>
          <div className="flex flex-wrap gap-2"><Link className="btn btn-primary" href={`/backtesting?strategyId=${strategy.id}&strategyVersionId=${selected.id}`} data-testid={`link-backtest-version-${selected.id}`}><ArrowRight size={13} /> Backtest This Version</Link><button className="btn btn-secondary" disabled={selected.isActive || activate.isPending} onClick={() => activateVersion(selected)} data-testid={`button-activate-version-${selected.id}`}><RotateCcw size={13} /> {selected.isActive ? "Active" : "Activate"}</button><button className="btn btn-secondary" onClick={() => setCloneSource(selected)} data-testid={`button-clone-version-${selected.id}`}><Copy size={13} /> Create from</button></div>
        </div>
        <SnapshotSummary version={selected} compact={compact} />
        <div className="mt-5"><div className="eyebrow mb-3">Saved conditions</div>{conditions.isLoading ? <div className="text-xs text-muted-foreground">Loading conditions…</div> : <ConditionsSnapshot conditions={conditions.data || []} />}</div>
      </div>}
      {showCompare && !compact && <VersionComparison strategyId={strategy.id} versions={versions} />}
    </> : <div className="rounded-md bg-secondary/50 p-5 text-xs text-muted-foreground mt-5">No saved versions yet. Save the current Builder state as the first version.</div>}
    {saveOpen && <Modal title="Save as new version" onClose={() => setSaveOpen(false)}><SaveVersionForm strategyId={strategy.id} onClose={() => setSaveOpen(false)} /></Modal>}
    {showCompare && compact && <Modal title="Compare strategy versions" onClose={() => setShowCompare(false)}><VersionComparison strategyId={strategy.id} versions={versions} /></Modal>}
    {cloneSource && <Modal title={`Create from v${cloneSource.versionNumber}`} onClose={() => setCloneSource(null)}><form onSubmit={cloneVersion} className="space-y-4"><Field label="New version label"><input className="input" name="label" defaultValue={`Created from v${cloneSource.versionNumber}`} data-testid="input-clone-version-label" /></Field><p className="text-xs text-muted-foreground leading-relaxed">A new immutable version will copy this version’s settings, rules, and conditions. Its trade history stays separate and starts empty.</p><div className="flex justify-end gap-3"><button type="button" className="btn btn-secondary" onClick={() => setCloneSource(null)}>Cancel</button><button className="btn btn-primary" disabled={clone.isPending} data-testid="button-confirm-clone-version">{clone.isPending ? "Creating…" : <>Create version <ArrowRight size={13} /></>}</button></div></form></Modal>}
  </section>;
}