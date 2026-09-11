import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Link, Route, Switch, useLocation, useParams } from 'wouter';
import {
  Activity, AlertTriangle, Archive, ArrowDownRight, ArrowUpRight, BarChart3, Bell, BookOpen, CalendarClock,
  Boxes, Check, ChevronDown, ChevronRight, CircleHelp, ClipboardList, Clock3, Edit3, FileText, Filter, Gauge,
  LayoutDashboard, Menu, MoreHorizontal, Pencil, Plus, Search, Settings, SlidersHorizontal,
  Sparkles, Target, Trash2, TrendingUp, X, Zap
} from 'lucide-react';
import {
  AlertStatus, getGetDashboardSummaryQueryKey, getGetPerformanceSummaryQueryKey, getGetSettingsQueryKey,
  getListBacktestsQueryKey, useCreateBacktest, useListBacktests,
  getGetStrategyQueryKey, getListAlertsQueryKey, getListConceptsQueryKey, getListConditionsQueryKey,
  getListMarketsQueryKey, getListStrategiesQueryKey, getListStrategyVersionsQueryKey, getListTradesQueryKey,
  useCreateAlert, useCreateConcept, useCreateCondition, useCreateMarket, useCreateStrategy, useCreateStrategyVersion,
  useCreateTrade, useDeleteAlert, useDeleteConcept, useDeleteCondition, useDeleteMarket, useDeleteStrategy,
  useDeleteTrade, useGetDashboardSummary, useGetPerformanceSummary, useGetSettings, useGetStrategy, useListAlerts,
  useListConcepts, useListConditions, useListMarkets, useListStrategies, useListStrategyMonitors, useListStrategyVersions, useListTimeframes, useListTrades,
  useUpdateAlert, useUpdateConcept, useUpdateCondition, useUpdateMarket, useUpdateSettings, useUpdateStrategy,
  useUpdateTrade, type Alert, type AssistantStrategyDraft, type Backtest, type Condition, type Market, type Strategy, type StrategyMonitor, type Trade, type TradingConcept
} from '@workspace/api-client-react';
import { MarketMonitor } from '@/components/market-monitor';
import { ErrorBoundary } from '@/components/error-boundary';
import { StrategyBuilder } from '@/components/strategy-builder';
import { StrategyLibraryPage as StrategyLibrary } from '@/components/strategy-library';
import { TradeJournalPage as Journal } from '@/components/trade-journal';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { StrategyMonitoringPage } from '@/components/strategy-monitoring';
import { EconomicCalendar } from '@/components/economic-calendar';
import { BacktestResultsPanel } from '@/components/backtest-results';
import { AssistantPanel, type AssistantPanelContext } from '@/components/assistant-panel';
import { setPendingAssistantDraft } from '@/lib/assistant-draft-store';
import '@/index.css';

const queryClient = new QueryClient();
const nav = [
  { href:'/', label:'Overview', icon:LayoutDashboard },
  { href:'/strategy-builder', label:'Builder', icon:SlidersHorizontal },
  { href:'/strategy-library', label:'Strategies', icon:Boxes },
  { href:'/market-monitor', label:'Markets', icon:BarChart3 },
  { href:'/trade-journal', label:'Journal', icon:BookOpen },
  { href:'/performance', label:'Performance', icon:TrendingUp },
  { href:'/strategy-monitoring', label:'Monitor', icon:Activity },
  { href:'/alerts', label:'Alerts', icon:Bell },
  { href:'/news', label:'News', icon:CalendarClock },
];

