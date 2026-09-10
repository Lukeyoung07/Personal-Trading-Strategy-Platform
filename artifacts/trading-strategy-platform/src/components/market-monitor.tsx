import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  BarChart3, Database, Globe, Network, Clock, DatabaseZap, Search, Plus,
  Pencil, Trash2, X, Info, Activity, AlertTriangle, FileText, Settings2, ShieldAlert, Link2,
  Radio, RefreshCw, WifiOff, CandlestickChart
} from "lucide-react";
import {
  useListInstruments, useCreateInstrument, useUpdateInstrument, useDeleteInstrument, getListInstrumentsQueryKey,
  useListMarketDataSources, useCreateMarketDataSource, useUpdateMarketDataSource, useDeleteMarketDataSource, getListMarketDataSourcesQueryKey,
  useListTimeframes, useCreateTimeframe, useUpdateTimeframe, useDeleteTimeframe, getListTimeframesQueryKey,
  useListMarketDataConnections, getListMarketDataConnectionsQueryKey,
  useListCandles, getListCandlesQueryKey,
  useRefreshMarketDataCandles,
  useGetMarketDataSummary, getGetMarketDataSummaryQueryKey,
  getListMarketsQueryKey,
  useListSourceInstrumentMappings, useCreateSourceInstrumentMapping, useUpdateSourceInstrumentMapping, useDeleteSourceInstrumentMapping, getListSourceInstrumentMappingsQueryKey,
  type Instrument, type MarketDataSource, type Timeframe, type MarketDataConnection, type Candle, type MarketDataSummary, type SourceInstrumentMapping
} from "@workspace/api-client-react";

type Tab = "live-chart" | "instruments" | "sources" | "mappings" | "timeframes" | "connections" | "candles";

