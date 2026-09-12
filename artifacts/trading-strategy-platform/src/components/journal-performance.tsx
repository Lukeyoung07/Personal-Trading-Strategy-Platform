import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Filter, LineChart, Save, SlidersHorizontal, Target, TrendingDown, TrendingUp } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetJournalPerformanceQueryKey,
  getListStrategyVersionsQueryKey,
  useGetJournalPerformance,
  useGetSettings,
  useListStrategyVersions,
  useUpdateJournalDayNote,
  type GetJournalPerformanceParams,
  type JournalDay,
  type JournalPerformance,
  type PerformanceVersion,
  type Strategy,
  type Trade,
} from "@workspace/api-client-react";
import { useCurrency } from "@/lib/currency";

type FilterState = {
  strategyId: string;
  strategyVersionId: string;
  marketId: string;
  side: "" | "long" | "short";
  from: string;
  to: string;
};

const emptyFilters: FilterState = { strategyId: "", strategyVersionId: "", marketId: "", side: "", from: "", to: "" };

function monthLabel(month: string) {
  return new Date(`${month}-01T12:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function dayLabel(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

function monthFromDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function shiftMonth(month: string, amount: number) {
  const date = new Date(`${month}-01T12:00:00`);
  date.setMonth(date.getMonth() + amount);
  return monthFromDate(date);
}

function toneForPnl(pnl: number) {
  return pnl > 0 ? "journal-positive" : pnl < 0 ? "journal-negative" : "journal-zero";
}

function tradeDateKey(trade: Trade, timeZone: string) {
  const timestamp = new Date(trade.closedAt || trade.createdAt);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(timestamp);
  const year = parts.find(part => part.type === "year")?.value;
  const month = parts.find(part => part.type === "month")?.value;
  const day = parts.find(part => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : timestamp.toISOString().slice(0, 10);
}

function Metric({ label, value, detail, tone = "" }: { label: string; value: string; detail?: string; tone?: string }) {
  return <div className="panel p-4 md:p-5 journal-metric">
    <div className="eyebrow">{label}</div>
    <div className={`metric-value mt-3 ${tone}`}>{value}</div>
    {detail && <div className="text-[11px] text-muted-foreground mt-2">{detail}</div>}
  </div>;
}

function FilterBar({
  filters,
  setFilters,
  strategies,
  versions,
  markets,
}: {
  filters: FilterState;
  setFilters: (next: FilterState) => void;
  strategies: Strategy[];
  versions: { id: number; versionNumber: number; label?: string | null }[];
  markets: { id: number; symbol: string }[];
}) {
  const set = (key: keyof FilterState, value: string) => setFilters({ ...filters, [key]: value, ...(key === "strategyId" ? { strategyVersionId: "" } : {}) });
  return <details className="panel journal-filters">
    <summary><Filter size={14} /> Refine this review <span className="text-[10px] text-muted-foreground ml-auto">Optional</span></summary>
    <div className="journal-filter-grid border-t border-border p-4 md:p-5">
      <label><span className="label">Strategy</span><select className="select" value={filters.strategyId} onChange={event => set("strategyId", event.target.value)}><option value="">All strategies</option>{strategies.map(strategy => <option key={strategy.id} value={strategy.id}>{strategy.name}</option>)}</select></label>
      <label><span className="label">Exact version</span><select className="select" value={filters.strategyVersionId} onChange={event => set("strategyVersionId", event.target.value)} disabled={!filters.strategyId}><option value="">{filters.strategyId ? "All versions" : "Choose a strategy first"}</option>{versions.map(version => <option key={version.id} value={version.id}>v{version.versionNumber}{version.label ? ` · ${version.label}` : ""}</option>)}</select></label>
      <label><span className="label">Instrument</span><select className="select" value={filters.marketId} onChange={event => set("marketId", event.target.value)}><option value="">All instruments</option>{markets.map(market => <option key={market.id} value={market.id}>{market.symbol}</option>)}</select></label>
      <label><span className="label">Direction</span><select className="select" value={filters.side} onChange={event => set("side", event.target.value as FilterState["side"])}><option value="">Long and short</option><option value="long">Long only</option><option value="short">Short only</option></select></label>
      <label><span className="label">From</span><input className="input" type="date" value={filters.from} onChange={event => set("from", event.target.value)} /></label>
      <label><span className="label">To</span><input className="input" type="date" value={filters.to} onChange={event => set("to", event.target.value)} /></label>
      <button className="btn btn-ghost justify-self-start self-end" type="button" onClick={() => setFilters(emptyFilters)}><SlidersHorizontal size={14} /> Clear filters</button>
    </div>
  </details>;
}

function Calendar({
  month,
  daily,
  selectedDate,
  onSelect,
}: {
  month: string;
  daily: JournalDay[];
  selectedDate: string | null;
  onSelect: (date: string) => void;
}) {
  const { formatMoney } = useCurrency();
  const signedMoney = (value?: number | null) => value == null ? "—" : `${value > 0 ? "+" : ""}${formatMoney(value)}`;
  const cells = useMemo(() => {
    const first = new Date(`${month}-01T12:00:00`);
    const count = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    const leading = first.getDay();
    return [...Array(leading).fill(null), ...Array.from({ length: count }, (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`)];
  }, [month]);
  const byDate = useMemo(() => new Map(daily.map(day => [day.date, day])), [daily]);
  return <div className="journal-calendar">
    {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(day => <div className="journal-weekday" key={day}>{day}</div>)}
    {cells.map((date, index) => {
      if (!date) return <div className="journal-day journal-day-empty" key={`empty-${index}`} aria-hidden="true" />;
      const day = byDate.get(date);
      const pnl = day?.pnl ?? 0;
      const isFuture = new Date(`${date}T23:59:59`) > new Date();
      return <button type="button" key={date} disabled={!day} onClick={() => onSelect(date)} className={`journal-day ${day ? toneForPnl(pnl) : "journal-day-quiet"} ${isFuture ? "journal-day-future" : ""} ${selectedDate === date ? "journal-day-selected" : ""}`} aria-label={`${dayLabel(date)}${day ? `, ${formatMoney(pnl)}` : ", no realized trades"}`}>
        <span className="mono text-[11px]">{Number(date.slice(-2))}</span>
        {day && <><span className="journal-day-pnl">{signedMoney(pnl)}</span><span className="text-[10px] text-muted-foreground">{day.tradeCount} {day.tradeCount === 1 ? "trade" : "trades"}</span></>}
      </button>;
    })}
  </div>;
}

