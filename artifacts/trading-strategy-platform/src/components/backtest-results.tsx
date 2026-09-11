import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowLeft,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Crosshair,
  Database,
  ExternalLink,
  Info,
  LineChart,
  RotateCcw,
  Target,
} from "lucide-react";
import {
  getGetBacktestResultsQueryKey,
  useGetBacktestResults,
  type BacktestCandle,
  type BacktestResults,
  type BacktestStatistics,
  type BacktestTrade,
} from "@workspace/api-client-react";

type BacktestResultsPanelProps = {
  backtestId: number;
  onBack: () => void;
  onViewStrategy?: (strategyId: number, strategyVersionId: number) => void;
  onRunAgain?: (backtest: BacktestResults["backtest"]) => void;
};

const money = (value: number | null | undefined) => {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${value < 0 ? "−" : ""}$${Math.abs(value).toFixed(2)}`;
};

const number = (value: number | null | undefined, digits = 2) => {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toFixed(digits);
};

const dateTime = (value: string | null | undefined) => {
  if (!value) return "—";
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const dateOnly = (value: string | null | undefined) => {
  if (!value) return "—";
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

const shortDate = (value: string | null | undefined) => {
  if (!value) return "";
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

const valueClass = (value: number | null | undefined) => {
  if (value === null || value === undefined || value === 0) return "text-foreground";
  return value > 0 ? "text-primary" : "text-destructive";
};

function LoadingResults() {
  return (
    <div className="space-y-5" data-testid="backtest-results-loading">
      <div className="flex items-center gap-3">
        <div className="skeleton h-9 w-24" />
        <div className="space-y-2">
          <div className="skeleton h-3 w-28" />
          <div className="skeleton h-7 w-72 max-w-[70vw]" />
        </div>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {Array.from({ length: 5 }).map((_, index) => (
          <div className="panel p-5" key={index}>
            <div className="skeleton h-3 w-20 mb-5" />
            <div className="skeleton h-6 w-28" />
          </div>
        ))}
      </div>
      <div className="panel p-6">
        <div className="skeleton h-3 w-24 mb-5" />
        <div className="skeleton h-72 w-full" />
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  detail,
  positive,
}: {
  label: string;
  value: string;
  detail?: string;
  positive?: boolean;
}) {
  return (
    <div className="panel p-4 md:p-5" data-testid={`stat-${label.toLowerCase().replaceAll(" ", "-")}`}>
      <div className="eyebrow">{label}</div>
      <div className={`metric-value mt-3 ${positive === true ? "text-primary" : positive === false ? "text-destructive" : ""}`}>{value}</div>
      {detail && <div className="text-[11px] text-muted-foreground mt-2">{detail}</div>}
    </div>
  );
}

function SectionHeading({
  eyebrow,
  title,
  icon: Icon,
  detail,
}: {
  eyebrow: string;
  title: string;
  icon: typeof LineChart;
  detail?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 mb-5">
      <div>
        <div className="eyebrow flex items-center gap-2"><Icon size={13} /> {eyebrow}</div>
        <h2 className="display text-xl md:text-2xl font-bold mt-2">{title}</h2>
      </div>
      {detail && <div className="text-[11px] text-muted-foreground text-right max-w-[240px] leading-relaxed">{detail}</div>}
    </div>
  );
}

function backtestStatusLabel(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function EquityCurve({
  statistics,
  selectedTradeId,
}: {
  statistics: BacktestStatistics;
  selectedTradeId: number | null;
}) {
  const points = statistics.equityCurve;
  const width = 900;
  const height = 285;
  const padding = { top: 22, right: 20, bottom: 34, left: 56 };
  const values = points.map((point) => point.equity);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const range = max - min || 1;
  const x = (index: number) => padding.left + (index / Math.max(points.length - 1, 1)) * (width - padding.left - padding.right);
  const y = (value: number) => padding.top + ((max - value) / range) * (height - padding.top - padding.bottom);
  const path = points.map((point, index) => `${index === 0 ? "M" : "L"} ${x(index).toFixed(2)} ${y(point.equity).toFixed(2)}`).join(" ");
  const baseline = y(0);
  const horizontalGuides = [0, 0.5, 1].map((fraction) => min + range * fraction);

  return (
    <div className="rounded-lg border border-border bg-background/45 p-3 md:p-4" data-testid="chart-equity-curve">
      <div className="flex items-center justify-between px-2 pb-2">
        <div className="text-xs text-muted-foreground">Cumulative P/L</div>
        <div className="mono text-[10px] text-muted-foreground">equity, server result</div>
      </div>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full min-w-[620px] h-[240px]" role="img" aria-label="Cumulative profit and loss equity curve">
          {horizontalGuides.map((guide) => (
            <g key={guide}>
              <line x1={padding.left} x2={width - padding.right} y1={y(guide)} y2={y(guide)} stroke="hsl(var(--border))" strokeDasharray="3 5" />
              <text x={padding.left - 10} y={y(guide) + 4} textAnchor="end" fill="hsl(var(--muted-foreground))" fontSize="10" fontFamily="var(--app-font-mono)">{money(guide)}</text>
            </g>
          ))}
          <line x1={padding.left} x2={width - padding.right} y1={baseline} y2={baseline} stroke="hsl(var(--muted-foreground) / .55)" />
          {points.length > 1 && <path d={path} fill="none" stroke="hsl(var(--primary))" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />}
          {points.map((point, index) => (
            <g key={`${point.timestamp}-${index}`}>
              <title>{`${dateTime(point.timestamp)} · ${money(point.equity)}`}</title>
              <circle
                cx={x(index)}
                cy={y(point.equity)}
                r={point.tradeId === selectedTradeId ? 5 : point.tradeId === null ? 3 : 3.2}
                fill={point.equity >= 0 ? "hsl(var(--primary))" : "hsl(var(--destructive))"}
                stroke={point.tradeId === selectedTradeId ? "hsl(var(--accent))" : "hsl(var(--card))"}
                strokeWidth={point.tradeId === selectedTradeId ? 3 : 1.5}
              />
            </g>
          ))}
          {points.length > 0 && (
            <>
              <text x={padding.left} y={height - 10} fill="hsl(var(--muted-foreground))" fontSize="10" fontFamily="var(--app-font-mono)">{shortDate(points[0].timestamp)}</text>
              <text x={width - padding.right} y={height - 10} textAnchor="end" fill="hsl(var(--muted-foreground))" fontSize="10" fontFamily="var(--app-font-mono)">{shortDate(points[points.length - 1].timestamp)}</text>
            </>
          )}
        </svg>
      </div>
    </div>
  );
}

function HistoricalChart({
  candles,
  trades,
  selectedTrade,
}: {
  candles: BacktestCandle[];
  trades: BacktestTrade[];
  selectedTrade: BacktestTrade | null;
}) {
  const width = 980;
  const height = 430;
  const padding = { top: 25, right: 62, bottom: 40, left: 18 };
  const sortedCandles = useMemo(() => [...candles].sort((a, b) => new Date(a.openTime).getTime() - new Date(b.openTime).getTime()), [candles]);
  const range = useMemo(() => {
    const prices = [
      ...sortedCandles.flatMap((candle) => [candle.low, candle.high]),
      ...trades.flatMap((trade) => [trade.entryPrice, trade.exitPrice, trade.stopLoss, trade.takeProfit].filter((price): price is number => price !== null)),
    ];
    const minimum = Math.min(...prices);
    const maximum = Math.max(...prices);
    return { minimum: Number.isFinite(minimum) ? minimum : 0, maximum: Number.isFinite(maximum) ? maximum : 1 };
  }, [sortedCandles, trades]);
  const priceRange = range.maximum - range.minimum || 1;
  const x = (index: number) => padding.left + (index / Math.max(sortedCandles.length - 1, 1)) * (width - padding.left - padding.right);
  const y = (price: number) => padding.top + ((range.maximum - price) / priceRange) * (height - padding.top - padding.bottom);
  const timeStart = sortedCandles.length ? new Date(sortedCandles[0].openTime).getTime() : 0;
  const timeEnd = sortedCandles.length ? new Date(sortedCandles[sortedCandles.length - 1].openTime).getTime() : 1;
  const timeSpan = timeEnd - timeStart || 1;
  const tradeX = (time: string) => padding.left + ((new Date(time).getTime() - timeStart) / timeSpan) * (width - padding.left - padding.right);
  const bodyWidth = Math.max(2, Math.min(11, (width - padding.left - padding.right) / Math.max(sortedCandles.length, 1) * 0.62));
  const guides = [0, 0.25, 0.5, 0.75, 1].map((fraction) => range.minimum + priceRange * fraction);

  return (
    <div className="rounded-lg border border-border bg-background/45 p-3 md:p-4" data-testid="chart-historical-ohlc">
      <div className="flex flex-wrap items-center justify-between gap-3 px-2 pb-2">
        <div className="text-xs text-muted-foreground">OHLC candles with simulated trade levels</div>
        <div className="flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1.5"><i className="w-2 h-2 rounded-full bg-primary" /> Entry</span>
          <span className="flex items-center gap-1.5"><i className="w-2 h-2 rounded-full bg-accent" /> Exit</span>
          <span className="flex items-center gap-1.5"><i className="w-2 h-2 rounded-sm bg-destructive" /> SL</span>
          <span className="flex items-center gap-1.5"><i className="w-2 h-2 rounded-sm bg-primary/50" /> TP</span>
        </div>
      </div>
      {sortedCandles.length ? (
        <div className="overflow-x-auto">
          <svg viewBox={`0 0 ${width} ${height}`} className="w-full min-w-[700px] h-[330px]" role="img" aria-label="Historical OHLC chart with trade entries exits stop losses and take profits">
            {guides.map((guide) => (
              <g key={guide}>
                <line x1={padding.left} x2={width - padding.right} y1={y(guide)} y2={y(guide)} stroke="hsl(var(--border))" strokeDasharray="3 6" />
                <text x={width - padding.right + 10} y={y(guide) + 4} fill="hsl(var(--muted-foreground))" fontSize="10" fontFamily="var(--app-font-mono)">{number(guide)}</text>
              </g>
            ))}
            {sortedCandles.map((candle, index) => {
              const up = candle.close >= candle.open;
              const candleX = x(index);
              const bodyTop = y(Math.max(candle.open, candle.close));
              const bodyBottom = y(Math.min(candle.open, candle.close));
              return (
                <g key={candle.id}>
                  <title>{`${dateTime(candle.openTime)} · O ${number(candle.open)} H ${number(candle.high)} L ${number(candle.low)} C ${number(candle.close)}`}</title>
                  <line x1={candleX} x2={candleX} y1={y(candle.high)} y2={y(candle.low)} stroke={up ? "hsl(var(--primary) / .8)" : "hsl(var(--destructive) / .8)"} strokeWidth="1.2" />
                  <rect x={candleX - bodyWidth / 2} y={bodyTop} width={bodyWidth} height={Math.max(1.5, bodyBottom - bodyTop)} fill={up ? "hsl(var(--primary) / .75)" : "hsl(var(--destructive) / .75)"} rx="1" />
                </g>
              );
            })}
            {trades.map((trade) => {
              const isSelected = selectedTrade?.id === trade.id;
              const entry = tradeX(trade.entryTime);
              const exit = tradeX(trade.exitTime);
              return (
                <g key={trade.id} opacity={selectedTrade && !isSelected ? 0.42 : 1}>
                  {trade.stopLoss !== null && <line x1={entry} x2={exit} y1={y(trade.stopLoss)} y2={y(trade.stopLoss)} stroke="hsl(var(--destructive))" strokeWidth={isSelected ? 2 : 1} strokeDasharray="5 4" />}
                  {trade.takeProfit !== null && <line x1={entry} x2={exit} y1={y(trade.takeProfit)} y2={y(trade.takeProfit)} stroke="hsl(var(--primary) / .8)" strokeWidth={isSelected ? 2 : 1} strokeDasharray="2 4" />}
                  <line x1={entry} x2={entry} y1={y(trade.entryPrice)} y2={y(trade.entryPrice) + (trade.side === "long" ? -16 : 16)} stroke="hsl(var(--primary))" strokeWidth={isSelected ? 2 : 1.2} />
                  <circle cx={entry} cy={y(trade.entryPrice)} r={isSelected ? 5 : 3.2} fill="hsl(var(--primary))" stroke={isSelected ? "hsl(var(--accent))" : "hsl(var(--card))"} strokeWidth={isSelected ? 3 : 1.5} />
                  <line x1={exit} x2={exit} y1={y(trade.exitPrice)} y2={y(trade.exitPrice) + (trade.side === "long" ? 16 : -16)} stroke="hsl(var(--accent))" strokeWidth={isSelected ? 2 : 1.2} />
                  <circle cx={exit} cy={y(trade.exitPrice)} r={isSelected ? 5 : 3.2} fill="hsl(var(--accent))" stroke={isSelected ? "hsl(var(--foreground))" : "hsl(var(--card))"} strokeWidth={isSelected ? 2 : 1.5} />
                  <title>{`Trade ${trade.id}: entry ${number(trade.entryPrice)}, exit ${number(trade.exitPrice)}`}</title>
                </g>
              );
            })}
            <text x={padding.left} y={height - 12} fill="hsl(var(--muted-foreground))" fontSize="10" fontFamily="var(--app-font-mono)">{shortDate(sortedCandles[0].openTime)}</text>
            <text x={width - padding.right} y={height - 12} textAnchor="end" fill="hsl(var(--muted-foreground))" fontSize="10" fontFamily="var(--app-font-mono)">{shortDate(sortedCandles[sortedCandles.length - 1].openTime)}</text>
          </svg>
        </div>
      ) : (
        <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">No stored candles are available for this result.</div>
      )}
    </div>
  );
}

function TradeTable({
  trades,
  selectedTradeId,
  onSelect,
}: {
  trades: BacktestTrade[];
  selectedTradeId: number | null;
  onSelect: (trade: BacktestTrade) => void;
}) {
  return (
    <div className="panel table-wrap" data-testid="table-backtest-trades">
      <div className="min-w-[760px]">
        <div className="grid grid-cols-[34px_70px_1.1fr_1.1fr_1fr_100px_80px] gap-3 px-4 py-3 border-b border-border">
          {["#", "Side", "Entry", "Exit", "P/L", "Result", "Time"].map((heading) => <div className="eyebrow" key={heading}>{heading}</div>)}
        </div>
        {trades.map((trade) => {
          const selected = trade.id === selectedTradeId;
          return (
            <button
              type="button"
              key={trade.id}
              className={`w-full text-left grid grid-cols-[34px_70px_1.1fr_1.1fr_1fr_100px_80px] gap-3 items-center px-4 py-3.5 border-b border-border last:border-b-0 transition-colors ${selected ? "bg-primary/10" : "hover:bg-secondary/60"}`}
              onClick={() => onSelect(trade)}
              data-testid={`button-select-trade-${trade.id}`}
              aria-pressed={selected}
            >
              <span className="mono text-xs text-muted-foreground">{trade.id}</span>
              <span className={`tag w-fit ${trade.side === "long" ? "tag-active" : "tag-draft"}`}>{trade.side === "long" ? "BUY" : "SELL"}</span>
              <span><strong className="block mono text-xs">{number(trade.entryPrice)}</strong><small className="text-[10px] text-muted-foreground">{dateTime(trade.entryTime)}</small></span>
              <span><strong className="block mono text-xs">{number(trade.exitPrice)}</strong><small className="text-[10px] text-muted-foreground">{dateTime(trade.exitTime)}</small></span>
              <span className={`mono text-xs font-medium ${valueClass(trade.pnl)}`}>{money(trade.pnl)}</span>
              <span className={`tag w-fit ${trade.pnl > 0 ? "tag-active" : trade.pnl < 0 ? "tag-archived" : "tag-draft"}`}>{trade.pnl > 0 ? "WIN" : trade.pnl < 0 ? "LOSS" : "FLAT"}</span>
              <span className="text-[10px] text-muted-foreground">{shortDate(trade.entryTime)} → {shortDate(trade.exitTime)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TradeDetails({ trade }: { trade: BacktestTrade | null }) {
  if (!trade) return null;
  const rows = [
    ["Entry time", dateTime(trade.entryTime)],
    ["Entry price", number(trade.entryPrice)],
    ["Exit time", dateTime(trade.exitTime)],
    ["Exit price", number(trade.exitPrice)],
    ["Stop loss", number(trade.stopLoss)],
    ["Take profit", number(trade.takeProfit)],
    ["Entry reason", trade.entryReason],
    ["Exit reason", trade.exitReason],
  ];
  return (
    <aside className="panel p-5 rise" data-testid={`panel-trade-details-${trade.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="eyebrow">Selected trade</div>
          <h3 className="font-semibold mt-2">Trade {trade.id} · {trade.side}</h3>
        </div>
        <div className={`metric-value text-xl ${valueClass(trade.pnl)}`}>{money(trade.pnl)}</div>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-4 mt-5 pt-5 border-t border-border">
        {rows.map(([label, value]) => (
          <div key={label} className={label.includes("reason") ? "col-span-2" : ""}>
            <div className="eyebrow">{label}</div>
            <div className={`text-xs mt-1.5 ${label.includes("reason") ? "leading-relaxed text-muted-foreground" : "mono"}`}>{value || "—"}</div>
          </div>
        ))}
      </div>
    </aside>
  );
}