function Shell({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const assistantContext = useMemo<AssistantPanelContext>(() => {
    const params = new URLSearchParams(window.location.search);
    const resultId = location.match(/^\/backtesting\/(\d+)/)?.[1];
    return {
      page: location,
      strategyId: Number(params.get("strategyId")) || null,
      versionId: Number(params.get("versionId") || params.get("strategyVersionId")) || null,
      backtestId: resultId ? Number(resultId) : null,
      instrumentId: Number(params.get("instrumentId")) || null,
      timeframeId: Number(params.get("timeframeId")) || null,
      startDate: params.get("startDate") || null,
      endDate: params.get("endDate") || null,
    };
  }, [location]);
  const reviewStrategyDraft = (draft: unknown, action: "review" | "save-version" = "review") => {
    setPendingAssistantDraft(draft as AssistantStrategyDraft);
    setAssistantOpen(false);
    setLocation(`/strategy-builder?assistantDraft=1&assistantAction=${action}`);
  };
  const openAssistantBacktest = (setup: any) => {
    const query = new URLSearchParams();
    if (setup?.strategyId) query.set("strategyId", String(setup.strategyId));
    if (setup?.versionId) query.set("strategyVersionId", String(setup.versionId));
    if (setup?.instrumentId) query.set("instrumentId", String(setup.instrumentId));
    if (setup?.timeframeId) query.set("timeframeId", String(setup.timeframeId));
    if (setup?.startDate) query.set("startDate", String(setup.startDate).slice(0, 10));
    if (setup?.endDate) query.set("endDate", String(setup.endDate).slice(0, 10));
    setAssistantOpen(false);
    setLocation(`/backtesting${query.toString() ? `?${query.toString()}` : ""}`);
  };
  return <div className="app-shell">
    <aside className={`sidebar ${mobileOpen ? 'mobile-open' : ''}`} aria-label="Primary navigation">
      <div className="px-5 pt-6 pb-7 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center shadow-sm shadow-primary/20"><Target size={17}/></div>
        <div className="brand-copy"><div className="font-bold tracking-tight text-sm">Tandem</div><div className="mono text-[9px] text-muted-foreground mt-0.5">TRADING WORKSPACE</div></div>
      </div>
      <div className="side-caption px-5 mb-2 eyebrow">Core workspace</div>
      <nav className="flex-1">
        {nav.map(({href,label,icon:Icon}) => <Link key={href} href={href} title={label} aria-current={isNavActive(href, location) ? 'page' : undefined} data-testid={`link-nav-${label.toLowerCase()}`} className={`nav-link ${isNavActive(href, location) ? 'active' : ''}`} onClick={()=>setMobileOpen(false)}><Icon size={16}/><span className="nav-label">{label}</span>{isNavActive(href, location) && <span className="ml-auto nav-label w-1.5 h-1.5 rounded-full bg-primary"/>}</Link>)}
        <div className="side-caption px-5 mt-7 mb-2 eyebrow">Utilities</div>
        <Link href="/backtesting" title="Backtesting" aria-current={isNavActive('/backtesting', location) ? 'page' : undefined} data-testid="link-nav-backtesting" className={`nav-link ${isNavActive('/backtesting', location) ? 'active' : ''}`} onClick={()=>setMobileOpen(false)}><Clock3 size={16}/><span className="nav-label">Backtesting</span></Link>
        <Link href="/settings" title="Settings" aria-current={isNavActive('/settings', location) ? 'page' : undefined} data-testid="link-nav-settings" className={`nav-link ${isNavActive('/settings', location) ? 'active' : ''}`} onClick={()=>setMobileOpen(false)}><Settings size={16}/><span className="nav-label">Settings</span></Link>
      </nav>
      <div className="side-footer-copy px-5 py-6 border-t border-sidebar-border">
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground"><span className="w-2 h-2 bg-primary rounded-full"/>Private workspace</div>
        <div className="mono text-[10px] text-muted-foreground mt-2 opacity-60">RECORDS OVER SIGNAL</div>
      </div>
    </aside>
    <main className="main-shell">
      <header className="topbar">
        <button className="btn btn-ghost md:hidden mobile-menu-toggle" onClick={()=>setMobileOpen(!mobileOpen)} aria-expanded={mobileOpen} aria-label="Toggle navigation" data-testid="button-toggle-menu"><Menu size={18}/></button>
        <div className="mobile-page-title">{pageName(location)}</div>
        <div className="hidden md:flex items-center gap-2 text-[11px] text-muted-foreground"><span className="w-1.5 h-1.5 bg-primary rounded-full"/> Personal workspace <ChevronRight size={13}/><span className="text-foreground">{pageName(location)}</span></div>
        <div className="flex items-center gap-3 ml-auto"><span className="mono text-[10px] text-muted-foreground mobile-hide">LOCAL RECORDS / NO FEED</span><div className="w-7 h-7 rounded-full border border-primary/40 text-primary flex items-center justify-center text-[10px] font-bold">TR</div></div>
      </header>
      {children}
      <button
        type="button"
        className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full border border-primary/35 bg-card px-4 py-3 text-xs font-semibold text-primary shadow-xl shadow-background/40 transition-transform hover:-translate-y-0.5"
        onClick={() => setAssistantOpen(true)}
        aria-label="Open AI Trading Assistant"
        data-testid="button-open-assistant"
      >
        <Sparkles size={15} /> AI Assistant
      </button>
      <AssistantPanel
        open={assistantOpen}
        onClose={() => setAssistantOpen(false)}
        context={assistantContext}
        onReviewStrategy={reviewStrategyDraft}
        onOpenBacktest={openAssistantBacktest}
      />
    </main>
  </div>;
}
function isNavActive(href:string, path:string) { return href === '/' ? path === '/' : path === href || path.startsWith(`${href}/`) || path.startsWith(`${href}?`); }
function pageName(path:string) { return nav.find(n=>isNavActive(n.href, path))?.label || (path.startsWith('/backtesting')?'Backtesting':path==='/settings'?'Settings':'Workspace'); }
export function Page({ eyebrow, title, description, action, children }: { eyebrow:string; title:string; description?:string; action?:ReactNode; children:ReactNode }) {
  return <div className="page-wrap"><div className="page-heading flex items-start justify-between gap-5 mb-8"><div><div className="eyebrow mb-3">{eyebrow}</div><h1 className="display text-3xl md:text-4xl font-bold">{title}</h1>{description&&<p className="text-muted-foreground text-sm mt-3 max-w-2xl leading-relaxed">{description}</p>}</div>{action}</div>{children}</div>;
}
export function Skeleton({ className='' }: {className?:string}) { return <div className={`skeleton ${className}`}/>; }
export function LoadingBlock() { return <div className="grid grid-cols-1 md:grid-cols-3 gap-4">{[1,2,3].map(i=><div className="panel p-5" key={i}><Skeleton className="w-20 h-3 mb-4"/><Skeleton className="w-28 h-8"/></div>)}</div>; }
export function ErrorState({ retry, message }: {retry?:()=>void; message?:string}) { return <div className="panel p-10 text-center"><AlertTriangle className="mx-auto text-destructive mb-3" size={22}/><div className="font-semibold">Couldn’t load these records</div><p className="text-muted-foreground text-sm mt-2">{message ?? 'Your workspace is intact. Try again when you’re ready.'}</p>{retry&&<button className="btn btn-secondary mt-5" onClick={retry} data-testid="button-retry">Retry</button>}</div>; }
export function EmptyState({ icon:Icon=FileText, title, text, action, testId='empty-state' }: {icon?:typeof FileText;title:string;text:string;action?:ReactNode;testId?:string}) { return <div className="panel empty-grid p-10 md:p-14 text-center" data-testid={testId}><div className="w-11 h-11 mx-auto rounded-xl border border-primary/30 bg-primary/10 text-primary flex items-center justify-center mb-5"><Icon size={20}/></div><h3 className="font-semibold text-lg">{title}</h3><p className="text-sm text-muted-foreground max-w-md mx-auto mt-2 leading-relaxed">{text}</p>{action&&<div className="mt-6">{action}</div>}</div>; }
function Stat({ label, value, icon:Icon, sub }: {label:string;value:ReactNode;icon:typeof Activity;sub?:string}) { return <div className="panel panel-hover p-5 rise"><div className="flex justify-between items-start"><span className="eyebrow">{label}</span><Icon size={16} className="text-muted-foreground"/></div><div className="metric-value mt-4" data-testid={`metric-${label.toLowerCase().replaceAll(' ','-')}`}>{value}</div>{sub&&<div className="text-[11px] text-muted-foreground mt-2">{sub}</div>}</div>; }
function Modal({ title, onClose, children }: {title:string;onClose:()=>void;children:ReactNode}) { return <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-5" onMouseDown={e=>e.target===e.currentTarget&&onClose()}><div className="panel w-full max-w-lg max-h-[92dvh] overflow-y-auto p-6 rise"><div className="flex items-center justify-between mb-6"><h2 className="font-semibold text-lg">{title}</h2><button onClick={onClose} className="btn btn-ghost" data-testid="button-close-modal"><X size={17}/></button></div>{children}</div></div>; }
function Field({ label, children }: {label:string;children:ReactNode}) { return <label className="block"><span className="label">{label}</span>{children}</label>; }
function Confirm({ title, onCancel, onConfirm, busy }: {title:string;onCancel:()=>void;onConfirm:()=>void;busy?:boolean}) { return <Modal title="Confirm removal" onClose={onCancel}><p className="text-sm text-muted-foreground leading-relaxed">{title} This cannot be undone.</p><div className="flex justify-end gap-2 mt-7"><button className="btn btn-secondary" onClick={onCancel} data-testid="button-cancel-delete">Keep it</button><button className="btn btn-danger" disabled={busy} onClick={onConfirm} data-testid="button-confirm-delete">{busy?'Removing…':'Remove'}</button></div></Modal>; }

function Dashboard() {
  const q=useGetDashboardSummary(); const summary=q.data;
  const strategies=useListStrategies(); const monitors=useListStrategyMonitors(); const trades=useListTrades(); const alerts=useListAlerts();
  const activeStrategy=strategies.data?.find(strategy=>strategy.status==='active') ?? null;
  const activeMonitor=activeStrategy ? monitors.data?.find(monitor=>monitor.strategyId===activeStrategy.id) : undefined;
  if(q.isLoading) return <Page eyebrow="Overview" title="Good to see you." description="Your workspace, kept deliberately close to the record."><LoadingBlock/></Page>;
  if(q.isError) return <Page eyebrow="Overview" title="Good to see you."><ErrorState retry={()=>q.refetch()}/></Page>;
  return <Page eyebrow="Overview" title="Good to see you." description="A quiet view of what you have built, recorded, and still need to examine.">
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-8">
      <Stat label="Strategies" value={summary?.strategyCount??0} sub={`${summary?.activeStrategyCount??0} active`} icon={Boxes}/>
      <Stat label="Journal entries" value={summary?.tradeCount??0} sub={summary?.latestTradeAt?`Last ${formatDate(summary.latestTradeAt)}`:'No entries yet'} icon={BookOpen}/>
      <Stat label="Markets" value={summary?.marketCount??0} sub="User-defined instruments" icon={BarChart3}/>
      <Stat label="Alerts" value={summary?.alertCount??0} sub="Personal reminders" icon={Bell}/>
    </div>
    <div className="grid grid-cols-1 lg:grid-cols-[1.35fr_.65fr] gap-4">
      <div className="panel p-5 md:p-6"><div className="flex items-center justify-between mb-5"><div><div className="eyebrow">Latest record</div><h2 className="font-semibold mt-2">Your journal, at a glance</h2></div><Link href="/trade-journal" className="text-xs text-primary hover:underline">Open journal <ChevronRight size={13} className="inline"/></Link></div>
        {trades.isLoading?<><Skeleton className="h-12 w-full"/><Skeleton className="h-12 w-full mt-2"/></>:trades.data?.length?<div className="space-y-1">{trades.data.slice(0,4).map((t:Trade)=><TradeRow key={t.id} trade={t}/>)}</div>:<EmptyState icon={BookOpen} title="The record starts here" text="A trade journal is useful before it is impressive. Capture the next decision while it is still fresh." action={<Link href="/trade-journal" className="btn btn-primary" data-testid="link-start-journal">Record a trade <Plus size={14}/></Link>}/>}
      </div>
      <div className="space-y-4"><div className="panel p-5"><div className="eyebrow">Current focus</div><div className="mt-4"><div className="text-lg font-bold truncate">{activeStrategy?.name ?? 'No active strategy'}</div><div className="text-xs text-muted-foreground mt-1">{activeStrategy?.currentVersion ? `Version ${activeStrategy.currentVersion}` : 'Create or activate a strategy to monitor it.'}</div></div><div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-4"><span className="text-xs text-muted-foreground">Monitoring</span><span className={`tag ${activeMonitor ? monitorTagClass(activeMonitor.overallStatus) : 'tag-archived'}`}>{activeMonitor ? monitorStatusLabel(activeMonitor.overallStatus) : 'Not configured'}</span></div><Link href={activeStrategy ? "/strategy-monitoring" : "/strategy-library"} className="text-xs text-primary inline-flex items-center gap-1 mt-4">{activeStrategy ? 'Open monitoring' : 'Open strategy library'} <ChevronRight size={13}/></Link></div>
      <div className="panel p-5"><div className="flex items-center justify-between"><div className="eyebrow">Active reminders</div><Link href="/alerts" className="text-xs text-primary">Manage</Link></div>{alerts.data?.length?<div className="mt-4 space-y-3">{alerts.data.slice(0,3).map((a:Alert)=><div key={a.id} className="flex gap-3 items-center"><div className="w-1.5 h-1.5 rounded-full bg-primary"/><div className="min-w-0"><div className="text-xs font-semibold truncate">{a.name}</div><div className="text-[11px] text-muted-foreground">{a.marketSymbol||'No market'} · {a.condition}</div></div></div>)}</div>:<p className="text-sm text-muted-foreground mt-4">No alerts are asking for your attention.</p>}</div></div>
    </div>
    <div className="mt-4 panel p-5 flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between"><div><div className="eyebrow">A deliberate pace</div><div className="font-semibold mt-2">Unfinished is a valid state.</div><p className="text-sm text-muted-foreground mt-1">Build your vocabulary before you force a strategy into existence.</p></div><Link href="/strategy-builder" className="btn btn-secondary whitespace-nowrap" data-testid="link-open-builder">Open builder <ArrowUpRight size={14}/></Link></div>
  </Page>;
}
function TradeRow({trade, onEdit, onDelete}:{trade:Trade;onEdit?:(t:Trade)=>void;onDelete?:(t:Trade)=>void}) { return <div className="flex items-center gap-3 p-3 rounded-md hover:bg-secondary/60 transition-colors" data-testid={`row-trade-${trade.id}`}><div className={`w-7 h-7 rounded-md flex items-center justify-center ${trade.side==='long'?'bg-primary/10 text-primary':'bg-accent/10 text-accent'}`}>{trade.side==='long'?<ArrowUpRight size={14}/>:<ArrowDownRight size={14}/>}</div><div className="min-w-0 flex-1"><div className="font-semibold text-xs">{trade.marketSymbol||'Unassigned market'}</div><div className="text-[11px] text-muted-foreground mt-1">{trade.side} · {formatDate(trade.createdAt)}</div></div><span className={`tag tag-${trade.status}`}>{trade.status}</span>{trade.pnl!==null&&trade.pnl!==undefined&&<span className={trade.pnl>=0?'text-primary':'text-destructive'}>{formatMoney(trade.pnl)}</span>}{onEdit&&<button className="btn btn-ghost" onClick={()=>onEdit(trade)} data-testid={`button-edit-trade-${trade.id}`}><Pencil size={13}/></button>}{onDelete&&<button className="btn btn-ghost" onClick={()=>onDelete(trade)} data-testid={`button-delete-trade-${trade.id}`}><Trash2 size={13}/></button>}</div>; }
function monitorStatusLabel(status: StrategyMonitor["overallStatus"]) {
  if (status === "met") return "Met";
  if (status === "not_met") return "Not met";
  if (status === "invalid") return "Invalid";
  return "Waiting";
}
function monitorTagClass(status: StrategyMonitor["overallStatus"]) {
  if (status === "met") return "tag-active";
  if (status === "invalid") return "tag-danger";
  if (status === "waiting") return "tag-warn";
  return "tag-archived";
}
function formatDate(value?:string|null){return value?new Date(value).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}):'—'}
function formatMoney(value?:number|null){return value===null||value===undefined?'—':`${value<0?'−':''}$${Math.abs(value).toFixed(2)}`}