function CumulativeChart({ points }: { points: { date: string; cumulativePnl: number }[] }) {
  if (!points.length) return <div className="h-52 flex items-center justify-center text-sm text-muted-foreground border border-dashed border-border rounded-md">Cumulative curve will appear after realized trades are recorded.</div>;
  const values = points.map(point => point.cumulativePnl);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const range = max - min || 1;
  const coords = points.map((point, index) => `${(index / Math.max(points.length - 1, 1)) * 100},${100 - ((point.cumulativePnl - min) / range) * 88 - 6}`).join(" ");
  const zeroY = 100 - ((0 - min) / range) * 88 - 6;
  return <div className="journal-chart-wrap">
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="journal-chart" role="img" aria-label="Cumulative monthly realized P/L">
      <line x1="0" x2="100" y1={zeroY} y2={zeroY} className="journal-chart-zero" />
      <polyline points={coords} className="journal-chart-line" />
      {points.map((point, index) => <circle key={`${point.date}-${index}`} cx={(index / Math.max(points.length - 1, 1)) * 100} cy={100 - ((point.cumulativePnl - min) / range) * 88 - 6} r="1.2" className="journal-chart-point" />)}
    </svg>
    <div className="flex justify-between text-[10px] mono text-muted-foreground mt-2"><span>{points[0].date}</span><span>{points[points.length - 1].date}</span></div>
  </div>;
}