function Assumptions({ backtest }: { backtest: BacktestResults["backtest"] }) {
  const assumptions = backtest.executionAssumptions?.split("\n").filter(Boolean) ?? [];
  return (
    <details className="panel group" data-testid="section-backtest-assumptions">
      <summary className="list-none cursor-pointer p-5 md:p-6 flex items-center justify-between gap-4">
        <span className="flex items-center gap-3">
          <span className="w-8 h-8 rounded-lg bg-accent/10 text-accent flex items-center justify-center"><Info size={16} /></span>
          <span><span className="eyebrow block">Method</span><strong className="block text-sm mt-1">Backtest assumptions</strong></span>
        </span>
        <ChevronDown size={17} className="text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="px-5 pb-6 md:px-6">
        <div className="rounded-md border border-accent/20 bg-accent/5 p-4 text-xs leading-relaxed text-muted-foreground">
          <div className="eyebrow text-accent mb-2">Fees / slippage</div>
           Fees and slippage are not included. No fee or slippage amount has been added to the displayed P/L.
        </div>
        <div className="mt-5 space-y-3">
          {assumptions.length ? assumptions.map((assumption, index) => (
            <div className="flex gap-3 text-xs text-muted-foreground leading-relaxed" key={`${assumption}-${index}`}>
              <span className="mono text-primary shrink-0">{String(index + 1).padStart(2, "0")}</span>
              <span>{assumption}</span>
            </div>
          )) : <p className="text-sm text-muted-foreground">No stored execution assumptions were returned for this result.</p>}
        </div>
      </div>
    </details>
  );
}