export function MarketMonitor() {
  const [tab, setTab] = useState<Tab>("live-chart");
  const summary = useGetMarketDataSummary();
  const sumData = summary.data;

  return (
    <div className="page-wrap">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-5 mb-8">
        <div>
          <div className="eyebrow mb-3">Coverage</div>
          <h1 className="display text-3xl md:text-4xl font-bold">Market Monitor</h1>
          <p className="text-muted-foreground text-sm mt-3 max-w-2xl leading-relaxed">
            Watch genuine BiQuote market data through the provider-neutral market-data service.
            Closed, stale, and unavailable data remain visibly distinct.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-8">
        <Stat label="Instruments" value={sumData?.instrumentCount ?? 0} icon={BarChart3} />
        <Stat label="Data Sources" value={sumData?.sourceCount ?? 0} icon={Database} sub={`${sumData?.connectedSourceCount ?? 0} connected`} />
        <Stat label="Timeframes" value={sumData?.timeframeCount ?? 0} icon={Clock} />
        <Stat label="Stored Candles" value={sumData?.candleCount ?? 0} icon={DatabaseZap} sub={sumData?.latestDataAt ? `Latest: ${new Date(sumData.latestDataAt).toLocaleDateString()}` : "No data yet"} />
      </div>
      <div className="panel p-4 md:p-5 mb-5">
        <div className="eyebrow mb-3">Provider-neutral data path</div>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
          {["BiQuote adapter", "Market data service", "Normalized data", "Strategy engine"].map((step, index) => (
            <div key={step} className="rounded-md bg-secondary/55 px-3 py-3 text-xs font-semibold flex items-center justify-between gap-2">
              <span>{step}</span>{index < 3 && <span className="text-primary hidden sm:inline">→</span>}
            </div>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground mt-3">BiQuote is enabled for this personal development workspace only. No trades are placed and no recommendations are generated.</p>
      </div>

      <div className="panel p-1 flex overflow-x-auto gap-1 mb-5">
        <TabButton current={tab} id="live-chart" icon={CandlestickChart} label="Live Chart" onClick={setTab} />
        <TabButton current={tab} id="instruments" icon={BarChart3} label="Instruments" onClick={setTab} />
        <TabButton current={tab} id="sources" icon={Database} label="Sources" onClick={setTab} />
        <TabButton current={tab} id="mappings" icon={Link2} label="Mappings" onClick={setTab} />
        <TabButton current={tab} id="timeframes" icon={Clock} label="Timeframes" onClick={setTab} />
        <TabButton current={tab} id="connections" icon={Network} label="Connections" onClick={setTab} />
        <TabButton current={tab} id="candles" icon={DatabaseZap} label="Candles" onClick={setTab} />
      </div>

      {tab === "live-chart" && <LiveChartTab />}
      {tab === "instruments" && <InstrumentsTab />}
      {tab === "sources" && <SourcesTab />}
      {tab === "mappings" && <MappingsTab />}
      {tab === "timeframes" && <TimeframesTab />}
      {tab === "connections" && <ConnectionsTab />}
      {tab === "candles" && <CandlesTab />}
    </div>
  );
}

function Stat({ label, value, icon: Icon, sub }: { label: string; value: React.ReactNode; icon: any; sub?: string }) {
  return (
    <div className="panel panel-hover p-5 rise">
      <div className="flex justify-between items-start">
        <span className="eyebrow">{label}</span>
        <Icon size={16} className="text-muted-foreground" />
      </div>
      <div className="metric-value mt-4">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-2">{sub}</div>}
    </div>
  );
}

function TabButton({ current, id, icon: Icon, label, onClick }: { current: string; id: Tab; icon: any; label: string; onClick: (id: Tab) => void }) {
  return (
    <button
      className={`btn flex-1 whitespace-nowrap ${current === id ? "bg-secondary text-foreground" : "btn-ghost"}`}
      onClick={() => onClick(id)}
      data-testid={`tab-${id}`}
    >
      <Icon size={14} /> {label}
    </button>
  );
}

type StreamStatus = {
  state: "disconnected" | "connecting" | "connected" | "degraded" | "error";
  message: string;
  lastDataAt: string | null;
};

type LiveQuote = {
  last: number | null;
  bid: number | null;
  ask: number | null;
  eventTime: string;
  receivedAt: string;
  lastQuoteAt: string | null;
  marketState: "open" | "closed" | "unknown" | null;
  stale: boolean | null;
  quoteAgeSeconds: number | null;
  isLive: boolean;
};

type FormingCandle = {
  openTime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  isClosed: false;
};

function LiveChartTab() {
  const instruments = useListInstruments();
  const sources = useListMarketDataSources();
  const timeframes = useListTimeframes();
  const refresh = useRefreshMarketDataCandles();
  const qc = useQueryClient();
  const [sourceId, setSourceId] = useState<number | "">("");
  const [instrumentId, setInstrumentId] = useState<number | "">("");
  const [timeframeId, setTimeframeId] = useState<number | "">("");
  const [streamStatus, setStreamStatus] = useState<StreamStatus>({
    state: "disconnected",
    message: "Select an instrument to connect.",
    lastDataAt: null,
  });
  const [quote, setQuote] = useState<LiveQuote | null>(null);
  const [formingCandle, setFormingCandle] = useState<FormingCandle | null>(null);

  useEffect(() => {
    if (sourceId === "" && sources.data?.length) {
      const biquote = sources.data.find(source => source.providerKey === "biquote") ?? sources.data[0];
      setSourceId(biquote.id);
    }
  }, [sourceId, sources.data]);
  useEffect(() => {
    if (instrumentId === "" && instruments.data?.length) setInstrumentId(instruments.data[0].id);
  }, [instrumentId, instruments.data]);
  useEffect(() => {
    if (timeframeId === "" && timeframes.data?.length) {
      const hourly = timeframes.data.find(timeframe => timeframe.code === "1h") ?? timeframes.data[0];
      setTimeframeId(hourly.id);
    }
  }, [timeframeId, timeframes.data]);

  const ready = sourceId !== "" && instrumentId !== "" && timeframeId !== "";
  const selectedTimeframe = timeframes.data?.find(timeframe => timeframe.id === timeframeId);
  const candles = useListCandles(
    {
      sourceId: Number(sourceId),
      instrumentId: Number(instrumentId),
      timeframeId: Number(timeframeId),
      limit: 500,
    },
    {
      query: {
        enabled: ready,
        queryKey: getListCandlesQueryKey({
          sourceId: Number(sourceId),
          instrumentId: Number(instrumentId),
          timeframeId: Number(timeframeId),
          limit: 500,
        }),
      },
    },
  );

  useEffect(() => {
    setQuote(null);
    setFormingCandle(null);
    if (!ready) {
      setStreamStatus({ state: "disconnected", message: "Select an instrument to connect.", lastDataAt: null });
      return;
    }

    const stream = new EventSource(`/api/market-data/quotes/stream?sourceId=${sourceId}&instrumentId=${instrumentId}`);
    const onStatus = (event: MessageEvent<string>) => {
      try {
        setStreamStatus(JSON.parse(event.data) as StreamStatus);
      } catch {
        setStreamStatus({ state: "error", message: "The provider status could not be read.", lastDataAt: null });
      }
    };
    const onQuote = (event: MessageEvent<string>) => {
      try {
        const next = JSON.parse(event.data) as LiveQuote;
        setQuote(next);
        const price = next.last ?? (next.bid != null && next.ask != null ? (next.bid + next.ask) / 2 : next.bid ?? next.ask);
        const durationMs = (selectedTimeframe?.durationSeconds ?? 3600) * 1000;
        if (price == null || !Number.isFinite(price)) return;
        const eventTime = new Date(next.eventTime);
        if (Number.isNaN(eventTime.getTime())) return;
        const bucket = new Date(Math.floor(eventTime.getTime() / durationMs) * durationMs).toISOString();
        setFormingCandle(previous => previous?.openTime === bucket
          ? { ...previous, high: Math.max(previous.high, price), low: Math.min(previous.low, price), close: price }
          : { openTime: bucket, open: price, high: price, low: price, close: price, isClosed: false });
      } catch {
        setStreamStatus({ state: "error", message: "The provider quote could not be read.", lastDataAt: null });
      }
    };
    stream.addEventListener("status", onStatus);
    stream.addEventListener("quote", onQuote);
    stream.onerror = () => setStreamStatus(previous => ({
      ...previous,
      state: "disconnected",
      message: "The live data connection was lost. No stale quote is marked LIVE.",
    }));
    return () => {
      stream.removeEventListener("status", onStatus);
      stream.removeEventListener("quote", onQuote);
      stream.close();
    };
  }, [instrumentId, ready, selectedTimeframe?.durationSeconds, sourceId]);

  const chartBars = useMemo(() => {
    const stored = (candles.data ?? []).map(candle => ({
      openTime: String(candle.openTime),
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      isClosed: candle.isClosed,
    }));
    if (!formingCandle) return stored.sort((a, b) => new Date(a.openTime).getTime() - new Date(b.openTime).getTime()).slice(-80);
    const existing = stored.findIndex(candle => candle.openTime === formingCandle.openTime);
    if (existing >= 0) stored[existing] = { ...stored[existing], ...formingCandle };
    else stored.push(formingCandle);
    return stored.sort((a, b) => new Date(a.openTime).getTime() - new Date(b.openTime).getTime()).slice(-80);
  }, [candles.data, formingCandle]);

  const connectionLabel = streamStatus.state === "connected" && quote?.isLive
    ? "LIVE"
    : quote?.marketState === "closed" || quote?.stale
      ? "MARKET CLOSED"
      : streamStatus.state.toUpperCase();
  const isLive = connectionLabel === "LIVE";
  const source = sources.data?.find(item => item.id === sourceId);

  const refreshCandles = () => {
    if (!ready) return;
    refresh.mutate({
      data: { sourceId: Number(sourceId), instrumentId: Number(instrumentId), timeframeId: Number(timeframeId), limit: 500 },
    }, {
      onSuccess: () => qc.invalidateQueries({
        queryKey: getListCandlesQueryKey({
          sourceId: Number(sourceId),
          instrumentId: Number(instrumentId),
          timeframeId: Number(timeframeId),
          limit: 500,
        }),
      }),
    });
  };

  if (instruments.isLoading || sources.isLoading || timeframes.isLoading) return <LoadingBlock />;
  if (instruments.isError || sources.isError || timeframes.isError) return <ErrorBlock retry={() => { instruments.refetch(); sources.refetch(); timeframes.refetch(); }} />;

  return (
    <div className="space-y-5">
      <div className="panel p-4 md:p-5">
        <div className="flex flex-col lg:flex-row lg:items-end gap-4">
          <div className="flex-1 min-w-[180px]">
            <span className="label">Instrument</span>
            <select className="select" value={instrumentId} onChange={event => setInstrumentId(event.target.value ? Number(event.target.value) : "")}>
              <option value="">Select instrument…</option>
              {(instruments.data ?? []).map(instrument => <option key={instrument.id} value={instrument.id}>{instrument.symbol} — {instrument.displayName || instrument.assetClass}</option>)}
            </select>
          </div>
          <div className="w-full lg:w-56">
            <span className="label">Data source</span>
            <select className="select" value={sourceId} onChange={event => setSourceId(event.target.value ? Number(event.target.value) : "")}>
              <option value="">Select source…</option>
              {(sources.data ?? []).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </div>
          <div className="w-full lg:w-44">
            <span className="label">Timeframe</span>
            <select className="select" value={timeframeId} onChange={event => setTimeframeId(event.target.value ? Number(event.target.value) : "")}>
              <option value="">Select timeframe…</option>
              {(timeframes.data ?? []).map(timeframe => <option key={timeframe.id} value={timeframe.id}>{timeframe.code}</option>)}
            </select>
          </div>
          <button className="btn btn-secondary" onClick={refreshCandles} disabled={!ready || refresh.isPending}>
            <RefreshCw size={14} className={refresh.isPending ? "animate-spin" : ""} />
            {refresh.isPending ? "Refreshing…" : "Refresh candles"}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-5 pt-4 border-t border-border text-xs text-muted-foreground">
          <span className={`tag ${isLive ? "tag-open" : connectionLabel === "MARKET CLOSED" ? "tag-draft" : "tag-archived"}`}>
            {isLive ? <Radio size={11} className="mr-1" /> : <WifiOff size={11} className="mr-1" />}
            {connectionLabel}
          </span>
          <span>{source?.name ?? "No source selected"}</span>
          <span>{selectedTimeframe?.code ?? "—"}</span>
          <span>{streamStatus.message}</span>
        </div>
      </div>

      {refresh.isError && <div className="panel p-4 text-sm text-destructive">Candles could not be refreshed: {refresh.error instanceof Error ? refresh.error.message : "provider error"}</div>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="panel p-4"><div className="eyebrow">Current price</div><div className="metric-value mt-3 mono">{quote?.last?.toFixed(5) ?? "—"}</div><div className="text-[11px] text-muted-foreground mt-2">{isLive ? "Genuine live mid price" : quote ? "Last provider price" : "No quote received"}</div></div>
        <div className="panel p-4"><div className="eyebrow">Bid / ask</div><div className="mt-3 mono text-sm">{quote?.bid?.toFixed(5) ?? "—"} <span className="text-muted-foreground">/</span> {quote?.ask?.toFixed(5) ?? "—"}</div><div className="text-[11px] text-muted-foreground mt-2">Provider quote</div></div>
        <div className="panel p-4"><div className="eyebrow">Last update</div><div className="mt-3 mono text-sm">{quote?.receivedAt ? new Date(quote.receivedAt).toLocaleTimeString() : "—"}</div><div className="text-[11px] text-muted-foreground mt-2">{quote?.quoteAgeSeconds != null ? `${quote.quoteAgeSeconds}s quote age` : "No timestamp yet"}</div></div>
        <div className="panel p-4"><div className="eyebrow">Candles</div><div className="metric-value mt-3">{chartBars.length}</div><div className="text-[11px] text-muted-foreground mt-2">{formingCandle ? "Includes live forming bar" : "Stored provider bars"}</div></div>
      </div>

      <div className="panel p-4 md:p-6">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div><h2 className="font-semibold">BiQuote candlestick chart</h2><p className="text-xs text-muted-foreground mt-1">Stored OHLC bars plus a forming bar built only from received provider ticks.</p></div>
          <CandlestickChart size={18} className="text-primary shrink-0" />
        </div>
        {candles.isError ? <ErrorBlock retry={() => candles.refetch()} /> : !ready ? <div className="p-10 text-center text-sm text-muted-foreground">Select an instrument, source, and timeframe to view genuine market data.</div> : candles.isLoading ? <LoadingBlock /> : !chartBars.length ? <EmptyState icon={CandlestickChart} title="No candle data yet" text="Refresh candles to request OHLC data from BiQuote. If the symbol or timeframe is unsupported, the provider error will be shown instead of substituting data." action={<button className="btn btn-primary" onClick={refreshCandles} disabled={refresh.isPending}>Request BiQuote candles</button>} /> : <CandleSvg bars={chartBars} />}
      </div>
    </div>
  );
}

function CandleSvg({ bars }: { bars: Array<{ openTime: string; open: number; high: number; low: number; close: number; isClosed: boolean }> }) {
  const width = 900;
  const height = 360;
  const pad = { top: 20, right: 20, bottom: 30, left: 20 };
  const highs = bars.map(bar => bar.high);
  const lows = bars.map(bar => bar.low);
  const high = Math.max(...highs);
  const low = Math.min(...lows);
  const range = high - low || Math.max(Math.abs(high) * 0.01, 1);
  const chartHeight = height - pad.top - pad.bottom;
  const chartWidth = width - pad.left - pad.right;
  const xStep = chartWidth / Math.max(bars.length, 1);
  const y = (value: number) => pad.top + ((high - value) / range) * chartHeight;
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full min-w-[680px] h-[300px] md:h-[360px]" role="img" aria-label="BiQuote candlestick chart">
        <line x1={pad.left} x2={width - pad.right} y1={height - pad.bottom} y2={height - pad.bottom} stroke="hsl(var(--border))" />
        {bars.map((bar, index) => {
          const x = pad.left + xStep * index + xStep / 2;
          const candleWidth = Math.max(3, Math.min(12, xStep * 0.55));
          const rising = bar.close >= bar.open;
          const color = bar.isClosed ? (rising ? "hsl(var(--primary))" : "hsl(var(--destructive))") : "hsl(var(--accent))";
          const bodyTop = y(Math.max(bar.open, bar.close));
          const bodyHeight = Math.max(2, Math.abs(y(bar.open) - y(bar.close)));
          return <g key={`${bar.openTime}-${index}`}><line x1={x} x2={x} y1={y(bar.high)} y2={y(bar.low)} stroke={color} strokeWidth="1.5" /><rect x={x - candleWidth / 2} y={bodyTop} width={candleWidth} height={bodyHeight} fill={color} rx="1" /></g>;
        })}
        <text x={pad.left} y={height - 8} fill="hsl(var(--muted-foreground))" fontSize="10">{new Date(bars[0].openTime).toLocaleString()}</text>
        <text x={width - pad.right} y={height - 8} textAnchor="end" fill="hsl(var(--muted-foreground))" fontSize="10">{new Date(bars[bars.length - 1].openTime).toLocaleString()}</text>
        <text x={width - pad.right} y={pad.top + 10} textAnchor="end" fill="hsl(var(--muted-foreground))" fontSize="10">{high.toFixed(5)}</text>
        <text x={width - pad.right} y={height - pad.bottom - 4} textAnchor="end" fill="hsl(var(--muted-foreground))" fontSize="10">{low.toFixed(5)}</text>
      </svg>
      <div className="flex flex-wrap gap-4 text-[11px] text-muted-foreground mt-2"><span><i className="inline-block w-2 h-2 rounded-sm bg-primary mr-1" />up</span><span><i className="inline-block w-2 h-2 rounded-sm bg-destructive mr-1" />down</span><span><i className="inline-block w-2 h-2 rounded-sm bg-accent mr-1" />forming from genuine ticks</span></div>
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-5" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="panel w-full max-w-lg max-h-[92dvh] overflow-y-auto p-6 rise">
        <div className="flex items-center justify-between mb-6">
          <h2 className="font-semibold text-lg">{title}</h2>
          <button type="button" onClick={onClose} className="btn btn-ghost" data-testid="button-close-modal"><X size={17} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-muted-foreground mt-1.5">{hint}</span>}
    </label>
  );
}

function Confirm({ title, text, onCancel, onConfirm, busy }: { title: string; text: string; onCancel: () => void; onConfirm: () => void; busy?: boolean }) {
  return (
    <Modal title={title} onClose={onCancel}>
      <p className="text-sm text-muted-foreground leading-relaxed">{text}</p>
      <div className="flex justify-end gap-2 mt-7">
        <button type="button" className="btn btn-secondary" onClick={onCancel} data-testid="button-cancel-delete">Keep it</button>
        <button type="button" className="btn btn-danger" disabled={busy} onClick={onConfirm} data-testid="button-confirm-delete">{busy ? "Removing…" : "Remove"}</button>
      </div>
    </Modal>
  );
}

function EmptyState({ icon: Icon, title, text, action }: { icon: any; title: string; text: string; action?: React.ReactNode }) {
  return (
    <div className="panel empty-grid p-10 md:p-14 text-center">
      <div className="w-11 h-11 mx-auto rounded-xl border border-primary/30 bg-primary/10 text-primary flex items-center justify-center mb-5">
        <Icon size={20} />
      </div>
      <h3 className="font-semibold text-lg">{title}</h3>
      <p className="text-sm text-muted-foreground max-w-md mx-auto mt-2 leading-relaxed">{text}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

function LoadingBlock() {
  return <div className="panel p-10 text-center text-sm text-muted-foreground">Loading…</div>;
}

function ErrorBlock({ retry }: { retry: () => void }) {
  return <div className="panel p-10 text-center"><AlertTriangle size={19} className="text-destructive mx-auto" /><p className="text-sm text-muted-foreground mt-3">This market-data section could not be loaded.</p><button className="btn btn-secondary mt-4" onClick={retry}>Try again</button></div>;
}

// INSTRUMENTS
function InstrumentsTab() {
  const q = useListInstruments();
  const create = useCreateInstrument();
  const update = useUpdateInstrument();
  const del = useDeleteInstrument();
  const qc = useQueryClient();
  const [modal, setModal] = useState<Instrument | null | false>(false);
  const [confirm, setConfirm] = useState<Instrument | null>(null);
  const [search, setSearch] = useState("");

  const rows = (q.data || []).filter(i => `${i.symbol} ${i.displayName || ""} ${i.assetClass}`.toLowerCase().includes(search.toLowerCase()));

  const save = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const data: any = {
      symbol: String(f.get("symbol")).toUpperCase(),
      assetClass: String(f.get("assetClass")),
      instrumentType: String(f.get("instrumentType")),
      displayName: String(f.get("displayName") || "") || null,
      venue: String(f.get("venue") || "") || null,
      baseCurrency: String(f.get("baseCurrency") || "") || null,
      quoteCurrency: String(f.get("quoteCurrency") || "") || null,
      exchangeTimezone: String(f.get("exchangeTimezone") || "") || null,
      tickSize: f.get("tickSize") ? Number(f.get("tickSize")) : null,
      contractMultiplier: f.get("contractMultiplier") ? Number(f.get("contractMultiplier")) : null,
      expiry: String(f.get("expiry") || "") || null,
      isActive: f.get("isActive") === "on",
      description: String(f.get("description") || "") || null,
    };

    const done = () => {
      qc.invalidateQueries({ queryKey: getListInstrumentsQueryKey() });
      qc.invalidateQueries({ queryKey: getGetMarketDataSummaryQueryKey() });
      qc.invalidateQueries({ queryKey: getListMarketsQueryKey() }); // Legacy cache refresh
      qc.invalidateQueries({ queryKey: getListSourceInstrumentMappingsQueryKey() });
      setModal(false);
    };

    if (modal && typeof modal === "object") {
      update.mutate({ instrumentId: modal.id, data }, { onSuccess: done });
    } else {
      create.mutate({ data }, { onSuccess: done });
    }
  };

  if (q.isLoading) return <LoadingBlock />;
  if (q.isError) return <ErrorBlock retry={() => q.refetch()} />;

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-3 text-muted-foreground" />
          <input className="input pl-9" placeholder="Search instruments by symbol or class" value={search} onChange={e => setSearch(e.target.value)} data-testid="input-search-instruments" />
        </div>
        <button className="btn btn-primary" onClick={() => setModal(null)} data-testid="button-create-instrument">
          <Plus size={14} /> Add instrument
        </button>
      </div>

      {!rows.length ? (
        <EmptyState icon={BarChart3} title="No instruments found" text="Build the catalog of instruments you intend to track or trade." />
      ) : (
        <div className="panel table-wrap">
          <table>
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Type / Class</th>
                <th>Details</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(i => (
                <tr key={i.id} data-testid={`row-instrument-${i.id}`}>
                  <td>
                    <div className="font-bold mono text-sm">{i.symbol}</div>
                    <div className="text-xs text-muted-foreground mt-1">{i.displayName || "No label"}</div>
                  </td>
                  <td>
                    <span className="tag tag-active">{i.instrumentType}</span>
                    <div className="text-xs text-muted-foreground mt-1">{i.assetClass}</div>
                  </td>
                  <td className="text-[11px] text-muted-foreground max-w-xs truncate">
                    {i.venue && <span>Venue: {i.venue}<br /></span>}
                    {i.baseCurrency && i.quoteCurrency && <span>{i.baseCurrency}/{i.quoteCurrency}<br /></span>}
                    {i.tickSize && <span>Tick: {i.tickSize}</span>}
                    {(!i.venue && !i.baseCurrency && !i.tickSize) && "—"}
                  </td>
                  <td>
                    <span className={`tag ${i.isActive ? 'tag-open' : 'tag-archived'}`}>{i.isActive ? "Active" : "Inactive"}</span>
                  </td>
                  <td>
                    <div className="flex justify-end gap-1">
                      <button type="button" className="btn btn-ghost" onClick={() => setModal(i)} data-testid={`button-edit-instrument-${i.id}`}><Pencil size={14} /></button>
                      <button type="button" className="btn btn-ghost text-destructive" onClick={() => setConfirm(i)} data-testid={`button-delete-instrument-${i.id}`}><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal !== false && (
        <Modal title={modal && typeof modal === "object" ? "Edit instrument" : "Add instrument"} onClose={() => setModal(false)}>
          <form onSubmit={save} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Symbol"><input className="input mono uppercase" name="symbol" required defaultValue={modal && typeof modal === "object" ? modal.symbol : ""} placeholder="e.g. AAPL" /></Field>
              <Field label="Display name"><input className="input" name="displayName" defaultValue={modal && typeof modal === "object" ? modal.displayName || "" : ""} placeholder="Optional" /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Type">
                <select className="select" name="instrumentType" defaultValue={modal && typeof modal === "object" ? modal.instrumentType : "stock"}>
                  <option value="future">Future</option>
                  <option value="forex">Forex</option>
                  <option value="stock">Stock</option>
                  <option value="index">Index</option>
                  <option value="commodity">Commodity</option>
                  <option value="crypto">Crypto</option>
                  <option value="other">Other</option>
                </select>
              </Field>
              <Field label="Asset class"><input className="input" name="assetClass" required defaultValue={modal && typeof modal === "object" ? modal.assetClass : ""} placeholder="e.g. Equities" /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Venue"><input className="input" name="venue" defaultValue={modal && typeof modal === "object" ? modal.venue || "" : ""} placeholder="e.g. NASDAQ" /></Field>
              <Field label="Timezone"><input className="input" name="exchangeTimezone" defaultValue={modal && typeof modal === "object" ? modal.exchangeTimezone || "" : ""} placeholder="e.g. America/New_York" /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Base currency"><input className="input" name="baseCurrency" defaultValue={modal && typeof modal === "object" ? modal.baseCurrency || "" : ""} placeholder="e.g. USD" /></Field>
              <Field label="Quote currency"><input className="input" name="quoteCurrency" defaultValue={modal && typeof modal === "object" ? modal.quoteCurrency || "" : ""} placeholder="e.g. USD" /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Tick size"><input className="input" type="number" step="any" name="tickSize" defaultValue={modal && typeof modal === "object" ? modal.tickSize || "" : ""} /></Field>
              <Field label="Multiplier"><input className="input" type="number" step="any" name="contractMultiplier" defaultValue={modal && typeof modal === "object" ? modal.contractMultiplier || "" : ""} /></Field>
            </div>
            <Field label="Contract expiry" hint="Optional provider-neutral contract label, such as 2026-12."><input className="input" name="expiry" defaultValue={modal && typeof modal === "object" ? modal.expiry || "" : ""} placeholder="Optional" /></Field>
            <Field label="Description"><textarea className="textarea" name="description" defaultValue={modal && typeof modal === "object" ? modal.description || "" : ""} placeholder="Your notes about this instrument" /></Field>
            <div className="flex items-center gap-3 pt-2 pb-2">
              <input type="checkbox" name="isActive" id="inst-active" defaultChecked={modal && typeof modal === "object" ? modal.isActive : true} className="w-4 h-4 accent-primary" />
              <label htmlFor="inst-active" className="text-sm cursor-pointer">Active</label>
            </div>
            <button className="btn btn-primary w-full" disabled={create.isPending || update.isPending}>{create.isPending || update.isPending ? "Saving…" : "Save instrument"}</button>
          </form>
        </Modal>
      )}

      {confirm && (
        <Confirm
          title="Remove instrument"
          text={`Delete ${confirm.symbol}? This cannot be undone.`}
          busy={del.isPending}
          onCancel={() => setConfirm(null)}
          onConfirm={() => del.mutate({ instrumentId: confirm.id }, {
            onSuccess: () => {
              setConfirm(null);
              qc.invalidateQueries({ queryKey: getListInstrumentsQueryKey() });
              qc.invalidateQueries({ queryKey: getGetMarketDataSummaryQueryKey() });
              qc.invalidateQueries({ queryKey: getListMarketsQueryKey() });
              qc.invalidateQueries({ queryKey: getListSourceInstrumentMappingsQueryKey() });
            }
          })}
        />
      )}
    </div>
  );
}

// SOURCES
function SourcesTab() {
  const q = useListMarketDataSources();
  const create = useCreateMarketDataSource();
  const update = useUpdateMarketDataSource();
  const del = useDeleteMarketDataSource();
  const qc = useQueryClient();
  const [modal, setModal] = useState<MarketDataSource | null | false>(false);
  const [confirm, setConfirm] = useState<MarketDataSource | null>(null);

  const save = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const caps = Array.from(f.getAll("capabilities")) as Array<"realtime" | "candles" | "historical" | "sessions">;
    const data: any = {
      name: String(f.get("name")),
      providerKey: String(f.get("providerKey") || "") || null,
      sourceType: String(f.get("sourceType")),
      description: String(f.get("description") || "") || null,
      capabilities: caps,
      configurationStatus: String(f.get("configurationStatus") || "not_configured"),
      isEnabled: f.get("isEnabled") === "on"
    };

    const done = () => {
      qc.invalidateQueries({ queryKey: getListMarketDataSourcesQueryKey() });
      qc.invalidateQueries({ queryKey: getListMarketDataConnectionsQueryKey() });
      qc.invalidateQueries({ queryKey: getGetMarketDataSummaryQueryKey() });
      qc.invalidateQueries({ queryKey: getListSourceInstrumentMappingsQueryKey() });
      setModal(false);
    };

    if (modal && typeof modal === "object") {
      update.mutate({ sourceId: modal.id, data }, { onSuccess: done });
    } else {
      create.mutate({ data }, { onSuccess: done });
    }
  };

  if (q.isLoading) return <LoadingBlock />;
  if (q.isError) return <ErrorBlock retry={() => q.refetch()} />;
  const rows = q.data || [];

  return (
    <div className="space-y-5">
      <div className="flex justify-between gap-3">
        <h2 className="font-semibold self-center">Market Data Sources</h2>
        <button className="btn btn-primary" onClick={() => setModal(null)} data-testid="button-create-source"><Plus size={14} /> Add source</button>
      </div>

      {!rows.length ? (
        <EmptyState icon={Database} title="No sources defined" text="Configure placeholders for data providers or file sources." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {rows.map(s => (
            <div className="panel panel-hover p-5" key={s.id} data-testid={`card-source-${s.id}`}>
              <div className="flex justify-between items-start">
                <div>
                  <span className={`tag ${s.isEnabled ? 'tag-open' : 'tag-archived'}`}>{s.isEnabled ? "Enabled" : "Disabled"}</span>
                  <div className="font-semibold text-lg mt-2">{s.name}</div>
                  <div className="text-[11px] mono text-muted-foreground mt-1">TYPE: {s.sourceType}</div>
                </div>
                <div className="flex">
                  <button type="button" className="btn btn-ghost" onClick={() => setModal(s)}><Pencil size={13} /></button>
                  <button type="button" className="btn btn-ghost text-destructive" onClick={() => setConfirm(s)}><Trash2 size={13} /></button>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-border">
                <div className="eyebrow mb-2">Capabilities</div>
                <div className="flex flex-wrap gap-1">
                  {s.capabilities.map(c => <span key={c} className="tag tag-draft lowercase">{c}</span>)}
                  {s.capabilities.length === 0 && <span className="text-xs text-muted-foreground">None defined</span>}
                </div>
              </div>
              <div className="mt-4 text-xs text-muted-foreground flex items-center gap-1.5">
                {s.configurationStatus === 'configured' ? <CheckCircleIcon className="text-primary"/> : <AlertTriangle size={13} className="text-accent" />}
                {s.configurationStatus.replace('_', ' ')}
              </div>
            </div>
          ))}
        </div>
      )}

      {modal !== false && (
        <Modal title={modal && typeof modal === "object" ? "Edit data source" : "Add data source"} onClose={() => setModal(false)}>
          <form onSubmit={save} className="space-y-4">
            <div className="p-3 mb-4 rounded-md bg-secondary/50 text-xs text-muted-foreground flex items-start gap-2">
              <ShieldAlert size={14} className="mt-0.5 shrink-0" />
              Do not enter real API keys or secrets here. This form is for cataloging and routing source configurations.
            </div>
            <Field label="Name"><input className="input" name="name" required defaultValue={modal && typeof modal === "object" ? modal.name : ""} placeholder="e.g. Polygon.io Data" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Type">
                <select className="select" name="sourceType" defaultValue={modal && typeof modal === "object" ? modal.sourceType : "rest"}>
                  <option value="rest">REST API</option>
                  <option value="websocket">WebSocket</option>
                  <option value="file">Local File</option>
                  <option value="other">Other</option>
                </select>
              </Field>
              <Field label="Internal Provider Key"><input className="input mono" name="providerKey" defaultValue={modal && typeof modal === "object" ? modal.providerKey || "" : ""} placeholder="e.g. polygon_api" /></Field>
            </div>
            <Field label="Description"><textarea className="textarea" name="description" defaultValue={modal && typeof modal === "object" ? modal.description || "" : ""} placeholder="What this future source is expected to provide" /></Field>
            
            <div className="pt-2 border-t border-border">
              <div className="label mb-2">Capabilities</div>
              <div className="grid grid-cols-2 gap-2">
                {['realtime', 'candles', 'historical', 'sessions'].map(c => (
                  <label key={c} className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" name="capabilities" value={c} defaultChecked={modal && typeof modal === "object" ? modal.capabilities.includes(c as any) : false} className="w-4 h-4 accent-primary" />
                    <span className="text-sm capitalize">{c}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border">
              <Field label="Config Status">
                <select className="select" name="configurationStatus" defaultValue={modal && typeof modal === "object" ? modal.configurationStatus : "not_configured"}>
                  <option value="not_configured">Not Configured</option>
                  <option value="configured">Configured</option>
                  <option value="disabled">Disabled</option>
                </select>
              </Field>
              <div className="flex items-center gap-2 pt-6">
                <input type="checkbox" name="isEnabled" id="src-enabled" defaultChecked={modal && typeof modal === "object" ? modal.isEnabled : true} className="w-4 h-4 accent-primary" />
                <label htmlFor="src-enabled" className="text-sm cursor-pointer font-semibold">Source enabled</label>
              </div>
            </div>

            <button className="btn btn-primary w-full" disabled={create.isPending || update.isPending}>{create.isPending || update.isPending ? "Saving…" : "Save source"}</button>
          </form>
        </Modal>
      )}

      {confirm && (
        <Confirm
          title="Remove source"
          text={`Delete ${confirm.name}? Future configurations will lose this reference.`}
          busy={del.isPending}
          onCancel={() => setConfirm(null)}
          onConfirm={() => del.mutate({ sourceId: confirm.id }, {
            onSuccess: () => {
              setConfirm(null);
              qc.invalidateQueries({ queryKey: getListMarketDataSourcesQueryKey() });
               qc.invalidateQueries({ queryKey: getListMarketDataConnectionsQueryKey() });
              qc.invalidateQueries({ queryKey: getGetMarketDataSummaryQueryKey() });
              qc.invalidateQueries({ queryKey: getListSourceInstrumentMappingsQueryKey() });
            }
          })}
        />
      )}
    </div>
  );
}

// TIMEFRAMES
function TimeframesTab() {
  const q = useListTimeframes();
  const create = useCreateTimeframe();
  const update = useUpdateTimeframe();
  const del = useDeleteTimeframe();
  const qc = useQueryClient();
  const [modal, setModal] = useState<Timeframe | null | false>(false);
  const [confirm, setConfirm] = useState<Timeframe | null>(null);

  const save = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const data: any = {
      code: String(f.get("code")),
      label: String(f.get("label")),
      durationSeconds: Number(f.get("durationSeconds")),
      description: String(f.get("description") || "") || null,
      isActive: f.get("isActive") === "on",
    };

    const done = () => {
      qc.invalidateQueries({ queryKey: getListTimeframesQueryKey() });
      qc.invalidateQueries({ queryKey: getGetMarketDataSummaryQueryKey() });
      setModal(false);
    };

    if (modal && typeof modal === "object") {
      update.mutate({ timeframeId: modal.id, data }, { onSuccess: done });
    } else {
      create.mutate({ data }, { onSuccess: done });
    }
  };

  if (q.isLoading) return <LoadingBlock />;
  if (q.isError) return <ErrorBlock retry={() => q.refetch()} />;
  const rows = q.data || [];

  return (
    <div className="space-y-5">
      <div className="flex justify-between gap-3">
        <h2 className="font-semibold self-center">Supported Timeframes</h2>
        <button className="btn btn-primary" onClick={() => setModal(null)} data-testid="button-create-timeframe"><Plus size={14} /> Add timeframe</button>
      </div>

      {!rows.length ? (
        <EmptyState icon={Clock} title="No timeframes" text="Define standard durations like 1D, 4H, 15M." />
      ) : (
        <div className="panel table-wrap">
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Label</th>
                <th>Duration (sec)</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(t => (
                <tr key={t.id} data-testid={`row-timeframe-${t.id}`}>
                  <td className="font-bold mono">{t.code}</td>
                  <td>{t.label}</td>
                  <td className="mono">{t.durationSeconds}</td>
                  <td><span className={`tag ${t.isActive ? 'tag-open' : 'tag-archived'}`}>{t.isActive ? "Active" : "Inactive"}</span></td>
                  <td>
                    <div className="flex justify-end gap-1">
                      <button type="button" className="btn btn-ghost" onClick={() => setModal(t)}><Pencil size={14} /></button>
                      <button type="button" className="btn btn-ghost text-destructive" onClick={() => setConfirm(t)}><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal !== false && (
        <Modal title={modal && typeof modal === "object" ? "Edit timeframe" : "Add timeframe"} onClose={() => setModal(false)}>
          <form onSubmit={save} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Code"><input className="input mono" name="code" required defaultValue={modal && typeof modal === "object" ? modal.code : ""} placeholder="e.g. 1H" /></Field>
              <Field label="Label"><input className="input" name="label" required defaultValue={modal && typeof modal === "object" ? modal.label : ""} placeholder="e.g. 1 Hour" /></Field>
            </div>
            <Field label="Duration in seconds" hint="e.g. 3600 for 1 Hour">
              <input className="input mono" type="number" name="durationSeconds" required min={1} defaultValue={modal && typeof modal === "object" ? modal.durationSeconds : ""} />
            </Field>
            <Field label="Description"><textarea className="textarea" name="description" defaultValue={modal && typeof modal === "object" ? modal.description || "" : ""} placeholder="Optional timeframe notes" /></Field>
            <div className="flex items-center gap-2 pt-2">
              <input type="checkbox" name="isActive" id="tf-active" defaultChecked={modal && typeof modal === "object" ? modal.isActive : true} className="w-4 h-4 accent-primary" />
              <label htmlFor="tf-active" className="text-sm cursor-pointer">Active</label>
            </div>
            <button className="btn btn-primary w-full" disabled={create.isPending || update.isPending}>{create.isPending || update.isPending ? "Saving…" : "Save timeframe"}</button>
          </form>
        </Modal>
      )}

      {confirm && (
        <Confirm
          title="Remove timeframe"
          text={`Delete ${confirm.code}?`}
          busy={del.isPending}
          onCancel={() => setConfirm(null)}
          onConfirm={() => del.mutate({ timeframeId: confirm.id }, {
            onSuccess: () => {
              setConfirm(null);
              qc.invalidateQueries({ queryKey: getListTimeframesQueryKey() });
              qc.invalidateQueries({ queryKey: getGetMarketDataSummaryQueryKey() });
            }
          })}
        />
      )}
    </div>
  );
}

// CONNECTIONS
function ConnectionsTab() {
  const q = useListMarketDataConnections();
  
  if (q.isLoading) return <LoadingBlock />;
  if (q.isError) return <ErrorBlock retry={() => q.refetch()} />;
  const rows = q.data || [];

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-semibold">Connection Status</h2>
        <p className="text-xs text-muted-foreground mt-1 max-w-xl">Inspect connection states reported by provider adapters. No adapter is connected in Step 5.</p>
      </div>

      {!rows.length ? (
        <EmptyState icon={Network} title="No active connections" text="No data source adapters are currently communicating with this workspace." />
      ) : (
        <div className="panel table-wrap">
          <table>
            <thead>
              <tr>
                <th>Source</th>
                <th>Status</th>
                <th>Last Connected</th>
                <th>Last Data</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(c => (
                <tr key={c.id}>
                  <td className="font-bold">{c.sourceName}</td>
                  <td>
                    <span className={`tag ${c.status === 'connected' ? 'tag-open' : c.status === 'error' ? 'tag-archived !text-destructive !bg-destructive/10' : 'tag-draft'}`}>
                      {c.status}
                    </span>
                    {c.statusMessage && <div className="text-[10px] text-muted-foreground mt-1 max-w-xs truncate">{c.statusMessage}</div>}
                  </td>
                  <td className="text-xs text-muted-foreground mono">{c.lastConnectedAt ? new Date(c.lastConnectedAt).toLocaleString() : "—"}</td>
                  <td className="text-xs text-muted-foreground mono">{c.lastDataAt ? new Date(c.lastDataAt).toLocaleString() : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// CANDLES
function CandlesTab() {
  const instruments = useListInstruments();
  const timeframes = useListTimeframes();
  
  const [instId, setInstId] = useState<number | "">("");
  const [tfId, setTfId] = useState<number | "">("");
  const [limit, setLimit] = useState(100);

  const ready = instId !== "" && tfId !== "";
  
  const q = useListCandles(
    { instrumentId: Number(instId), timeframeId: Number(tfId), limit },
    { query: { enabled: ready, queryKey: getListCandlesQueryKey({ instrumentId: Number(instId), timeframeId: Number(tfId), limit }) } }
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h2 className="font-semibold">Candle Availability</h2>
          <p className="text-xs text-muted-foreground mt-1">Inspect stored OHLC data currently in the workspace database.</p>
        </div>
      </div>

      <div className="panel p-4 flex flex-wrap gap-4 items-end">
        <div className="flex-1 min-w-[200px]">
          <span className="label">Instrument</span>
          <select className="select" value={instId} onChange={e => setInstId(e.target.value ? Number(e.target.value) : "")}>
            <option value="">Select instrument…</option>
            {(instruments.data || []).map(i => <option key={i.id} value={i.id}>{i.symbol} — {i.displayName || i.assetClass}</option>)}
          </select>
        </div>
        <div className="w-48">
          <span className="label">Timeframe</span>
          <select className="select" value={tfId} onChange={e => setTfId(e.target.value ? Number(e.target.value) : "")}>
            <option value="">Select timeframe…</option>
            {(timeframes.data || []).map(t => <option key={t.id} value={t.id}>{t.code}</option>)}
          </select>
        </div>
        <div className="w-32">
          <span className="label">Rows</span>
          <select className="select" value={limit} onChange={e => setLimit(Number(e.target.value))}>
            <option value={100}>100</option>
            <option value={500}>500</option>
            <option value={1000}>1000</option>
          </select>
        </div>
      </div>

      {instruments.isError || timeframes.isError ? (
        <ErrorBlock retry={() => { instruments.refetch(); timeframes.refetch(); }} />
      ) : !ready ? (
        <div className="panel p-10 text-center text-sm text-muted-foreground">Select an instrument and timeframe to view candles.</div>
      ) : q.isLoading ? (
        <LoadingBlock />
      ) : q.isError ? (
        <ErrorBlock retry={() => q.refetch()} />
      ) : !q.data?.length ? (
        <EmptyState icon={DatabaseZap} title="No candles stored" text="No candle data exists for this specific instrument and timeframe combination." />
      ) : (
        <div className="panel table-wrap max-h-[600px] overflow-y-auto relative">
          <table className="relative">
            <thead className="sticky top-0 bg-[hsl(var(--card))] z-10 shadow-[0_1px_0_hsl(var(--border))]">
              <tr>
                <th>Open Time</th>
                <th className="text-right">Open</th>
                <th className="text-right">High</th>
                <th className="text-right">Low</th>
                <th className="text-right">Close</th>
                <th className="text-right">Volume</th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((c: Candle) => (
                <tr key={c.id} className="hover:bg-secondary/40">
                  <td className="mono text-xs">{new Date(c.openTime).toLocaleString()}</td>
                  <td className="mono text-right">{c.open.toFixed(4)}</td>
                  <td className="mono text-right text-primary">{c.high.toFixed(4)}</td>
                  <td className="mono text-right text-destructive">{c.low.toFixed(4)}</td>
                  <td className="mono text-right font-semibold">{c.close.toFixed(4)}</td>
                  <td className="mono text-right text-muted-foreground">{c.volume?.toFixed(2) || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// MAPPINGS
function MappingsTab() {
  const q = useListSourceInstrumentMappings();
  const create = useCreateSourceInstrumentMapping();
  const update = useUpdateSourceInstrumentMapping();
  const del = useDeleteSourceInstrumentMapping();
  const qc = useQueryClient();
  const instruments = useListInstruments();
  const sources = useListMarketDataSources();
  const [modal, setModal] = useState<SourceInstrumentMapping | null | false>(false);
  const [confirm, setConfirm] = useState<SourceInstrumentMapping | null>(null);

  const save = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const data: any = {
      sourceId: Number(f.get("sourceId")),
      instrumentId: Number(f.get("instrumentId")),
      providerSymbol: String(f.get("providerSymbol")),
      providerMetadata: String(f.get("providerMetadata") || "") || null,
    };

    const done = () => {
      qc.invalidateQueries({ queryKey: getListSourceInstrumentMappingsQueryKey() });
      setModal(false);
    };

    if (modal && typeof modal === "object") {
      update.mutate({ mappingId: modal.id, data }, { onSuccess: done });
    } else {
      create.mutate({ data }, { onSuccess: done });
    }
  };

  if (q.isLoading || instruments.isLoading || sources.isLoading) return <LoadingBlock />;
  const rows = q.data || [];

  return (
    <div className="space-y-5">
      <div className="flex justify-between gap-3">
        <div>
          <h2 className="font-semibold self-center">Provider Symbol Mappings</h2>
          <p className="text-xs text-muted-foreground mt-1 max-w-xl">Map your neutral instrument symbols to the exact strings expected by external data sources.</p>
        </div>
        <button className="btn btn-primary h-fit" onClick={() => setModal(null)} data-testid="button-create-mapping"><Plus size={14} /> Add mapping</button>
      </div>

      {!rows.length ? (
        <EmptyState icon={Link2} title="No mappings defined" text="Define how a future adapter will translate a canonical instrument into its provider-specific symbol." />
      ) : (
        <div className="panel table-wrap">
          <table>
            <thead>
              <tr>
                <th>Data Source</th>
                <th>Instrument</th>
                <th>Provider Symbol</th>
                <th>Metadata</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(m => (
                <tr key={m.id} data-testid={`row-mapping-${m.id}`}>
                  <td className="font-semibold">{m.sourceName}</td>
                  <td className="mono">{m.instrumentSymbol}</td>
                  <td className="font-bold mono text-primary">{m.providerSymbol}</td>
                  <td className="text-xs text-muted-foreground truncate max-w-[150px]">{m.providerMetadata || "—"}</td>
                  <td>
                    <div className="flex justify-end gap-1">
                      <button type="button" className="btn btn-ghost" onClick={() => setModal(m)}><Pencil size={14} /></button>
                      <button type="button" className="btn btn-ghost text-destructive" onClick={() => setConfirm(m)}><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal !== false && (
        <Modal title={modal && typeof modal === "object" ? "Edit mapping" : "Add mapping"} onClose={() => setModal(false)}>
          <form onSubmit={save} className="space-y-4">
            <div className="p-3 mb-4 rounded-md bg-secondary/50 text-xs text-muted-foreground flex items-start gap-2">
              <Info size={14} className="mt-0.5 shrink-0" />
              These aliases are strictly configuration for future adapters. No provider is currently connected.
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Data Source">
                <select className="select" name="sourceId" required defaultValue={modal && typeof modal === "object" ? modal.sourceId : ""}>
                  <option value="" disabled>Select source…</option>
                  {(sources.data || []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
              <Field label="Instrument">
                <select className="select" name="instrumentId" required defaultValue={modal && typeof modal === "object" ? modal.instrumentId : ""}>
                  <option value="" disabled>Select instrument…</option>
                  {(instruments.data || []).map(i => <option key={i.id} value={i.id}>{i.symbol} — {i.displayName || i.assetClass}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Provider Symbol" hint="The exact string expected by this specific source API.">
              <input className="input mono" name="providerSymbol" required defaultValue={modal && typeof modal === "object" ? modal.providerSymbol : ""} placeholder="e.g. X:BTCUSD" />
            </Field>
            <Field label="Provider Metadata" hint="Optional JSON or ID string for deeper provider requirements.">
              <input className="input mono" name="providerMetadata" defaultValue={modal && typeof modal === "object" ? modal.providerMetadata || "" : ""} placeholder="e.g. { 'exchange': 'BINANCE' }" />
            </Field>

            <button className="btn btn-primary w-full" disabled={create.isPending || update.isPending}>{create.isPending || update.isPending ? "Saving…" : "Save mapping"}</button>
          </form>
        </Modal>
      )}

      {confirm && (
        <Confirm
          title="Remove mapping"
          text={`Delete mapping for ${confirm.instrumentSymbol} on ${confirm.sourceName}?`}
          busy={del.isPending}
          onCancel={() => setConfirm(null)}
          onConfirm={() => del.mutate({ mappingId: confirm.id }, {
            onSuccess: () => {
              setConfirm(null);
              qc.invalidateQueries({ queryKey: getListSourceInstrumentMappingsQueryKey() });
            }
          })}
        />
      )}
    </div>
  );
}

function CheckCircleIcon(props: any) {
  return <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>;
}