function DayDetail({ day, trades, onClose, onSaved }: { day: JournalDay; trades: Trade[]; onClose: () => void; onSaved: () => void }) {
  const { formatMoney } = useCurrency();
  const signedMoney = (value?: number | null) => value == null ? "—" : `${value > 0 ? "+" : ""}${formatMoney(value)}`;
  const [note, setNote] = useState(day.note || "");
  const saveNote = useUpdateJournalDayNote();
  const queryClient = useQueryClient();
  const save = () => saveNote.mutate({ date: day.date, data: { notes: note.trim() || null } }, {
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getGetJournalPerformanceQueryKey() });
      onSaved();
    },
  });
  return <div className="panel p-5 md:p-6 rise">
    <div className="flex items-start justify-between gap-4"><div><div className="eyebrow">Selected day</div><h2 className="font-semibold text-lg mt-2">{dayLabel(day.date)}</h2></div><button type="button" className="btn btn-ghost" onClick={onClose}>Close</button></div>
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
      <div><div className="label">Net P/L</div><div className={`mono text-sm font-semibold ${toneForPnl(day.pnl)}`}>{signedMoney(day.pnl)}</div></div>
      <div><div className="label">Trades</div><div className="mono text-sm">{day.tradeCount}</div></div>
      <div><div className="label">Win rate</div><div className="mono text-sm">{day.winRate == null ? "—" : `${day.winRate.toFixed(1)}%`}</div></div>
      <div><div className="label">Best / worst</div><div className="mono text-sm">{formatMoney(day.bestTrade)} / {formatMoney(day.worstTrade)}</div></div>
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4 text-xs text-muted-foreground"><div>Winning trades <span className="text-foreground ml-1">{day.winningTrades}</span> · losing <span className="text-foreground ml-1">{day.losingTrades}</span></div><div>Average winner <span className="text-primary ml-1">{formatMoney(day.averageWinner)}</span> · loser <span className="text-destructive ml-1">{formatMoney(day.averageLoser)}</span></div></div>
    <div className="border-t border-border mt-5 pt-5"><div className="eyebrow">Trades on this day</div>{trades.length ? <div className="mt-3 divide-y divide-border rounded-md border border-border overflow-hidden">{trades.map(trade => <div key={trade.id} className="flex items-center gap-3 px-3 py-3 text-xs"><div className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 ${trade.side === "long" ? "bg-primary/10 text-primary" : "bg-accent/10 text-accent"}`}>{trade.side === "long" ? <TrendingUp size={13} /> : <TrendingDown size={13} />}</div><div className="min-w-0 flex-1"><div className="font-semibold truncate">{trade.marketSymbol || "Unassigned market"} · {trade.side}</div><div className="text-[11px] text-muted-foreground mt-1">{trade.strategyName || "Unknown strategy"} · v{trade.strategyVersionNumber ?? "—"} · {trade.closedAt ? new Date(trade.closedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : "Created date fallback"}</div></div><span className={`mono font-semibold ${toneForPnl(trade.pnl || 0)}`}>{signedMoney(trade.pnl)}</span></div>)}</div> : <p className="text-xs text-muted-foreground mt-3">No realized trades match the active filters on this date.</p>}</div>
    <div className="border-t border-border mt-5 pt-5"><label className="label" htmlFor="journal-day-note">Day note</label><textarea id="journal-day-note" className="textarea" maxLength={2000} value={note} onChange={event => setNote(event.target.value)} placeholder="What did you notice about this day?" /><div className="flex items-center justify-between mt-3"><span className="text-[11px] text-muted-foreground">{note.length}/2000 · Separate from individual trade notes.</span><button type="button" className="btn btn-primary" onClick={save} disabled={saveNote.isPending}><Save size={14} /> {saveNote.isPending ? "Saving…" : "Save day note"}</button></div>{saveNote.isError && <div className="text-xs text-destructive mt-3">The note could not be saved. Try again.</div>}</div>
  </div>;
}

function VersionTable({ versions }: { versions: PerformanceVersion[] }) {
  const { formatMoney } = useCurrency();
  const signedMoney = (value?: number | null) => value == null ? "—" : `${value > 0 ? "+" : ""}${formatMoney(value)}`;
  return <div className="panel overflow-hidden"><div className="p-5 md:p-6 border-b border-border"><div className="eyebrow">Attribution</div><h2 className="font-semibold mt-2">Exact strategy-version performance</h2><p className="text-xs text-muted-foreground mt-2">Historical trades stay attached to the saved version used at entry.</p></div>{versions.length ? <div className="table-wrap"><table><thead><tr><th>Strategy / version</th><th>Trades</th><th>Win rate</th><th>Net P/L</th></tr></thead><tbody>{versions.map(version => <tr key={version.strategyVersionId}><td><div className="font-semibold">{version.strategyName}</div><div className="mono text-[11px] text-muted-foreground mt-1">v{version.versionNumber}</div></td><td className="mono">{version.tradeCount}<span className="text-muted-foreground ml-2 text-[10px]">{version.winningTrades}W / {version.losingTrades}L</span></td><td className="mono">{version.winRate == null ? "—" : `${version.winRate.toFixed(1)}%`}</td><td className={`mono font-semibold ${toneForPnl(version.netPnl || 0)}`}>{signedMoney(version.netPnl)}</td></tr>)}</tbody></table></div> : <div className="p-8 text-sm text-muted-foreground">No exact strategy-version attribution for this review.</div>}</div>;
}

export function JournalPerformance({
  month,
  setMonth,
  strategies,
  markets,
  trades,
}: {
  month: string;
  setMonth: (month: string) => void;
  strategies: Strategy[];
  markets: { id: number; symbol: string }[];
  trades: Trade[];
}) {
  const { formatMoney } = useCurrency();
  const signedMoney = (value?: number | null) => value == null ? "—" : `${value > 0 ? "+" : ""}${formatMoney(value)}`;
  const [filters, setFilters] = useState<FilterState>(emptyFilters);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const strategyId = Number(filters.strategyId) || undefined;
  const versionsQuery = useListStrategyVersions(strategyId || 0, { query: { enabled: !!strategyId, queryKey: getListStrategyVersionsQueryKey(strategyId || 0) } });
  const settings = useGetSettings();
  const settingsReady = settings.isSuccess || settings.isError;
  const params = useMemo<GetJournalPerformanceParams>(() => ({
    month,
    strategyId,
    strategyVersionId: Number(filters.strategyVersionId) || undefined,
    marketId: Number(filters.marketId) || undefined,
    side: filters.side || undefined,
    from: filters.from || undefined,
    to: filters.to || undefined,
    timezone: settings.data?.timezone || "UTC",
  }), [filters, month, settings.data?.timezone, strategyId]);
  const performance = useGetJournalPerformance(params, { query: { enabled: settingsReady, queryKey: getGetJournalPerformanceQueryKey(params) } });
  const data = performance.data as JournalPerformance | undefined;
  const selectedDay = data?.daily.find(day => day.date === selectedDate) || null;
  const selectedDayTrades = useMemo(() => {
    if (!selectedDay) return [];
    return trades
      .filter(trade => trade.status === "closed" && trade.pnl != null)
      .filter(trade => strategyId == null || trade.strategyId === strategyId)
      .filter(trade => !filters.strategyVersionId || trade.strategyVersionId === Number(filters.strategyVersionId))
      .filter(trade => !filters.marketId || trade.marketId === Number(filters.marketId))
      .filter(trade => !filters.side || trade.side === filters.side)
      .filter(trade => tradeDateKey(trade, params.timezone || "UTC") === selectedDay.date)
      .sort((a, b) => new Date(a.closedAt || a.createdAt).getTime() - new Date(b.closedAt || b.createdAt).getTime());
  }, [filters.marketId, filters.side, filters.strategyVersionId, params.timezone, selectedDay, strategyId, trades]);

  useEffect(() => {
    if (!data?.daily.length) {
      setSelectedDate(null);
      return;
    }
    if (!selectedDate || !data.daily.some(day => day.date === selectedDate)) setSelectedDate(data.daily[data.daily.length - 1].date);
  }, [data, selectedDate]);

  return <section className="journal-performance" aria-label="Daily and monthly performance">
    <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-5 mb-5">
      <div><div className="eyebrow mb-3">Daily review</div><h2 className="display text-2xl md:text-3xl font-bold">What actually happened</h2><p className="text-sm text-muted-foreground mt-2 max-w-xl">Realized trades only. Read the month without turning the record into a prediction.</p></div>
       <div className="flex items-center gap-2 self-start lg:self-auto"><button className="btn btn-secondary" type="button" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month"><ChevronLeft size={15} /></button><div className="journal-month-label"><CalendarDays size={15} />{monthLabel(month)}</div><button className="btn btn-secondary" type="button" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month"><ChevronRight size={15} /></button><button className="btn btn-ghost text-xs" type="button" onClick={() => setMonth(monthFromDate(new Date()))}>Current</button></div>
    </div>
    <FilterBar filters={filters} setFilters={setFilters} strategies={strategies} versions={versionsQuery.data || []} markets={markets} />
    {performance.isError ? <div className="panel p-8 mt-5 text-center"><p className="text-sm text-muted-foreground">This performance review could not be loaded.</p><button type="button" className="btn btn-secondary mt-4" onClick={() => performance.refetch()}>Try again</button></div> : performance.isLoading ? <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-5">{[1, 2, 3, 4].map(index => <div className="panel p-5" key={index}><div className="skeleton h-3 w-20" /><div className="skeleton h-8 w-28 mt-4" /></div>)}</div> : <div className="mt-5 space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Metric label="Monthly realized P/L" value={signedMoney(data?.netPnl)} detail={`${data?.tradeCount || 0} realized ${(data?.tradeCount || 0) === 1 ? "trade" : "trades"}`} tone={data?.netPnl == null ? "" : toneForPnl(data.netPnl)} />
        <Metric label="Win rate" value={data?.winRate == null ? "—" : `${data.winRate.toFixed(1)}%`} detail={`${data?.winningTrades || 0} wins · ${data?.losingTrades || 0} losses`} />
        <Metric label="Average trading day" value={signedMoney(data?.averageTradingDay)} detail="Across days with realized trades" tone={data?.averageTradingDay == null ? "" : toneForPnl(data.averageTradingDay)} />
        <Metric label="Current streak" value={data?.currentStreak?.length ? `${data.currentStreak.length} ${data.currentStreak.type}` : "None"} detail={`${data?.bestWinningStreak || 0} best wins · ${data?.bestLosingStreak || 0} best losses`} />
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-[1.25fr_.75fr] gap-5">
        <div className="panel p-5 md:p-6"><div className="flex items-start justify-between gap-4 mb-5"><div><div className="eyebrow">Month at a glance</div><h2 className="font-semibold mt-2">Realized trading days</h2></div><span className="text-[11px] text-muted-foreground">{data?.dateField === "closedAt" ? "Using closed date" : "Using closed date, then created date when missing"}</span></div><Calendar month={month} daily={data?.daily || []} selectedDate={selectedDate} onSelect={setSelectedDate} /></div>
        <div className="panel p-5 md:p-6"><div className="eyebrow">Day extremes</div><div className="mt-5 space-y-4"><div className="journal-extreme"><div className="journal-extreme-icon journal-positive"><TrendingUp size={16} /></div><div><div className="label">Best trading day</div><div className="font-semibold mt-1">{data?.bestDay ? dayLabel(data.bestDay.date) : "—"}</div><div className="mono text-sm journal-positive mt-1">{signedMoney(data?.bestDay?.pnl)}</div></div></div><div className="journal-extreme"><div className="journal-extreme-icon journal-negative"><TrendingDown size={16} /></div><div><div className="label">Worst trading day</div><div className="font-semibold mt-1">{data?.worstDay ? dayLabel(data.worstDay.date) : "—"}</div><div className="mono text-sm journal-negative mt-1">{signedMoney(data?.worstDay?.pnl)}</div></div></div></div><div className="border-t border-border mt-6 pt-5 text-xs text-muted-foreground leading-relaxed">A trading day is counted only when the selected date field has realized trade data.</div></div>
      </div>
      {selectedDay && <DayDetail day={selectedDay} trades={selectedDayTrades} onClose={() => setSelectedDate(null)} onSaved={() => undefined} />}
      {!data?.hasData && <div className="panel empty-grid p-9 md:p-12 text-center"><Target size={21} className="text-primary mx-auto" /><h3 className="font-semibold text-lg mt-4">No realized trades in this view</h3><p className="text-sm text-muted-foreground max-w-md mx-auto mt-2">Future and empty days remain quiet until a trade is closed and recorded. This review never fills gaps with estimates.</p></div>}
      <div className="panel p-5 md:p-6"><div className="flex items-center gap-2 mb-5"><LineChart size={16} className="text-primary" /><div><div className="eyebrow">Cumulative curve</div><h2 className="font-semibold mt-2">Monthly realized P/L</h2></div></div><CumulativeChart points={data?.cumulative || []} /></div>
      <VersionTable versions={data?.byStrategyVersion || []} />
    </div>}
  </section>;
}