function LegacyStrategyLibrary() {
  const q=useListStrategies(); const create=useCreateStrategy(); const update=useUpdateStrategy(); const del=useDeleteStrategy(); const qc=useQueryClient(); const [search,setSearch]=useState(''); const [modal,setModal]=useState<Strategy|null|false>(false); const [confirm,setConfirm]=useState<Strategy|null>(null);
  const rows=(q.data||[]).filter((s:Strategy)=>s.name.toLowerCase().includes(search.toLowerCase()));
  const save=(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();const d=new FormData(e.currentTarget);const data={name:String(d.get('name')),description:String(d.get('description')||'')||null,status:String(d.get('status')||'draft') as 'draft'|'active'|'archived'};const done=()=>{qc.invalidateQueries({queryKey:getListStrategiesQueryKey()});qc.invalidateQueries({queryKey:getGetDashboardSummaryQueryKey()});setModal(false)};modal&&typeof modal==='object'?update.mutate({strategyId:modal.id,data},{onSuccess:done}):create.mutate({data},{onSuccess:done})};
  return <Page eyebrow="Library" title="Strategies" description="Keep hypotheses, not fantasies. Each strategy can hold an evolving set of versions." action={<button className="btn btn-primary" onClick={()=>setModal(null)} data-testid="button-create-strategy"><Plus size={15}/> New strategy</button>}>
    <div className="flex flex-col sm:flex-row gap-3 mb-5"><div className="relative flex-1"><Search size={15} className="absolute left-3 top-3 text-muted-foreground"/><input className="input pl-9" placeholder="Search strategies" value={search} onChange={e=>setSearch(e.target.value)} data-testid="input-search-strategies"/></div><button className="btn btn-secondary" data-testid="button-filter-strategies"><Filter size={14}/> All statuses</button></div>
    {q.isLoading?<LoadingBlock/>:q.isError?<ErrorState retry={()=>q.refetch()}/>:rows.length?<div className="panel table-wrap"><table><thead><tr><th>Strategy</th><th>Status</th><th>Version</th><th>Updated</th><th></th></tr></thead><tbody>{rows.map((s:Strategy)=><tr key={s.id} data-testid={`row-strategy-${s.id}`}><td><div className="font-semibold">{s.name}</div><div className="text-[11px] text-muted-foreground mt-1 max-w-sm truncate">{s.description||'No description yet'}</div></td><td><span className={`tag tag-${s.status}`}>{s.status}</span></td><td className="mono text-muted-foreground">{s.currentVersion?`v${s.currentVersion}`:'—'}</td><td className="text-muted-foreground">{formatDate(s.updatedAt)}</td><td><div className="flex justify-end gap-1"><button className="btn btn-ghost" onClick={()=>setModal(s)} data-testid={`button-edit-strategy-${s.id}`}><Pencil size={14}/></button><button className="btn btn-ghost text-destructive" onClick={()=>setConfirm(s)} data-testid={`button-delete-strategy-${s.id}`}><Trash2 size={14}/></button></div></td></tr>)}</tbody></table></div>:<EmptyState icon={Boxes} title="No strategy on the shelf" text="Give the first hypothesis a name. You can keep it draft while the edges are still forming." action={<button className="btn btn-primary" onClick={()=>setModal(null)} data-testid="button-empty-create-strategy"><Plus size={14}/> Create strategy</button>}/>}
    {modal!==false&&<Modal title={modal&&typeof modal==='object'?'Edit strategy':'New strategy'} onClose={()=>setModal(false)}><form onSubmit={save} className="space-y-4"><Field label="Name"><input name="name" required defaultValue={modal&&typeof modal==='object'?modal.name:''} className="input" placeholder="Name the hypothesis" data-testid="input-strategy-name"/></Field><Field label="Description"><textarea name="description" defaultValue={modal&&typeof modal==='object'?modal.description||'':''} className="textarea" placeholder="What is this strategy trying to explain?" data-testid="input-strategy-description"/></Field><Field label="Status"><select name="status" defaultValue={modal&&typeof modal==='object'?modal.status:'draft'} className="select" data-testid="select-strategy-status"><option value="draft">Draft</option><option value="active">Active</option><option value="archived">Archived</option></select></Field><button className="btn btn-primary w-full mt-3" disabled={create.isPending||update.isPending} data-testid="button-submit-strategy">{create.isPending||update.isPending?'Saving…':'Save strategy'}</button></form></Modal>}{confirm&&<Confirm title={`Remove “${confirm.name}”?`} onCancel={()=>setConfirm(null)} onConfirm={()=>del.mutate({strategyId:confirm.id},{onSuccess:()=>{setConfirm(null);qc.invalidateQueries({queryKey:getListStrategiesQueryKey()});qc.invalidateQueries({queryKey:getGetDashboardSummaryQueryKey()})}})} busy={del.isPending}/>}
  </Page>;
}

 function Builder() {
  const concepts=useListConcepts(); const conditions=useListConditions(); const strategies=useListStrategies();
  const [tab,setTab]=useState<'concepts'|'conditions'>('concepts'); const [modal,setModal]=useState<'concept'|'condition'|false>(false);
  const [editing,setEditing]=useState<any>(null); const [versionModal,setVersionModal]=useState(false); const [conceptSearch,setConceptSearch]=useState('');
  const [selectedConceptIds,setSelectedConceptIds]=useState<number[]>([]);
  const strategyId=strategies.data?.[0]?.id||0; const versions=useListStrategyVersions(strategyId,{query:{enabled:!!strategyId,queryKey:getListStrategyVersionsQueryKey(strategyId)}});
  const openBuilderModal=(kind:'concept'|'condition', item?:any)=>{setEditing(item||null);setModal(kind)};
  const toggleConcept=(id:number)=>setSelectedConceptIds(current=>current.includes(id)?current.filter(value=>value!==id):[...current,id]);
  return <Page eyebrow="Workbench" title="Strategy builder" description="Start with language you trust. Collect concepts and conditions, then give a strategy its first version." action={<button className="btn btn-primary" onClick={()=>openBuilderModal(tab==='concepts'?'concept':'condition')} data-testid="button-builder-add"><Plus size={15}/> {tab==='concepts'?'Add Custom Concept':'Add condition'}</button>}>
    <div className="panel p-1 flex gap-1 mb-5 max-w-md"><button className={`btn flex-1 ${tab==='concepts'?'bg-secondary text-foreground':'btn-ghost'}`} onClick={()=>setTab('concepts')} data-testid="button-tab-concepts"><Sparkles size={14}/> Concepts <span className="mono text-[10px]">{concepts.data?.length||0}</span></button><button className={`btn flex-1 ${tab==='conditions'?'bg-secondary text-foreground':'btn-ghost'}`} onClick={()=>setTab('conditions')} data-testid="button-tab-conditions"><SlidersHorizontal size={14}/> Conditions <span className="mono text-[10px]">{conditions.data?.length||0}</span></button></div>
    {tab==='concepts'&&<ConceptPicker concepts={concepts.data||[]} search={conceptSearch} onSearch={setConceptSearch} selectedIds={selectedConceptIds} onToggle={toggleConcept} onAddCustom={()=>openBuilderModal('concept')} />}
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_310px] gap-5"><div>{tab==='concepts'?<ConceptList q={concepts} search={conceptSearch} onAdd={()=>openBuilderModal('concept')} onEdit={(item)=>openBuilderModal('concept',item)} />:<ConditionList q={conditions} onAdd={()=>openBuilderModal('condition')} onEdit={(item)=>openBuilderModal('condition',item)}/>}</div><div className="space-y-4">{strategies.data?.length?<div className="panel p-5"><div className="flex items-center justify-between"><div><div className="eyebrow">Versions</div><div className="font-semibold mt-2">{strategies.data[0].name}</div></div><button className="btn btn-ghost" onClick={()=>setVersionModal(true)} data-testid="button-add-version"><Plus size={14}/></button></div>{versions.data?.length?<div className="mt-4 space-y-2">{versions.data.map((v:any)=><div className="p-3 rounded-md bg-secondary/60" key={v.id} data-testid={`row-version-${v.id}`}><div className="flex justify-between"><span className="mono text-xs text-primary">v{v.versionNumber}</span><span className="text-[10px] text-muted-foreground">{formatDate(v.createdAt)}</span></div><div className="text-xs font-semibold mt-2">{v.label||'Untitled version'}</div></div>)}</div>:<p className="text-xs text-muted-foreground mt-4">No versions yet. The first one can stay rough.</p>}<button className="btn btn-secondary w-full mt-4" onClick={()=>setVersionModal(true)} data-testid="button-create-first-version"><Plus size={13}/> New version</button></div>:null}<div className="panel p-5 h-fit"><div className="eyebrow">Build order</div><div className="mt-5 space-y-4">{[['01','Name the idea','Concepts'],['02','Make it observable','Conditions'],['03','Write the version','Strategies']].map(([n,a,b])=><div className="flex gap-3" key={n}><span className="mono text-primary text-xs">{n}</span><div><div className="text-sm font-semibold">{a}</div><div className="text-xs text-muted-foreground mt-1">{b}</div></div></div>)}</div><div className="border-t border-border mt-6 pt-5 text-xs text-muted-foreground leading-relaxed">You do not need to decide everything today. A draft is a useful instrument.</div>{strategies.data?.length?<Link href="/strategy-library" className="btn btn-secondary w-full mt-5">Review strategies <ChevronRight size={14}/></Link>:null}</div></div></div>
    {modal&&<BuilderModal kind={modal} item={editing} onClose={()=>{setModal(false);setEditing(null)}}/>}{versionModal&&<VersionModal strategyId={strategyId} onClose={()=>setVersionModal(false)}/>}
  </Page>;
 }
 function ConceptPicker({concepts,search,onSearch,selectedIds,onToggle,onAddCustom}:{concepts:TradingConcept[];search:string;onSearch:(value:string)=>void;selectedIds:number[];onToggle:(id:number)=>void;onAddCustom:()=>void}) {
  const [open,setOpen]=useState(false);
  const filtered=concepts.filter(concept=>`${concept.name} ${concept.category||''}`.toLowerCase().includes(search.toLowerCase()));
  const selected=concepts.filter(concept=>selectedIds.includes(concept.id));
  return <div className="panel p-5 mb-5" data-testid="concept-picker"><div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4"><div><div className="eyebrow">Concept library</div><h2 className="font-semibold mt-2">Choose language for future strategy work</h2><p className="text-xs text-muted-foreground mt-2 max-w-2xl leading-relaxed">Select concepts from the shared library without attaching them to a strategy yet. Each concept can be defined in your own terms.</p></div><button className="btn btn-secondary whitespace-nowrap" onClick={onAddCustom} data-testid="button-add-custom-concept"><Plus size={14}/> Add Custom Concept</button></div><div className="relative mt-5"><Search size={15} className="absolute left-3 top-3 text-muted-foreground"/><input className="input pl-9 pr-9" value={search} onChange={event=>{onSearch(event.target.value);setOpen(true)}} onFocus={()=>setOpen(true)} placeholder="Search and select a concept" data-testid="input-search-concepts"/><ChevronDown size={15} className="absolute right-3 top-3 text-muted-foreground"/>{open&&<div className="absolute z-30 left-0 right-0 top-full mt-2 panel p-2 max-h-64 overflow-y-auto shadow-xl">{filtered.length?filtered.map(concept=><button key={concept.id} type="button" className="w-full text-left flex items-center justify-between gap-3 px-3 py-2.5 rounded-md hover:bg-secondary transition-colors" onClick={()=>{onToggle(concept.id);onSearch('')}} data-testid={`option-concept-${concept.id}`}><span><span className="block text-sm font-semibold">{concept.name}</span><span className="block text-[10px] text-muted-foreground mt-1">{concept.category||'CUSTOM'}{concept.isBuiltIn?' · Library':''}</span></span>{selectedIds.includes(concept.id)&&<Check size={15} className="text-primary shrink-0" />}</button>):<div className="p-4 text-sm text-muted-foreground">No concepts match that search.</div>}<button type="button" className="w-full text-left px-3 py-2.5 mt-1 border-t border-border text-xs text-primary hover:bg-secondary rounded-md" onClick={onAddCustom} data-testid="option-add-custom-concept"><Plus size={13} className="inline mr-2"/>Add Custom Concept</button></div>}</div>{selected.length?<div className="flex flex-wrap gap-2 mt-4">{selected.map(concept=><button key={concept.id} type="button" className="tag tag-active" onClick={()=>onToggle(concept.id)} data-testid={`selected-concept-${concept.id}`}>{concept.name}<X size={12}/></button>)}</div>:<div className="text-[11px] text-muted-foreground mt-4">No concepts selected. This working set is local to the builder and is not a strategy.</div>}</div>;
 }
 function ConceptList({q,search,onAdd,onEdit}:{q:any;search:string;onAdd:()=>void;onEdit:(item:TradingConcept)=>void}) {
  const del=useDeleteConcept();const qc=useQueryClient();if(q.isLoading)return <LoadingBlock/>;if(!q.data?.length)return <EmptyState icon={Sparkles} title="No concepts yet" text="The concept library is ready for your own vocabulary." action={<button className="btn btn-primary" onClick={onAdd} data-testid="button-empty-add-concept"><Plus size={14}/> Add Custom Concept</button>}/>;
  const rows=(q.data as TradingConcept[]).filter(concept=>`${concept.name} ${concept.category||''}`.toLowerCase().includes(search.toLowerCase()));
  if(!rows.length)return <EmptyState icon={Search} title="No matching concepts" text="Try a different search or add a custom concept to the library." action={<button className="btn btn-secondary" onClick={onAdd} data-testid="button-no-match-add-concept"><Plus size={14}/> Add Custom Concept</button>}/>;
  const groups=rows.reduce<Record<string,TradingConcept[]>>((result,concept)=>{const category=concept.category||'CUSTOM';(result[category]??=[]).push(concept);return result},{});
  return <div className="space-y-6">{Object.entries(groups).map(([category,items])=><section key={category}><div className="eyebrow mb-3">{category}</div><div className="grid grid-cols-1 md:grid-cols-2 gap-3">{items.map(c=><div className="panel panel-hover p-5" key={c.id} data-testid={`card-concept-${c.id}`}><div className="flex justify-between gap-3"><div className="flex gap-2 flex-wrap"><span className="tag tag-active">{c.isBuiltIn?'Library':'Custom'}</span>{!c.description&&!c.detectionRules&&!c.invalidationRules&&<span className="tag tag-draft">Needs definition</span>}</div><div className="flex shrink-0"><button className="btn btn-ghost" onClick={()=>onEdit(c)} data-testid={`button-edit-concept-${c.id}`}><Pencil size={13}/></button><button className="btn btn-ghost text-destructive" onClick={()=>del.mutate({conceptId:c.id},{onSuccess:()=>{qc.invalidateQueries({queryKey:getListConceptsQueryKey()});qc.invalidateQueries({queryKey:getGetDashboardSummaryQueryKey()})}})} data-testid={`button-delete-concept-${c.id}`}><Trash2 size={14}/></button></div></div><h3 className="font-semibold mt-4">{c.name}</h3><p className="text-xs text-muted-foreground mt-2 leading-relaxed">{c.description||'No universal definition is assumed. Customize this concept to match your own interpretation.'}</p>{(c.detectionRules||c.invalidationRules)&&<div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4 pt-4 border-t border-border"><div><div className="eyebrow">Detection</div><p className="text-[11px] text-muted-foreground mt-1 line-clamp-3">{c.detectionRules||'Not defined'}</p></div><div><div className="eyebrow">Invalidation</div><p className="text-[11px] text-muted-foreground mt-1 line-clamp-3">{c.invalidationRules||'Not defined'}</p></div></div>}</div>)}</div></section>)}</div>;
 }
 function ConditionList({q,onAdd,onEdit}:{q:any;onAdd:()=>void;onEdit:(item:Condition)=>void}) { const del=useDeleteCondition();const qc=useQueryClient();if(q.isLoading)return <LoadingBlock/>;if(!q.data?.length)return <EmptyState icon={SlidersHorizontal} title="No conditions yet" text="Turn observations into rules you can recognize and review." action={<button className="btn btn-primary" onClick={onAdd} data-testid="button-empty-add-condition"><Plus size={14}/> Add condition</button>}/>;return <div className="panel table-wrap"><table><thead><tr><th>Condition</th><th>Type</th><th>Definition</th><th></th></tr></thead><tbody>{q.data.map((c:Condition)=><tr key={c.id} data-testid={`row-condition-${c.id}`}><td className="font-semibold">{c.name}</td><td><span className="tag tag-draft">{c.type}</span></td><td className="text-muted-foreground max-w-xs truncate">{c.definition||'—'}</td><td><div className="flex"><button className="btn btn-ghost" onClick={()=>onEdit(c)} data-testid={`button-edit-condition-${c.id}`}><Pencil size={13}/></button><button className="btn btn-ghost text-destructive" onClick={()=>del.mutate({conditionId:c.id},{onSuccess:()=>qc.invalidateQueries({queryKey:getListConditionsQueryKey()})})} data-testid={`button-delete-condition-${c.id}`}><Trash2 size={14}/></button></div></td></tr>)}</tbody></table></div>; }
 function BuilderModal({kind,item,onClose}:{kind:'concept'|'condition';item?:any;onClose:()=>void}) {
  const c=useCreateConcept();const d=useCreateCondition();const cu=useUpdateConcept();const du=useUpdateCondition();const qc=useQueryClient();
  const save=(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();const f=new FormData(e.currentTarget);if(kind==='concept'){const data={name:String(f.get('name')),category:String(f.get('category')||'')||'CUSTOM',description:String(f.get('description')||'')||null,detectionRules:String(f.get('detectionRules')||'')||null,invalidationRules:String(f.get('invalidationRules')||'')||null};const done=()=>{qc.invalidateQueries({queryKey:getListConceptsQueryKey()});qc.invalidateQueries({queryKey:getGetDashboardSummaryQueryKey()});onClose()};item?cu.mutate({conceptId:item.id,data},{onSuccess:done}):c.mutate({data},{onSuccess:done})}else{const data={name:String(f.get('name')),type:String(f.get('type')),definition:String(f.get('definition')||'')||null};const done=()=>{qc.invalidateQueries({queryKey:getListConditionsQueryKey()});onClose()};item?du.mutate({conditionId:item.id,data},{onSuccess:done}):d.mutate({data},{onSuccess:done})}};
  if(kind==='concept')return <Modal title={item?'Edit concept':'Add Custom Concept'} onClose={onClose}><form onSubmit={save} className="space-y-4"><Field label="Concept name"><input className="input" name="name" required defaultValue={item?.name||''} placeholder="Name the concept" data-testid="input-concept-name"/></Field><Field label="Category"><input className="input" name="category" defaultValue={item?.category||'CUSTOM'} placeholder="Optional grouping" data-testid="input-concept-category"/></Field><Field label="Description"><textarea className="textarea" name="description" defaultValue={item?.description||''} placeholder="Your interpretation of this concept" data-testid="input-concept-description"/></Field><Field label="Detection rules"><textarea className="textarea" name="detectionRules" defaultValue={item?.detectionRules||''} placeholder="What must be true for you to call this concept present?" data-testid="input-concept-detection-rules"/></Field><Field label="Invalidation rules"><textarea className="textarea" name="invalidationRules" defaultValue={item?.invalidationRules||''} placeholder="What would make this concept no longer valid?" data-testid="input-concept-invalidation-rules"/></Field><p className="text-[11px] text-muted-foreground leading-relaxed">Definitions are yours to set. The library does not impose a universal interpretation.</p><button className="btn btn-primary w-full" disabled={c.isPending||cu.isPending} data-testid="button-submit-concept">{c.isPending||cu.isPending?'Saving…':'Save concept'}</button></form></Modal>;
  return <Modal title={`${item?'Edit':'Add'} condition`} onClose={onClose}><form onSubmit={save} className="space-y-4"><Field label="Name"><input className="input" name="name" required defaultValue={item?.name||''} data-testid="input-condition-name"/></Field><Field label="Type"><input className="input" name="type" required defaultValue={item?.type||''} placeholder="Price, time, context" data-testid="input-condition-type"/></Field><Field label="Definition"><textarea className="textarea" name="definition" defaultValue={item?.definition||''} data-testid="input-condition-definition"/></Field><button className="btn btn-primary w-full" disabled={d.isPending||du.isPending} data-testid="button-submit-condition">{d.isPending||du.isPending?'Saving…':'Save condition'}</button></form></Modal>;
 }
 function VersionModal({strategyId,onClose}:{strategyId:number;onClose:()=>void}) { const create=useCreateStrategyVersion();const qc=useQueryClient();const save=(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();const f=new FormData(e.currentTarget);const data={label:String(f.get('label')||'')||null,thesis:String(f.get('thesis')||'')||null,entryRules:String(f.get('entryRules')||'')||null,exitRules:String(f.get('exitRules')||'')||null,riskRules:String(f.get('riskRules')||'')||null,notes:String(f.get('notes')||'')||null};create.mutate({strategyId,data},{onSuccess:()=>{qc.invalidateQueries({queryKey:getListStrategyVersionsQueryKey(strategyId)});qc.invalidateQueries({queryKey:getListStrategiesQueryKey()});onClose()}})};return <Modal title="New strategy version" onClose={onClose}><form onSubmit={save} className="space-y-4"><Field label="Label"><input className="input" name="label" placeholder="Working hypothesis" data-testid="input-version-label"/></Field><Field label="Thesis"><textarea className="textarea" name="thesis" placeholder="What must be true?" data-testid="input-version-thesis"/></Field><Field label="Entry rules"><textarea className="textarea" name="entryRules" data-testid="input-version-entry"/></Field><Field label="Exit rules"><textarea className="textarea" name="exitRules" data-testid="input-version-exit"/></Field><Field label="Risk rules"><textarea className="textarea" name="riskRules" data-testid="input-version-risk"/></Field><Field label="Notes"><textarea className="textarea" name="notes" data-testid="input-version-notes"/></Field><button className="btn btn-primary w-full" disabled={create.isPending} data-testid="button-submit-version">{create.isPending?'Saving…':'Save version'}</button></form></Modal>; }

function LegacyMarkets() { const q=useListMarkets();const c=useCreateMarket();const u=useUpdateMarket();const del=useDeleteMarket();const qc=useQueryClient();const [modal,setModal]=useState<Market|null|false>(false);const [confirm,setConfirm]=useState<Market|null>(null);const save=(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();const f=new FormData(e.currentTarget);const data={assetClass:String(f.get('assetClass')),venue:String(f.get('venue')||'')||null,symbol:String(f.get('symbol')),description:String(f.get('description')||'')||null};const done=()=>{qc.invalidateQueries({queryKey:getListMarketsQueryKey()});qc.invalidateQueries({queryKey:getGetDashboardSummaryQueryKey()});setModal(false)};modal&&typeof modal==='object'?u.mutate({marketId:modal.id,data},{onSuccess:done}):c.mutate({data},{onSuccess:done})};return <Page eyebrow="Coverage" title="Market monitor" description="A personal watchlist, without the noise. Define the instruments you actually study; quotes do not enter this workspace." action={<button className="btn btn-primary" onClick={()=>setModal(null)} data-testid="button-create-market"><Plus size={15}/> Add market</button>}>{q.isLoading?<LoadingBlock/>:q.isError?<ErrorState retry={()=>q.refetch()}/>:q.data?.length?<div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">{q.data.map((m:Market)=><div className="panel panel-hover p-5" key={m.id} data-testid={`card-market-${m.id}`}><div className="flex justify-between"><span className="eyebrow">{m.assetClass}</span><div className="flex"><button className="btn btn-ghost" onClick={()=>setModal(m)} data-testid={`button-edit-market-${m.id}`}><Pencil size={13}/></button><button className="btn btn-ghost text-destructive" onClick={()=>setConfirm(m)} data-testid={`button-delete-market-${m.id}`}><Trash2 size={13}/></button></div></div><div className="text-xl font-bold mono mt-5">{m.symbol}</div><div className="text-xs text-muted-foreground mt-2">{m.venue||'Venue not specified'}</div><p className="text-xs text-muted-foreground mt-5 leading-relaxed">{m.description||'No notes attached.'}</p></div>)}</div>:<EmptyState icon={BarChart3} title="No markets in view" text="Keep the list small enough to remain useful. Add the symbols that belong in your own record." action={<button className="btn btn-primary" onClick={()=>setModal(null)} data-testid="button-empty-create-market"><Plus size={14}/> Add market</button>}/>}
    {modal!==false&&<Modal title={modal&&typeof modal==='object'?'Edit market':'Add market'} onClose={()=>setModal(false)}><form onSubmit={save} className="space-y-4"><Field label="Symbol"><input className="input mono" name="symbol" required defaultValue={modal&&typeof modal==='object'?modal.symbol:''} placeholder="Symbol or instrument" data-testid="input-market-symbol"/></Field><div className="grid grid-cols-2 gap-3"><Field label="Asset class"><input className="input" name="assetClass" required defaultValue={modal&&typeof modal==='object'?modal.assetClass:''} placeholder="Equity, FX…" data-testid="input-market-class"/></Field><Field label="Venue"><input className="input" name="venue" defaultValue={modal&&typeof modal==='object'?modal.venue||'':''} placeholder="Optional" data-testid="input-market-venue"/></Field></div><Field label="Description"><textarea className="textarea" name="description" defaultValue={modal&&typeof modal==='object'?modal.description||'':''} data-testid="input-market-description"/></Field><button className="btn btn-primary w-full" disabled={c.isPending||u.isPending} data-testid="button-submit-market">Save market</button></form></Modal>}{confirm&&<Confirm title={`Remove ${confirm.symbol}?`} onCancel={()=>setConfirm(null)} onConfirm={()=>del.mutate({marketId:confirm.id},{onSuccess:()=>{setConfirm(null);qc.invalidateQueries({queryKey:getListMarketsQueryKey()});qc.invalidateQueries({queryKey:getGetDashboardSummaryQueryKey()})}})} busy={del.isPending}/>}</Page>; }

function LegacyJournal() { const q=useListTrades();const markets=useListMarkets();const c=useCreateTrade();const u=useUpdateTrade();const del=useDeleteTrade();const qc=useQueryClient();const [modal,setModal]=useState<Trade|null|false>(false);const [confirm,setConfirm]=useState<Trade|null>(null);const [filter,setFilter]=useState('all');const rows=(q.data||[]).filter((t:Trade)=>filter==='all'||t.status===filter);const save=(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();const f=new FormData(e.currentTarget);const num=(key:string)=>f.get(key)?Number(f.get(key)):null;const data:any={marketId:f.get('marketId')?Number(f.get('marketId')):null,side:String(f.get('side')) as 'long'|'short',status:String(f.get('status')) as 'planned'|'open'|'closed'|'cancelled',quantity:num('quantity'),entryPrice:num('entryPrice'),exitPrice:num('exitPrice'),pnl:num('pnl'),openedAt:String(f.get('openedAt')||'')||null,closedAt:String(f.get('closedAt')||'')||null,thesis:String(f.get('thesis')||'')||null,notes:String(f.get('notes')||'')||null};const done=()=>{qc.invalidateQueries({queryKey:getListTradesQueryKey()});qc.invalidateQueries({queryKey:getGetDashboardSummaryQueryKey()});qc.invalidateQueries({queryKey:getGetPerformanceSummaryQueryKey()});setModal(false)};modal&&typeof modal==='object'?u.mutate({tradeId:modal.id,data},{onSuccess:done}):c.mutate({data},{onSuccess:done})};return <Page eyebrow="Journal" title="Trade journal" description="The trade is not the result. It is the decision, written down clearly enough to review later." action={<button className="btn btn-primary" onClick={()=>setModal(null)} data-testid="button-create-trade"><Plus size={15}/> Record trade</button>}><div className="flex gap-2 mb-5 overflow-x-auto">{['all','planned','open','closed','cancelled'].map(s=><button key={s} className={`btn whitespace-nowrap ${filter===s?'btn-primary':'btn-secondary'}`} onClick={()=>setFilter(s)} data-testid={`button-filter-${s}`}>{s==='all'?'All':s}</button>)}</div>{q.isLoading?<LoadingBlock/>:q.isError?<ErrorState retry={()=>q.refetch()}/>:rows.length?<div className="panel divide-y divide-border">{rows.map((t:Trade)=><TradeRow key={t.id} trade={t} onEdit={setModal} onDelete={setConfirm}/>)}</div>:<EmptyState icon={BookOpen} title={filter==='all'?'Your record is clear':'Nothing in this view'} text={filter==='all'?'The first entry does not need to be a good trade. It needs to be an honest one.':'Try another status, or record a new trade.'} action={<button className="btn btn-primary" onClick={()=>setModal(null)} data-testid="button-empty-create-trade"><Plus size={14}/> Record trade</button>}/>}
    {modal!==false&&<TradeModal trade={modal&&typeof modal==='object'?modal:null} markets={markets.data||[]} onClose={()=>setModal(false)} onSave={save} busy={c.isPending||u.isPending}/>} {confirm&&<Confirm title={`Remove this ${confirm.marketSymbol||'trade'} entry?`} onCancel={()=>setConfirm(null)} onConfirm={()=>del.mutate({tradeId:confirm.id},{onSuccess:()=>{setConfirm(null);qc.invalidateQueries({queryKey:getListTradesQueryKey()});qc.invalidateQueries({queryKey:getGetDashboardSummaryQueryKey()});qc.invalidateQueries({queryKey:getGetPerformanceSummaryQueryKey()})}})} busy={del.isPending}/>}</Page>; }
function TradeModal({trade,markets,onClose,onSave,busy}:{trade:Trade|null;markets:Market[];onClose:()=>void;onSave:(e:FormEvent<HTMLFormElement>)=>void;busy:boolean}) { return <Modal title={trade?'Edit trade':'Record trade'} onClose={onClose}><form onSubmit={onSave} className="space-y-4"><div className="grid grid-cols-2 gap-3"><Field label="Market"><select className="select" name="marketId" defaultValue={trade?.marketId||''} data-testid="select-trade-market"><option value="">Unassigned</option>{markets.map(m=><option key={m.id} value={m.id}>{m.symbol}</option>)}</select></Field><Field label="Side"><select className="select" name="side" defaultValue={trade?.side||'long'} data-testid="select-trade-side"><option value="long">Long</option><option value="short">Short</option></select></Field></div><Field label="Status"><select className="select" name="status" defaultValue={trade?.status||'planned'} data-testid="select-trade-status"><option value="planned">Planned</option><option value="open">Open</option><option value="closed">Closed</option><option value="cancelled">Cancelled</option></select></Field><div className="grid grid-cols-2 gap-3"><Field label="Quantity"><input className="input" type="number" step="any" name="quantity" defaultValue={trade?.quantity??''} data-testid="input-trade-quantity"/></Field><Field label="Entry price"><input className="input" type="number" step="any" name="entryPrice" defaultValue={trade?.entryPrice??''} data-testid="input-trade-entry"/></Field><Field label="Exit price"><input className="input" type="number" step="any" name="exitPrice" defaultValue={trade?.exitPrice??''} data-testid="input-trade-exit"/></Field><Field label="P&L"><input className="input" type="number" step="any" name="pnl" defaultValue={trade?.pnl??''} data-testid="input-trade-pnl"/></Field></div><Field label="Thesis"><textarea className="textarea" name="thesis" defaultValue={trade?.thesis||''} placeholder="Why did this trade make sense?" data-testid="input-trade-thesis"/></Field><Field label="Notes"><textarea className="textarea" name="notes" defaultValue={trade?.notes||''} data-testid="input-trade-notes"/></Field><button className="btn btn-primary w-full" disabled={busy} data-testid="button-submit-trade">{busy?'Saving…':'Save trade'}</button></form></Modal>; }

function Performance() {
  const q = useGetPerformanceSummary();
  if (q.isLoading) return <Page eyebrow="Review" title="Performance" description="Only what your journal can support."><LoadingBlock /></Page>;
  if (q.isError) return <Page eyebrow="Review" title="Performance"><ErrorState retry={() => q.refetch()} /></Page>;
  const p = q.data;
  if (!p?.hasData) return <Page eyebrow="Review" title="Performance" description="A measured read of closed records. No quotes, no assumptions, no invented curve."><EmptyState icon={TrendingUp} title="Performance begins with a closed record" text="There is nothing to summarize yet. Once you close and record trades, this page will stay grounded in those entries." action={<Link href="/trade-journal" className="btn btn-primary" data-testid="link-performance-journal">Open trade journal <ChevronRight size={14} /></Link>} /></Page>;
  const curve = p.equityCurve ?? [];
  const curveRange = Math.max(1, ...curve.map(point => Math.abs(point.equity)));
  return <Page eyebrow="Review" title="Performance" description="A measured read of closed records. No quotes, no assumptions, no invented curve.">
    <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-3 md:gap-4">
      <Stat label="Net P&L" value={formatMoney(p.netPnl)} icon={TrendingUp} />
      <Stat label="Win rate" value={`${p.winRate ?? 0}%`} icon={Target} />
      <Stat label="Trades" value={p.tradeCount} icon={BookOpen} />
      <Stat label="Winners" value={p.winningTrades} icon={ArrowUpRight} />
      <Stat label="Losers" value={p.losingTrades} icon={ArrowDownRight} />
      <Stat label="Profit factor" value={p.profitFactor == null ? "—" : p.profitFactor.toFixed(2)} icon={BarChart3} />
      <Stat label="Drawdown" value={formatMoney(p.maxDrawdown)} icon={Activity} />
      <Stat label="Average P&L" value={formatMoney(p.averagePnl)} icon={Gauge} />
    </div>
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 mt-5">
      <div className="panel p-6">
        <div className="eyebrow">Winner / loser profile</div>
        <div className="grid grid-cols-2 gap-4 mt-5">
          <div><div className="text-xs text-muted-foreground">Average winner</div><div className="mono text-xl font-semibold text-primary mt-2">{formatMoney(p.averageWinner)}</div></div>
          <div><div className="text-xs text-muted-foreground">Average loser</div><div className="mono text-xl font-semibold text-destructive mt-2">{formatMoney(p.averageLoser)}</div></div>
          <div><div className="text-xs text-muted-foreground">Largest winner</div><div className="mono text-sm font-semibold mt-2">{formatMoney(p.largestWin)}</div></div>
          <div><div className="text-xs text-muted-foreground">Largest loser</div><div className="mono text-sm font-semibold mt-2">{formatMoney(p.largestLoss)}</div></div>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed mt-6">Calculated only from closed journal trades with a recorded P&L. Simulated backtest trades stay separate.</p>
      </div>
      <div className="panel p-6">
        <div className="eyebrow">Equity over time</div>
        <div className="mt-5 space-y-3" data-testid="performance-equity-curve">
          {curve.map((point, index) => <div key={`${point.timestamp}-${index}`} className="grid grid-cols-[88px_minmax(0,1fr)_auto] items-center gap-3 text-xs">
            <span className="text-muted-foreground">{new Date(point.timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
            <div className="h-2 rounded-full bg-secondary overflow-hidden"><div className={`h-full rounded-full ${point.equity >= 0 ? "bg-primary" : "bg-destructive"}`} style={{ width: `${Math.max(4, Math.min(100, Math.abs(point.equity) / curveRange * 100))}%` }} /></div>
            <span className={`mono ${point.equity >= 0 ? "text-primary" : "text-destructive"}`}>{formatMoney(point.equity)}</span>
          </div>)}
        </div>
      </div>
    </div>
    <div className="panel table-wrap mt-5">
      <div className="p-6 pb-3"><div className="eyebrow">By strategy version</div><p className="text-xs text-muted-foreground mt-2">Closed journal performance remains tied to the exact version used.</p></div>
      <table><thead><tr><th>Strategy</th><th>Version</th><th>Trades</th><th>Win rate</th><th>Net P&L</th></tr></thead><tbody>
        {p.byStrategyVersion.map(version => <tr key={version.strategyVersionId}><td className="font-semibold">{version.strategyName}</td><td>v{version.versionNumber}</td><td>{version.tradeCount}</td><td>{version.winRate == null ? "—" : `${version.winRate}%`}</td><td className="mono">{formatMoney(version.netPnl)}</td></tr>)}
      </tbody></table>
    </div>
  </Page>;
}

function Alerts() {
  const q = useListAlerts();
  const markets = useListMarkets();
  const c = useCreateAlert();
  const u = useUpdateAlert();
  const del = useDeleteAlert();
  const qc = useQueryClient();
  const [modal, setModal] = useState<Alert | null | false>(false);
  const [confirm, setConfirm] = useState<Alert | null>(null);
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getListAlertsQueryKey() });
    qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
  };
  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const data: any = {
      name: String(form.get("name")),
      marketId: form.get("marketId") ? Number(form.get("marketId")) : null,
      condition: String(form.get("condition")),
      threshold: String(form.get("threshold") || "") || null,
      status: String(form.get("status") || "active") as "active" | "paused",
    };
    const done = () => { invalidate(); setModal(false); };
    modal && typeof modal === "object"
      ? u.mutate({ alertId: modal.id, data }, { onSuccess: done })
      : c.mutate({ data }, { onSuccess: done });
  };
  return <Page eyebrow="Review" title="Alerts" description="Manual reminders and durable monitoring events. No external delivery or trade execution is performed." action={<button className="btn btn-primary" onClick={() => setModal(null)} data-testid="button-create-alert"><Plus size={15} /> New alert</button>}>
    {q.isLoading ? <LoadingBlock /> : q.isError ? <ErrorState retry={() => q.refetch()} /> : q.data?.length ? <div className="panel table-wrap"><table><thead><tr><th>Alert</th><th>Market</th><th>Rule</th><th>Status</th><th /></tr></thead><tbody>
      {q.data.map((alert: Alert) => <tr key={alert.id} data-testid={`row-alert-${alert.id}`}>
        <td><div className="font-semibold">{alert.name}</div><div className="text-[11px] text-muted-foreground">{alert.sourceType === "monitoring" ? "Monitoring event" : "Manual reminder"}{alert.triggeredAt ? ` · ${new Date(alert.triggeredAt).toLocaleString()}` : ""}</div></td>
        <td className="mono">{alert.marketSymbol || "—"}</td>
        <td className="text-muted-foreground">{alert.message || alert.condition}{alert.threshold && ` · ${alert.threshold}`}</td>
        <td>{alert.sourceType === "monitoring" ? <button className={`tag tag-${alert.status}`} onClick={() => alert.status === "triggered" && u.mutate({ alertId: alert.id, data: { status: "acknowledged" } }, { onSuccess: invalidate })} disabled={alert.status === "acknowledged"} data-testid={`button-ack-alert-${alert.id}`}>{alert.status === "triggered" ? "Acknowledge" : alert.status}</button> : <button className={`tag tag-${alert.status}`} onClick={() => u.mutate({ alertId: alert.id, data: { status: alert.status === "active" ? "paused" : "active" } }, { onSuccess: invalidate })} data-testid={`button-toggle-alert-${alert.id}`}>{alert.status}</button>}</td>
        <td><div className="flex justify-end">{alert.sourceType === "manual" && <button className="btn btn-ghost" onClick={() => setModal(alert)} data-testid={`button-edit-alert-${alert.id}`}><Pencil size={13} /></button>}<button className="btn btn-ghost text-destructive" onClick={() => setConfirm(alert)} data-testid={`button-delete-alert-${alert.id}`}><Trash2 size={13} /></button></div></td>
      </tr>)}
    </tbody></table></div> : <EmptyState icon={Bell} title="No alerts yet" text="Create a manual reminder or start monitoring a strategy version to record meaningful monitoring events." action={<button className="btn btn-primary" onClick={() => setModal(null)} data-testid="button-empty-create-alert"><Plus size={14} /> Create alert</button>} />}
    {modal !== false && <Modal title={modal && typeof modal === "object" ? "Edit alert" : "New alert"} onClose={() => setModal(false)}><form onSubmit={save} className="space-y-4"><Field label="Name"><input className="input" name="name" required defaultValue={modal && typeof modal === "object" ? modal.name : ""} placeholder="Give the reminder a name" data-testid="input-alert-name" /></Field><Field label="Market"><select className="select" name="marketId" defaultValue={modal && typeof modal === "object" ? modal.marketId || "" : ""} data-testid="select-alert-market"><option value="">No market</option>{(markets.data || []).map((market: Market) => <option key={market.id} value={market.id}>{market.symbol}</option>)}</select></Field><div className="grid grid-cols-2 gap-3"><Field label="Condition"><input className="input" name="condition" required defaultValue={modal && typeof modal === "object" ? modal.condition : ""} placeholder="Review when…" data-testid="input-alert-condition" /></Field><Field label="Threshold"><input className="input" name="threshold" defaultValue={modal && typeof modal === "object" ? modal.threshold || "" : ""} placeholder="Optional" data-testid="input-alert-threshold" /></Field></div><Field label="Status"><select className="select" name="status" defaultValue={modal && typeof modal === "object" ? modal.status : "active"} data-testid="select-alert-status"><option value="active">Active</option><option value="paused">Paused</option></select></Field><button className="btn btn-primary w-full" disabled={c.isPending || u.isPending} data-testid="button-submit-alert">Save alert</button></form></Modal>}
    {confirm && <Confirm title={`Remove “${confirm.name}”?`} onCancel={() => setConfirm(null)} onConfirm={() => del.mutate({ alertId: confirm.id }, { onSuccess: () => { setConfirm(null); invalidate(); } })} busy={del.isPending} />}
  </Page>;
}

function SettingsPage() { const q=useGetSettings();const u=useUpdateSettings();const qc=useQueryClient();const [saved,setSaved]=useState(false);if(q.isLoading)return <Page eyebrow="Workspace" title="Settings"><LoadingBlock/></Page>;if(q.isError)return <Page eyebrow="Workspace" title="Settings"><ErrorState retry={()=>q.refetch()}/></Page>;const s=q.data;const save=(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();const f=new FormData(e.currentTarget);u.mutate({data:{timezone:String(f.get('timezone')),baseCurrency:String(f.get('baseCurrency')),defaultRiskUnit:String(f.get('defaultRiskUnit')) as 'percent'|'amount'|'r',compactMode:f.get('compactMode')==='on'}},{onSuccess:()=>{setSaved(true);qc.invalidateQueries({queryKey:getGetSettingsQueryKey()});setTimeout(()=>setSaved(false),2600)}})};return <Page eyebrow="Workspace" title="Settings" description="Small preferences that make the daily record feel like yours."><div className="max-w-2xl panel p-6 md:p-8"><form onSubmit={save} className="space-y-6"><div><div className="eyebrow">Locale</div><div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-5"><Field label="Timezone"><select className="select" name="timezone" defaultValue={s?.timezone||'UTC'} data-testid="select-settings-timezone"><option value="UTC">UTC</option><option value="America/New_York">America / New York</option><option value="America/Los_Angeles">America / Los Angeles</option><option value="Europe/London">Europe / London</option><option value="Asia/Tokyo">Asia / Tokyo</option></select></Field><Field label="Base currency"><select className="select" name="baseCurrency" defaultValue={s?.baseCurrency||'USD'} data-testid="select-settings-currency"><option value="USD">USD — US Dollar</option><option value="EUR">EUR — Euro</option><option value="GBP">GBP — Pound</option><option value="JPY">JPY — Yen</option></select></Field></div></div><div className="border-t border-border pt-6"><div className="eyebrow">Risk language</div><Field label="Default risk unit"><select className="select mt-5" name="defaultRiskUnit" defaultValue={s?.defaultRiskUnit||'percent'} data-testid="select-settings-risk"><option value="percent">Percent</option><option value="amount">Amount</option><option value="r">R multiple</option></select></Field></div><div className="border-t border-border pt-6 flex items-center justify-between gap-4"><div><div className="text-sm font-semibold">Compact mode</div><div className="text-xs text-muted-foreground mt-1">Tighten row spacing in dense records.</div></div><input type="checkbox" name="compactMode" defaultChecked={s?.compactMode} className="accent-[hsl(var(--primary))] w-4 h-4" data-testid="input-settings-compact"/></div><div className="flex items-center justify-end gap-4 pt-2"><span className="text-xs text-primary">{saved?'Preferences saved.':''}</span><button className="btn btn-primary" disabled={u.isPending} data-testid="button-save-settings">{u.isPending?'Saving…':'Save preferences'}</button></div></form></div></Page>; }

function formatDateInput(value: Date) {
  return value.toISOString().slice(0, 10);
}
function backtestErrorCopy(value: unknown) {
  const message = typeof value === "string" ? value : value instanceof Error ? value.message : "";
  if (/historical|insufficient|candle|provider data/i.test(message)) return "Historical data is not available for this market and timeframe during the selected period.";
  if (/unsupported|condition|entry rule|risk rule/i.test(message)) return "This strategy contains a condition that the current backtester cannot evaluate.";
  return "This backtest could not run. Check the selected setup and try again.";
}

function presetRange(preset: string) {
  const end = new Date();
  const days = preset === "last_30_days" ? 30 : preset === "last_90_days" ? 90 : 7;
  const start = new Date(end);
  start.setDate(start.getDate() - days);
  return { start: formatDateInput(start), end: formatDateInput(end) };
}

function Backtesting() {
  const strategies = useListStrategies();
  const markets = useListMarkets();
  const timeframes = useListTimeframes();
  const saved = useListBacktests();
  const create = useCreateBacktest();
  const params = new URLSearchParams(window.location.search);
  const requestedStrategyId = Number(params.get("strategyId")) || null;
  const requestedVersionId = Number(params.get("strategyVersionId")) || null;
  const requestedInstrumentId = Number(params.get("instrumentId")) || null;
  const requestedTimeframeId = Number(params.get("timeframeId")) || null;
  const initialRange = presetRange("last_7_days");
  const requestedStartDate = params.get("startDate") || "";
  const requestedEndDate = params.get("endDate") || "";
  const initialPreset = requestedStartDate && requestedEndDate ? "custom" : "last_7_days";
  const [strategyId, setStrategyId] = useState<number | null>(requestedStrategyId);
  const [versionId, setVersionId] = useState<number | null>(requestedVersionId);
  const [instrumentId, setInstrumentId] = useState<number | null>(requestedInstrumentId);
  const [timeframeId, setTimeframeId] = useState<number | null>(requestedTimeframeId);
  const [preset, setPreset] = useState(initialPreset);
  const [startDate, setStartDate] = useState(requestedStartDate || initialRange.start);
  const [endDate, setEndDate] = useState(requestedEndDate || initialRange.end);
  const [setupError, setSetupError] = useState("");
  const versions = useListStrategyVersions(strategyId ?? 0, {
    query: {
      enabled: strategyId != null,
      queryKey: getListStrategyVersionsQueryKey(strategyId ?? 0),
    },
  });
  const queryClient = useQueryClient();

  useEffect(() => {
    if (strategyId == null && strategies.data?.[0]) setStrategyId(strategies.data[0].id);
  }, [strategyId, strategies.data]);
  useEffect(() => {
    if (versionId == null && versions.data?.[0]) setVersionId(versions.data[0].id);
  }, [versionId, versions.data]);

  const selectPreset = (value: string) => {
    setPreset(value);
    if (value !== "custom") {
      const range = presetRange(value);
      setStartDate(range.start);
      setEndDate(range.end);
    }
  };
  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!strategyId || !versionId || !instrumentId || !timeframeId || !startDate || !endDate) {
      setSetupError("Select a strategy version, instrument, timeframe, and date range before running.");
      return;
    }
    if (startDate >= endDate) {
      setSetupError("Start date must be before end date.");
      return;
    }
    setSetupError("");
    create.mutate({
      data: {
        strategyId,
        strategyVersionId: versionId,
        instrumentId,
        timeframeId,
        preset: preset as "last_7_days" | "last_30_days" | "last_90_days" | "custom",
        startDate: new Date(`${startDate}T00:00:00.000Z`).toISOString(),
        endDate: new Date(`${endDate}T23:59:59.999Z`).toISOString(),
      },
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListBacktestsQueryKey() });
      },
    });
  };
  const chosenStrategy = strategies.data?.find(strategy => strategy.id === strategyId);
  const chosenVersion = versions.data?.find(version => version.id === versionId);
  const chosenInstrument = markets.data?.find(market => market.id === instrumentId);
  const chosenTimeframe = timeframes.data?.find(timeframe => timeframe.id === timeframeId);
  const periodLabel = preset === "custom" ? `${startDate || "Start"} – ${endDate || "End"}` : preset === "last_30_days" ? "Last 30 days" : preset === "last_90_days" ? "Last 90 days" : "Last 7 days";

  return <Page eyebrow="Utilities" title="Backtesting" description="Run a historical review from your saved strategy versions using genuine provider candles.">
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-5">
      <form className="panel p-6 md:p-8 space-y-6" onSubmit={save}>
        <div>
          <div className="eyebrow">Setup</div>
          <h2 className="display text-2xl font-bold mt-2">Choose what to review</h2>
            <p className="text-sm text-muted-foreground mt-2">Select an exact strategy version and the normalized market data series it should use.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Strategy">
            <select className="select" value={strategyId ?? ""} onChange={event => { setStrategyId(event.target.value ? Number(event.target.value) : null); setVersionId(null); }} required data-testid="select-backtest-strategy">
              <option value="">Select a strategy</option>
              {(strategies.data || []).map(strategy => <option key={strategy.id} value={strategy.id}>{strategy.name}</option>)}
            </select>
          </Field>
          <Field label="Exact strategy version">
            <select className="select" value={versionId ?? ""} onChange={event => setVersionId(event.target.value ? Number(event.target.value) : null)} disabled={!strategyId || versions.isLoading} required data-testid="select-backtest-version">
              <option value="">{versions.isLoading ? "Loading versions…" : "Select a version"}</option>
              {(versions.data || []).map(version => <option key={version.id} value={version.id}>v{version.versionNumber}{version.label ? ` · ${version.label}` : ""}</option>)}
            </select>
             {chosenVersion && <p className="text-xs text-muted-foreground mt-2">This run stays tied to v{chosenVersion.versionNumber}; newer versions will not replace it.</p>}
          </Field>
          <Field label="Instrument">
            <select className="select" value={instrumentId ?? ""} onChange={event => setInstrumentId(event.target.value ? Number(event.target.value) : null)} required data-testid="select-backtest-instrument">
              <option value="">Select an instrument</option>
              {(markets.data || []).filter(market => market.isActive).map(market => <option key={market.id} value={market.id}>{market.symbol}{market.displayName ? ` · ${market.displayName}` : ""}</option>)}
            </select>
          </Field>
          <Field label="Timeframe">
            <select className="select" value={timeframeId ?? ""} onChange={event => setTimeframeId(event.target.value ? Number(event.target.value) : null)} required data-testid="select-backtest-timeframe">
              <option value="">Select a timeframe</option>
              {(timeframes.data || []).filter(timeframe => timeframe.isActive).map(timeframe => <option key={timeframe.id} value={timeframe.id}>{timeframe.label}</option>)}
            </select>
          </Field>
        </div>
        <div>
          <div className="label">Date range</div>
          <div className="flex flex-wrap gap-2 mt-2">
            {[["last_7_days", "Last 7 Days"], ["last_30_days", "Last 30 Days"], ["last_90_days", "Last 90 Days"], ["custom", "Custom"]].map(([value, label]) => <button type="button" key={value} className={`btn ${preset === value ? "btn-primary" : "btn-secondary"}`} onClick={() => selectPreset(value)} data-testid={`button-backtest-preset-${value}`}>{label}</button>)}
          </div>
        </div>
         {preset === "custom" && <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
           <Field label="Start date"><input className="input" type="date" value={startDate} onChange={event => { setStartDate(event.target.value); setSetupError(""); }} required data-testid="input-backtest-start-date" /></Field>
           <Field label="End date"><input className="input" type="date" value={endDate} onChange={event => { setEndDate(event.target.value); setSetupError(""); }} required data-testid="input-backtest-end-date" /></Field>
        </div>}
         {setupError && <p className="text-sm text-destructive" data-testid="backtest-setup-error">{setupError}</p>}
         <section className="rounded-lg border border-primary/25 bg-primary/5 p-4 md:p-5" data-testid="backtest-setup-confirmation">
           <div className="eyebrow text-primary">Review before running</div>
           <h3 className="font-semibold mt-2">Confirm this backtest setup</h3>
           <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-4">
             {[["Strategy", chosenStrategy?.name || "Not selected"], ["Version", chosenVersion ? `v${chosenVersion.versionNumber}` : "Not selected"], ["Instrument", chosenInstrument?.symbol || "Not selected"], ["Timeframe", chosenTimeframe?.label || "Not selected"], ["Period", periodLabel]].map(([label, value]) => <div key={label}><div className="eyebrow">{label}</div><div className="text-xs font-semibold mt-2 break-words">{value}</div></div>)}
           </div>
           <p className="text-[11px] text-muted-foreground mt-4">Nothing runs until you choose Run Backtest. The selected strategy version will remain fixed for this run.</p>
         </section>
        <div className="flex items-center justify-between gap-4 border-t border-border pt-5">
          <p className="text-xs text-muted-foreground">The server evaluates completed candles chronologically and saves simulated trades separately from the journal.</p>
          <button className="btn btn-primary whitespace-nowrap" type="submit" disabled={create.isPending || strategies.isLoading || markets.isLoading || timeframes.isLoading}>{create.isPending ? "Saving…" : "Run Backtest"}</button>
        </div>
        {create.isSuccess && create.data?.status === "completed" && <p className="text-sm text-primary">Backtest completed: {create.data.candlesProcessed} candles processed and {create.data.tradeCount} simulated trades saved. {create.data.resultMessage}</p>}
        {create.isSuccess && create.data?.status === "failed" && <p className="text-sm text-destructive">Backtest failed: {backtestErrorCopy(create.data.errorMessage)}</p>}
         {create.isError && <p className="text-sm text-destructive">{backtestErrorCopy(create.error)}</p>}
      </form>
      <div className="space-y-5">
        <div className="panel p-6">
          <div className="eyebrow">Saved setups</div>
          {saved.isLoading ? <LoadingBlock /> : saved.data?.length ? <div className="mt-4 space-y-3">{saved.data.slice(0, 5).map((backtest: Backtest) => <div className="rounded-md bg-secondary/60 p-3" key={backtest.id} data-testid={`row-backtest-${backtest.id}`}><div className="flex items-center justify-between gap-3"><span className="font-semibold text-sm">{backtest.strategyName} · v{backtest.versionNumber}</span><span className={`tag ${backtest.status === "completed" ? "tag-active" : backtest.status === "failed" ? "tag-archived" : "tag-draft"}`}>{backtest.status}</span></div><div className="text-xs text-muted-foreground mt-2">{backtest.instrumentSymbol} · {backtest.timeframeLabel}</div><div className="text-xs text-muted-foreground mt-1">{formatDate(backtest.startDate)} – {formatDate(backtest.endDate)}</div><div className="text-xs text-muted-foreground mt-1">{backtest.candlesProcessed} candles · {backtest.tradeCount} simulated trades</div>{backtest.status === "completed" && backtest.tradeCount > 0 && <div className="text-xs text-muted-foreground mt-1">{backtest.winRate === null ? "—" : `${backtest.winRate.toFixed(1)}%`} win rate · {formatMoney(backtest.totalPnl)} total P/L</div>}{backtest.status === "failed" && backtest.errorMessage && <div className="text-xs text-destructive mt-2">{backtest.errorMessage}</div>}{backtest.status === "completed" && backtest.resultMessage && <div className="text-xs text-muted-foreground mt-2">{backtest.resultMessage}</div>}<Link href={`/backtesting/${backtest.id}`} className="text-xs text-primary inline-flex items-center gap-1 mt-3 hover:underline" data-testid={`link-view-backtest-${backtest.id}`}>Review result <ChevronRight size={13}/></Link></div>)}</div> : <p className="text-sm text-muted-foreground mt-4">No backtests run yet.</p>}
        </div>
         <div className="panel p-6">
          <div className="eyebrow">What happens next</div>
           <p className="text-sm text-muted-foreground leading-relaxed mt-4">This run stays tied to your immutable strategy version and selected instrument. Historical candles and simulated trades are saved separately from the journal; completed runs can be reviewed in Results and Performance.</p>
        </div>
      </div>
    </div>
  </Page>;
}