export function BacktestResultsPanel({ backtestId, onBack, onViewStrategy, onRunAgain }: BacktestResultsPanelProps) {
  const query = useGetBacktestResults(backtestId, {
    query: { enabled: Number.isFinite(backtestId), retry: false, queryKey: getGetBacktestResultsQueryKey(backtestId) },
  });
  const results = query.data;
  const trades = useMemo(() => results?.trades ?? [], [results?.trades]);
  const [selectedTradeId, setSelectedTradeId] = useState<number | null>(null);

  useEffect(() => {
    if (!trades.length) {
      setSelectedTradeId(null);
      return;
    }
    setSelectedTradeId((current) => current && trades.some((trade) => trade.id === current) ? current : trades[0].id);
  }, [trades]);

  const selectedTrade = useMemo(() => trades.find((trade) => trade.id === selectedTradeId) ?? null, [selectedTradeId, trades]);

  if (query.isLoading) return <LoadingResults />;
  if (query.isError) {
    return (
      <div className="space-y-5" data-testid="backtest-results-error">
        <button className="btn btn-secondary" onClick={onBack} data-testid="button-back-to-backtesting"><ArrowLeft size={15} /> Back to backtesting</button>
        <div className="panel p-10 text-center">
          <AlertTriangle className="mx-auto text-destructive mb-3" size={23} />
          <h1 className="font-semibold text-lg">Couldn’t load this result</h1>
          <p className="text-sm text-muted-foreground mt-2">The recorded backtest may not exist yet, or its result is not available.</p>
          <button className="btn btn-secondary mt-5" onClick={() => query.refetch()} data-testid="button-retry-backtest-results">Retry</button>
        </div>
      </div>
    );
  }
  if (!results) {
    return (
      <div className="panel p-12 text-center" data-testid="backtest-results-empty">
        <Database className="mx-auto text-primary mb-4" size={24} />
        <h1 className="font-semibold text-lg">No result recorded</h1>
        <p className="text-sm text-muted-foreground mt-2">There is no stored result for this backtest.</p>
        <button className="btn btn-secondary mt-5" onClick={onBack} data-testid="button-back-from-empty-results"><ArrowLeft size={15} /> Back to backtesting</button>
      </div>
    );
  }

  const { backtest, candles, statistics } = results;
  const hasTrades = trades.length > 0;
  const isFailed = backtest.status === "failed";
  const isCompleted = backtest.status === "completed";
  const timeframeSummaries = backtest.timeframeSummaries || [];
  const executionTimeframeId = timeframeSummaries.find(timeframe => timeframe.isExecutionTimeframe)?.timeframeId ?? backtest.timeframeId;
  const executionCandles = candles.filter(candle => candle.timeframeId === executionTimeframeId);
  const replayCandles = executionCandles.length ? executionCandles : candles;
  const timeframeSummaryLabel = timeframeSummaries.length
    ? timeframeSummaries.map(timeframe => `${timeframe.label} · ${timeframe.candlesProcessed} candles`).join("  /  ")
    : `${backtest.timeframeLabel} · ${candles.length} candles`;

  return (
    <div className="space-y-5" data-testid="backtest-results-panel">
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-5">
        <div>
          <button className="btn btn-ghost -ml-2 mb-4" onClick={onBack} data-testid="button-back-to-backtesting"><ArrowLeft size={15} /> Back to backtesting</button>
          <div className="eyebrow flex items-center gap-2"><Clock3 size={13} /> Recorded review · Backtest {backtest.id}</div>
          <h1 className="display text-3xl md:text-4xl font-bold mt-3">{backtest.strategyName} <span className="text-muted-foreground">/ v{backtest.versionNumber}</span></h1>
          <p className="text-sm text-muted-foreground mt-3 max-w-2xl leading-relaxed">This backtest used {backtest.strategyName} v{backtest.versionNumber}. It is a read-only result from the stored strategy version and historical candle series. Nothing here is a signal or an order.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {onViewStrategy && <button className="btn btn-secondary" onClick={() => onViewStrategy(backtest.strategyId, backtest.strategyVersionId)} data-testid="button-view-strategy-from-backtest"><ExternalLink size={14} /> View Strategy</button>}
          {onRunAgain && <button className="btn btn-primary" onClick={() => onRunAgain(backtest)} data-testid="button-run-again-backtest"><RotateCcw size={14} /> Run Again</button>}
           <div className={`tag ${isFailed ? "tag-archived" : isCompleted ? "tag-active" : "tag-draft"} mt-1`} data-testid="status-backtest-result">{backtestStatusLabel(backtest.status)}</div>
        </div>
      </div>
       <nav className="backtest-results-nav panel p-1 flex flex-wrap gap-1" aria-label="Backtest result sections">
         {[["backtest-result-metadata", "Metadata"], ["backtest-result-performance", "Performance"], ["backtest-result-trades", "Simulated trades"], ["backtest-result-replay", "Candle replay"], ["backtest-result-assumptions", "Assumptions"]].map(([id, label]) => <a key={id} className="btn btn-ghost flex-1 min-w-[120px]" href={`#${id}`}>{label}</a>)}
       </nav>

      {isFailed && (
        <div className="panel border-destructive/30 bg-destructive/5 p-5 flex gap-3" data-testid="backtest-failed-state">
          <AlertTriangle className="text-destructive shrink-0" size={18} />
           <div><div className="font-semibold text-sm">Backtest failed</div><p className="text-xs text-muted-foreground mt-1 leading-relaxed">{backtest.errorMessage || "The server did not return a completed historical result."}</p></div>
        </div>
      )}
      {!isFailed && !isCompleted && (
        <div className="panel border-accent/30 bg-accent/5 p-5 flex gap-3" data-testid="backtest-in-progress-state">
          <Clock3 className="text-accent shrink-0" size={18} />
          <div><div className="font-semibold text-sm">This run is still {backtest.status}</div><p className="text-xs text-muted-foreground mt-1">Performance sections will become available when the server records a completed result.</p></div>
        </div>
      )}
       {isCompleted && (
         <div className="panel border-accent/30 bg-accent/5 p-4 md:p-5 flex gap-3" data-testid="backtest-result-boundary">
           <Info className="text-accent shrink-0 mt-0.5" size={17} />
           <div><div className="font-semibold text-sm">How to interpret this result</div><p className="text-xs text-muted-foreground mt-1 leading-relaxed">These are simulated historical results from the stored candle series. Fees, slippage, signals, recommendations, and live execution are not inferred.</p></div>
         </div>
       )}

       <section id="backtest-result-metadata" className="panel p-5 md:p-6" data-testid="backtest-metadata">
        <div className="flex items-center gap-2 mb-5"><CheckCircle2 size={15} className={isCompleted ? "text-primary" : "text-muted-foreground"} /><div className="eyebrow">Recorded metadata</div></div>
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-x-5 gap-y-5">
           {[
            ["Instrument", backtest.instrumentSymbol],
             ["Timeframe", timeframeSummaries.length ? timeframeSummaries.map(timeframe => timeframe.label).join(" + ") : backtest.timeframeLabel],
            ["Period", `${dateOnly(backtest.startDate)} – ${dateOnly(backtest.endDate)}`],
             ["Candles", timeframeSummaryLabel],
            ["Trades", String(backtest.tradeCount)],
            ["Started", dateTime(backtest.startedAt)],
            ["Completed", dateTime(backtest.completedAt)],
          ].map(([label, value]) => <div key={label} data-testid={`metadata-${label.toLowerCase()}`}><div className="eyebrow">{label}</div><div className="text-xs font-semibold mt-2 leading-relaxed">{value}</div></div>)}
        </div>
         {timeframeSummaries.length > 1 && <div className="border-t border-border mt-5 pt-4" data-testid="backtest-timeframe-breakdown">
           <div className="eyebrow mb-3">Causal timeframe coverage</div>
           <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
             {timeframeSummaries.map(timeframe => <div key={timeframe.timeframeId} className="rounded-md bg-secondary/60 px-3 py-2">
               <div className="text-xs font-semibold">{timeframe.label}{timeframe.isExecutionTimeframe ? " · execution series" : " · condition series"}</div>
               <div className="text-[11px] text-muted-foreground mt-1">{timeframe.candlesProcessed} completed candles loaded</div>
             </div>)}
           </div>
         </div>}
        {backtest.resultMessage && <div className="border-t border-border mt-5 pt-4 text-xs text-muted-foreground">{backtest.resultMessage}</div>}
      </section>

      {hasTrades ? (
        <>
           <section id="backtest-result-performance">
            <SectionHeading eyebrow="Performance" title="What the recorded trades did" icon={BarChart3} detail="All values below are returned by the backtest result; no costs or signals are inferred." />
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
              <StatCard label="Net P/L" value={money(statistics.totalPnl)} positive={(statistics.totalPnl ?? 0) > 0 ? true : (statistics.totalPnl ?? 0) < 0 ? false : undefined} detail={`${statistics.winningTrades} wins · ${statistics.losingTrades} losses`} />
              <StatCard label="Win rate" value={statistics.winRate === null ? "—" : `${number(statistics.winRate, 1)}%`} detail={`${trades.length} completed trades`} />
               <StatCard label="Profit factor" value={statistics.profitFactor === null && statistics.winningTrades > 0 && statistics.losingTrades === 0 ? "∞" : number(statistics.profitFactor)} detail="Gross wins / gross losses" />
              <StatCard label="Max drawdown" value={money(statistics.maximumDrawdown)} positive={statistics.maximumDrawdown && statistics.maximumDrawdown > 0 ? false : undefined} detail="Peak-to-trough" />
              <StatCard label="Avg winner" value={money(statistics.averageWinningTrade)} positive={statistics.averageWinningTrade !== null && statistics.averageWinningTrade > 0} />
              <StatCard label="Avg loser" value={money(statistics.averageLosingTrade)} positive={statistics.averageLosingTrade !== null && statistics.averageLosingTrade < 0 ? false : undefined} />
               <StatCard label="Largest winner" value={money(statistics.largestWinningTrade)} positive={statistics.largestWinningTrade !== null && statistics.largestWinningTrade > 0} />
               <StatCard label="Largest loser" value={money(statistics.largestLosingTrade)} positive={statistics.largestLosingTrade !== null && statistics.largestLosingTrade < 0 ? false : undefined} />
            </div>
            <div className="panel p-4 md:p-6 mt-4">
              <EquityCurve statistics={statistics} selectedTradeId={selectedTradeId} />
            </div>
          </section>

           <section id="backtest-result-trades" className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_310px] gap-5 items-start">
            <div>
              <SectionHeading eyebrow="Trades" title="Every simulated trade" icon={Target} detail="Select a row to inspect its stored prices, levels, and reasons." />
              <TradeTable trades={trades} selectedTradeId={selectedTradeId} onSelect={(trade) => setSelectedTradeId(trade.id)} />
            </div>
            <TradeDetails trade={selectedTrade} />
          </section>
        </>
      ) : (
        <div className="panel empty-grid p-10 md:p-14 text-center" data-testid="backtest-zero-trade-state">
          <Crosshair className="mx-auto text-accent mb-4" size={23} />
           <h2 className="font-semibold text-lg">No trades found for this strategy and period.</h2>
           <p className="text-sm text-muted-foreground max-w-lg mx-auto mt-2 leading-relaxed">No trades were generated during this period. Performance statistics stay blank rather than implying a result.</p>
        </div>
      )}

       <section id="backtest-result-replay">
         <SectionHeading eyebrow="Historical record" title="The execution candle series behind this run" icon={LineChart} detail={`${replayCandles.length} stored ${replayCandles.length === 1 ? "candle" : "candles"} · condition timeframes are shown in the coverage above`} />
         <HistoricalChart candles={replayCandles} trades={trades} selectedTrade={selectedTrade} />
      </section>

       <div id="backtest-result-assumptions"><Assumptions backtest={backtest} /></div>
    </div>
  );
}