function StrategyBuilderRoute() { return <StrategyBuilder/>; }
function BacktestResultsRoute() {
  const params = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const backtestId = Number(params.id);
  return <div className="page-wrap"><BacktestResultsPanel
    backtestId={backtestId}
    onBack={() => setLocation("/backtesting")}
    onViewStrategy={(strategyId, strategyVersionId) => setLocation(`/strategy-builder?strategyId=${strategyId}&versionId=${strategyVersionId}`)}
    onRunAgain={backtest => setLocation(`/backtesting?strategyId=${backtest.strategyId}&strategyVersionId=${backtest.strategyVersionId}&instrumentId=${backtest.instrumentId}&timeframeId=${backtest.timeframeId}&startDate=${formatDateInput(new Date(backtest.startDate))}&endDate=${formatDateInput(new Date(backtest.endDate))}`)}
  /></div>;
}
function Router() { return <ErrorBoundary><Shell><Switch><Route path="/" component={Dashboard}/><Route path="/strategy-builder" component={StrategyBuilderRoute}/><Route path="/strategy-library" component={StrategyLibrary}/><Route path="/market-monitor" component={MarketMonitor}/><Route path="/trade-journal" component={Journal}/><Route path="/performance" component={Performance}/><Route path="/strategy-monitoring" component={StrategyMonitoringPage}/><Route path="/alerts" component={Alerts}/><Route path="/news" component={EconomicCalendar}/><Route path="/settings" component={SettingsPage}/><Route path="/backtesting/:id" component={BacktestResultsRoute}/><Route path="/backtesting" component={Backtesting}/><Route component={NotFound}/></Switch></Shell></ErrorBoundary>; }
export default function App() { return <QueryClientProvider client={queryClient}><TooltipProvider><Router/><Toaster/></TooltipProvider></QueryClientProvider>; }