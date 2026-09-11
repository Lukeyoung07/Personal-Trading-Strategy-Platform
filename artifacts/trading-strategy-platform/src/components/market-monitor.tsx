import { useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent, type WheelEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  BarChart3, Database, Globe, Network, Clock, DatabaseZap, Search, Plus, Check,
  Pencil, Trash2, X, Info, Activity, AlertTriangle, FileText, Settings2, ShieldAlert, Link2,
  Radio, RefreshCw, WifiOff, CandlestickChart, ChevronLeft, ChevronRight, Maximize2, ZoomIn, ZoomOut
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
  useGetBiQuoteCatalog, useAddBiQuoteMarket,
  useListEconomicEvents, getListEconomicEventsQueryKey,
  useCreateAlert, getListAlertsQueryKey,
  type Instrument, type MarketDataSource, type Timeframe, type MarketDataConnection, type Candle, type MarketDataSummary, type SourceInstrumentMapping, type BiQuoteCatalogItem, type BiQuoteMarketResult, type EconomicEvent
} from "@workspace/api-client-react";

type Tab = "live-chart" | "instruments" | "sources" | "mappings" | "timeframes" | "connections" | "candles";
const MARKET_SELECTION_STORAGE_KEY = "market-monitor-selection";
const MARKET_CATEGORIES = ["Futures", "Forex", "Stocks", "Indices", "Commodities", "Crypto"] as const;
type MarketCategory = typeof MARKET_CATEGORIES[number];
const CATEGORY_ASSET_CLASSES: Record<MarketCategory, BiQuoteCatalogItem["assetClass"] | null> = {
  Futures: null,
  Forex: "Forex",
  Stocks: "Stock",
  Indices: "Index",
  Commodities: "Commodity",
  Crypto: "Crypto",
};

function catalogMarketName(item: BiQuoteCatalogItem) {
  return item.description?.trim() || item.displayName || item.providerSymbol;
}

function readSavedMarketSelection() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(MARKET_SELECTION_STORAGE_KEY) ?? "null");
    return {
      instrumentId: typeof saved?.instrumentId === "number" ? saved.instrumentId : null,
      timeframeId: typeof saved?.timeframeId === "number" ? saved.timeframeId : null,
    };
  } catch {
    return { instrumentId: null, timeframeId: null };
  }
}

function saveMarketSelection(instrumentId: number | "", timeframeId: number | "") {
  if (instrumentId === "" || timeframeId === "") return;
  window.localStorage.setItem(MARKET_SELECTION_STORAGE_KEY, JSON.stringify({ instrumentId, timeframeId }));
}

export function MarketMonitor() {
  const [tab, setTab] = useState<Tab>("live-chart");
  const summary = useGetMarketDataSummary();
  const sumData = summary.data;

  return (
    <div className="page-wrap">
      <div className="page-heading flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-4">
        <div>
          <div className="eyebrow mb-2">Markets</div>
          <h1 className="display text-2xl md:text-3xl font-bold">Market workspace</h1>
          <p className="text-muted-foreground text-xs mt-2 max-w-2xl leading-relaxed">
            Real BiQuote prices and historical candles. No signals, recommendations, or execution.
          </p>
        </div>
      </div>

      <div className="panel p-1 flex overflow-x-auto gap-1 mb-5">
        <TabButton current={tab} id="live-chart" icon={CandlestickChart} label="Live Chart" onClick={setTab} />
         <TabButton current={tab} id="instruments" icon={Plus} label="Add Market" onClick={setTab} />
      </div>

      {tab === "live-chart" && <LiveChartTab onAddMarket={() => setTab("instruments")} />}
      {tab === "instruments" && <AddMarketTab onAdded={(result) => {
        saveMarketSelection(result.instrument.id, result.timeframe.id);
        setTab("live-chart");
      }} />}

      <details className="panel market-context-panel">
        <summary className="market-context-summary">
          <span>
            <span className="eyebrow">Data coverage</span>
            <span className="block text-sm font-semibold mt-1">Provider and storage context</span>
          </span>
          <span className="text-xs text-muted-foreground">View details</span>
        </summary>
        <div className="px-4 pb-4 md:px-5 md:pb-5">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="Instruments" value={sumData?.instrumentCount ?? 0} icon={BarChart3} />
            <Stat label="Data Sources" value={sumData?.sourceCount ?? 0} icon={Database} sub={`${sumData?.connectedSourceCount ?? 0} connected`} />
            <Stat label="Timeframes" value={sumData?.timeframeCount ?? 0} icon={Clock} />
            <Stat label="Stored Candles" value={sumData?.candleCount ?? 0} icon={DatabaseZap} sub={sumData?.latestDataAt ? `Latest: ${new Date(sumData.latestDataAt).toLocaleDateString()}` : "No data yet"} />
          </div>
          <div className="rounded-md bg-secondary/45 p-4 mt-4">
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
        </div>
      </details>
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

type ChartBar = {
  openTime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  isClosed: boolean;
};

type IndicatorKind = "sma20" | "ema20";

function formatPrice(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? "—" : value.toFixed(5);
}

function formatTimeAxisLabel(openTime: string, spanMs: number) {
  const date = new Date(openTime);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, spanMs >= 24 * 60 * 60 * 1000
    ? { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }
    : { hour: "numeric", minute: "2-digit" }).format(date);
}

function movingAverage(bars: ChartBar[], period: number, exponential: boolean) {
  const values: Array<number | null> = [];
  let previous: number | null = null;
  bars.forEach((bar, index) => {
    if (index < period - 1) {
      values.push(null);
      return;
    }
    if (exponential) {
      const alpha = 2 / (period + 1);
      previous = previous == null
        ? bars.slice(index - period + 1, index + 1).reduce((sum, item) => sum + item.close, 0) / period
        : (bar.close - previous) * alpha + previous;
      values.push(previous);
    } else {
      values.push(bars.slice(index - period + 1, index + 1).reduce((sum, item) => sum + item.close, 0) / period);
    }
  });
  return values;
}

function LiveChartTab({ onAddMarket }: { onAddMarket: () => void }) {
  const instruments = useListInstruments();
  const sources = useListMarketDataSources();
  const timeframes = useListTimeframes();
  const refresh = useRefreshMarketDataCandles();
  const qc = useQueryClient();
  const [sourceId, setSourceId] = useState<number | "">("");
  const [instrumentId, setInstrumentId] = useState<number | "">("");
  const [timeframeId, setTimeframeId] = useState<number | "">("");
  const [marketSearch, setMarketSearch] = useState("");
  const [indicators, setIndicators] = useState<IndicatorKind[]>([]);
  const [drawingPrice, setDrawingPrice] = useState<number | null>(null);
  const [workspaceTab, setWorkspaceTab] = useState<"overview" | "indicators" | "drawings" | "alerts">("overview");
  const [alertCondition, setAlertCondition] = useState<"above" | "below">("above");
  const [alertThreshold, setAlertThreshold] = useState("");
  const [alertName, setAlertName] = useState("");
  const [alertSaved, setAlertSaved] = useState("");
  const [streamStatus, setStreamStatus] = useState<StreamStatus>({
    state: "disconnected",
    message: "Select an instrument to connect.",
    lastDataAt: null,
  });
  const [quote, setQuote] = useState<LiveQuote | null>(null);
  const [formingCandle, setFormingCandle] = useState<FormingCandle | null>(null);
  const autoRefreshKey = useRef<string | null>(null);
  const createAlert = useCreateAlert();

  useEffect(() => {
    if (sourceId === "" && sources.data?.length) {
      const biquote = sources.data.find(source => source.providerKey === "biquote") ?? sources.data[0];
      setSourceId(biquote.id);
    }
  }, [sourceId, sources.data]);
  useEffect(() => {
    if (!instruments.data?.length) {
      setInstrumentId(previous => previous === "" ? previous : "");
      setTimeframeId(previous => previous === "" ? previous : "");
      window.localStorage.removeItem(MARKET_SELECTION_STORAGE_KEY);
    }
  }, [instruments.data]);
  useEffect(() => {
    if (instrumentId !== "" || !instruments.data?.length) return;
    const saved = readSavedMarketSelection();
    setInstrumentId(
      saved.instrumentId != null && instruments.data.some(item => item.id === saved.instrumentId)
        ? saved.instrumentId
        : instruments.data[0].id,
    );
  }, [instrumentId, instruments.data]);
  useEffect(() => {
    if (timeframeId !== "" || !timeframes.data?.length) return;
    const saved = readSavedMarketSelection();
    const savedTimeframe = saved.timeframeId != null
      ? timeframes.data.find(timeframe => timeframe.id === saved.timeframeId && timeframe.isActive)
      : undefined;
    const hourly = timeframes.data.find(timeframe => timeframe.code === "1h" && timeframe.isActive)
      ?? timeframes.data.find(timeframe => timeframe.isActive)
      ?? timeframes.data[0];
    setTimeframeId(savedTimeframe?.id ?? hourly.id);
  }, [timeframeId, timeframes.data]);

  useEffect(() => {
    saveMarketSelection(instrumentId, timeframeId);
  }, [instrumentId, timeframeId]);

  useEffect(() => {
    setDrawingPrice(null);
    setAlertSaved("");
  }, [instrumentId, timeframeId]);

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
    if (!ready || candles.isLoading || candles.isError || (candles.data?.length ?? 0) > 0) return;
    const key = `${sourceId}:${instrumentId}:${timeframeId}`;
    if (autoRefreshKey.current === key) return;
    autoRefreshKey.current = key;
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
  }, [candles.data, candles.isError, candles.isLoading, instrumentId, qc, ready, refresh, sourceId, timeframeId]);

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

  const connectionLabel = streamStatus.state !== "connected"
    ? streamStatus.state.toUpperCase()
    : quote?.marketState === "closed"
      ? "MARKET CLOSED"
      : quote?.stale
        ? "STALE"
        : quote?.isLive
          ? "LIVE"
          : "CONNECTED";
  const isLive = connectionLabel === "LIVE";
  const source = sources.data?.find(item => item.id === sourceId);
  const selectedInstrument = instruments.data?.find(item => item.id === instrumentId);
  const filteredInstruments = useMemo(() => {
    const query = marketSearch.trim().toLowerCase();
    if (!query) return instruments.data ?? [];
    return (instruments.data ?? []).filter(instrument =>
      `${instrument.symbol} ${instrument.displayName ?? ""} ${instrument.assetClass}`.toLowerCase().includes(query),
    );
  }, [instruments.data, marketSearch]);
  const latestBar = chartBars[chartBars.length - 1];
  const previousBar = chartBars.length > 1 ? chartBars[chartBars.length - 2] : undefined;
  const currentPrice = quote?.last ?? latestBar?.close ?? null;
  const priceChange = currentPrice != null && previousBar?.close != null ? currentPrice - previousBar.close : null;
  const priceChangePercent = priceChange != null && previousBar?.close ? (priceChange / previousBar.close) * 100 : null;
  const loadedHigh = chartBars.length ? Math.max(...chartBars.map(bar => bar.high)) : null;
  const loadedLow = chartBars.length ? Math.min(...chartBars.map(bar => bar.low)) : null;
  const loadedOpen = chartBars[0]?.open ?? null;
  const activeTimeframes = (timeframes.data ?? []).filter(timeframe => timeframe.isActive);

  const submitPriceAlert = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedInstrument || !alertThreshold.trim()) return;
    createAlert.mutate({
      data: {
        name: alertName.trim() || `${selectedInstrument.symbol} price ${alertCondition}`,
        marketId: selectedInstrument.id,
        condition: alertCondition === "above" ? "Price above" : "Price below",
        threshold: alertThreshold.trim(),
        status: "active",
      },
    }, {
      onSuccess: () => {
        setAlertSaved(`Alert saved for ${selectedInstrument.symbol}.`);
        setAlertName("");
        setAlertThreshold("");
        qc.invalidateQueries({ queryKey: getListAlertsQueryKey() });
      },
    });
  };

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
  if (!instruments.data?.length) {
    return (
      <EmptyState
        icon={BarChart3}
        title="No markets added yet"
        text="Choose a supported BiQuote market to start watching genuine candles and live quotes."
        action={<button className="btn btn-primary" onClick={onAddMarket}><Plus size={14} /> Add Market</button>}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="panel market-terminal-header p-4 md:p-5">
        <div className="market-instrument-row">
          <div className="min-w-0">
            <div className="eyebrow mb-2">BiQuote market data</div>
            <h2 className="display text-2xl md:text-3xl font-bold truncate">{selectedInstrument?.symbol ?? "Select an instrument"}</h2>
            <p className="text-xs text-muted-foreground mt-1 truncate">{selectedInstrument?.displayName || selectedInstrument?.description || selectedInstrument?.assetClass || "Choose a configured market to inspect its provider record."}</p>
          </div>
          <div className="market-header-price">
            <div className="eyebrow">Last price</div>
            <div className="metric-value text-2xl mt-1">{formatPrice(currentPrice)}</div>
            <div className={`text-[11px] mt-1 ${priceChange == null ? "text-muted-foreground" : priceChange >= 0 ? "text-primary" : "text-destructive"}`}>
              {priceChange == null ? "Change unavailable" : `${priceChange >= 0 ? "+" : ""}${priceChange.toFixed(5)} (${priceChangePercent?.toFixed(2)}%)`}
            </div>
          </div>
          <div className="market-header-status">
            <span className={`tag ${isLive ? "tag-open" : connectionLabel === "MARKET CLOSED" || connectionLabel === "STALE" ? "tag-draft" : "tag-archived"}`}>
              {isLive ? <Radio size={11} className="mr-1" /> : <WifiOff size={11} className="mr-1" />}
              {connectionLabel}
            </span>
            <div className="text-[11px] text-muted-foreground mt-2">{streamStatus.message}</div>
          </div>
        </div>
        <div className="market-selector-row mt-4 pt-4 border-t border-border">
          <div className="min-w-0 flex-1">
            <span className="label">Instrument</span>
            <div className="market-select-search">
              <Search size={14} className="text-muted-foreground" aria-hidden="true" />
              <input
                className="market-search-input"
                value={marketSearch}
                onChange={event => setMarketSearch(event.target.value)}
                placeholder="Search symbol or market name…"
                aria-label="Search markets"
                data-testid="input-search-live-markets"
              />
            </div>
            <select className="select mt-2" value={instrumentId} onChange={event => setInstrumentId(event.target.value ? Number(event.target.value) : "")} data-testid="select-market-instrument">
              <option value="">Select instrument…</option>
              {filteredInstruments.map(instrument => <option key={instrument.id} value={instrument.id}>{instrument.symbol} — {instrument.displayName || instrument.assetClass}</option>)}
            </select>
          </div>
          <div className="market-timeframe-control">
            <span className="label">Timeframe</span>
            <div className="timeframe-buttons hidden sm:flex" role="group" aria-label="Market timeframe">
              {activeTimeframes.map(timeframe => (
                <button
                  key={timeframe.id}
                  type="button"
                  className={`timeframe-button ${timeframe.id === timeframeId ? "active" : ""}`}
                  onClick={() => setTimeframeId(timeframe.id)}
                  aria-pressed={timeframe.id === timeframeId}
                  data-testid={`button-timeframe-${timeframe.code}`}
                >
                  {timeframe.code}
                </button>
              ))}
            </div>
            <select className="select sm:hidden" value={timeframeId} onChange={event => setTimeframeId(event.target.value ? Number(event.target.value) : "")} data-testid="select-market-timeframe">
              <option value="">Select timeframe…</option>
              {activeTimeframes.map(timeframe => <option key={timeframe.id} value={timeframe.id}>{timeframe.code}</option>)}
            </select>
          </div>
        </div>
      </div>

      {refresh.isError && <div className="panel p-4 text-sm text-destructive">Candles could not be refreshed: {refresh.error instanceof Error ? refresh.error.message : "provider error"}</div>}

      <div className="market-workspace-grid">
        <div className="panel market-chart-panel p-4 md:p-5">
          <div className="chart-heading-row">
             <div><h2 className="font-semibold">BiQuote candlestick chart</h2><p className="text-xs text-muted-foreground mt-1">Stored OHLC bars plus a forming bar built only from received provider ticks.</p><p className="text-[11px] text-accent mt-2">Scroll to zoom · drag to pan · use the chart controls to scale and inspect.</p></div>
            <CandlestickChart size={18} className="text-primary shrink-0" />
          </div>
          <div className="chart-source-row">
            <div className="sm:w-52">
              <span className="label">Data source</span>
              <select className="select" value={sourceId} onChange={event => setSourceId(event.target.value ? Number(event.target.value) : "")} data-testid="select-market-source">
                <option value="">Select source…</option>
                {(sources.data ?? []).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </div>
            <button className="btn btn-secondary" onClick={refreshCandles} disabled={!ready || refresh.isPending} data-testid="button-refresh-market-candles">
              <RefreshCw size={14} className={refresh.isPending ? "animate-spin" : ""} />
              {refresh.isPending ? "Refreshing…" : "Refresh candles"}
            </button>
            <div className="text-[11px] text-muted-foreground sm:ml-auto sm:pb-2">{source?.name ?? "No source selected"} · {selectedTimeframe?.code ?? "—"}</div>
          </div>
          {candles.isError ? <ErrorBlock retry={() => candles.refetch()} /> : !ready ? <div className="p-10 text-center text-sm text-muted-foreground">Select an instrument, source, and timeframe to view genuine market data.</div> : candles.isLoading || refresh.isPending ? <LoadingBlock /> : !chartBars.length ? <EmptyState icon={CandlestickChart} title="No candle data yet" text="BiQuote did not return OHLC data for this instrument and timeframe. No substitute candles are shown." action={<button className="btn btn-primary" onClick={refreshCandles} disabled={refresh.isPending}>Request BiQuote candles</button>} /> : <CandleSvg bars={chartBars} currentPrice={currentPrice} indicators={indicators} drawingPrice={drawingPrice} drawingMode={workspaceTab === "drawings"} timeframeCode={selectedTimeframe?.code} onChartClickPrice={setDrawingPrice} />}
        </div>

        <aside className="space-y-4">
          <div className="panel market-overview-panel p-4">
            <div className="eyebrow mb-3">Market overview</div>
            <OverviewRow label="Current price" value={formatPrice(currentPrice)} mono />
            <OverviewRow label="Change" value={priceChange == null ? "Unavailable" : `${priceChange >= 0 ? "+" : ""}${priceChange.toFixed(5)}`} tone={priceChange == null ? undefined : priceChange >= 0 ? "positive" : "negative"} mono />
            <OverviewRow label="Loaded high" value={formatPrice(loadedHigh)} mono />
            <OverviewRow label="Loaded low" value={formatPrice(loadedLow)} mono />
            <OverviewRow label="Loaded open" value={formatPrice(loadedOpen)} mono />
            <OverviewRow label="Volume" value="Unavailable" />
            <OverviewRow label="Status" value={isLive ? "Open" : connectionLabel} tone={isLive ? "positive" : undefined} />
            <OverviewRow label="Source" value={source?.name ?? "Unavailable"} />
          </div>
          <div className="panel p-4">
            <div className="eyebrow mb-3">Quick actions</div>
            <div className="grid gap-2">
              <Link href="/trade-journal?record=1" className="btn btn-primary justify-center"><Plus size={14} /> Record trade</Link>
              <button className="btn btn-secondary justify-center" onClick={onAddMarket}><Plus size={14} /> Add another market</button>
            </div>
            <p className="text-[11px] text-muted-foreground mt-3">Market lists are provider-backed. No unsupported watchlist entries are created.</p>
          </div>
        </aside>
      </div>

      <div className="panel market-workspace-tabs">
        <div className="market-tab-list" role="tablist" aria-label="Market details">
          {([
            ["overview", "Overview"],
            ["indicators", "Indicators"],
            ["drawings", "Drawing tools"],
            ["alerts", "Price alerts"],
          ] as const).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={workspaceTab === id} className={`market-tab ${workspaceTab === id ? "active" : ""}`} onClick={() => setWorkspaceTab(id)}>{label}</button>
          ))}
        </div>
        <div className="p-4 md:p-5">
          {workspaceTab === "overview" && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="market-detail-card"><div className="eyebrow">Bid / ask</div><div className="mt-3 mono text-sm">{formatPrice(quote?.bid)} <span className="text-muted-foreground">/</span> {formatPrice(quote?.ask)}</div><div className="text-[11px] text-muted-foreground mt-2">Provider quote</div></div>
              <div className="market-detail-card"><div className="eyebrow">Last update</div><div className="mt-3 mono text-sm">{quote?.receivedAt ? new Date(quote.receivedAt).toLocaleTimeString() : "—"}</div><div className="text-[11px] text-muted-foreground mt-2">{quote?.quoteAgeSeconds != null ? `${quote.quoteAgeSeconds}s quote age` : "No timestamp yet"}</div></div>
              <div className="market-detail-card"><div className="eyebrow">Candles loaded</div><div className="metric-value mt-3">{chartBars.length}</div><div className="text-[11px] text-muted-foreground mt-2">{formingCandle ? "Includes live forming bar" : "Stored provider bars"}</div></div>
            </div>
          )}
          {workspaceTab === "indicators" && (
            <IndicatorPanel indicators={indicators} setIndicators={setIndicators} />
          )}
          {workspaceTab === "drawings" && (
            <DrawingPanel price={drawingPrice} currentPrice={currentPrice} onChange={setDrawingPrice} />
          )}
          {workspaceTab === "alerts" && selectedInstrument && (
            <form className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end" onSubmit={submitPriceAlert}>
              <Field label="Alert name"><input className="input" value={alertName} onChange={event => setAlertName(event.target.value)} placeholder={`${selectedInstrument.symbol} price check`} /></Field>
              <Field label="Condition"><select className="select" value={alertCondition} onChange={event => setAlertCondition(event.target.value as "above" | "below")}><option value="above">Price above</option><option value="below">Price below</option></select></Field>
              <Field label="Threshold"><input className="input" type="number" step="any" required value={alertThreshold} onChange={event => setAlertThreshold(event.target.value)} placeholder="e.g. 30000" /></Field>
              <button className="btn btn-primary" type="submit" disabled={createAlert.isPending}>{createAlert.isPending ? "Saving…" : "Create alert"}</button>
              {alertSaved && <div className="text-xs text-primary md:col-span-4">{alertSaved} Manage it from Alerts.</div>}
              {createAlert.isError && <div className="text-xs text-destructive md:col-span-4">The alert could not be saved. {createAlert.error instanceof Error ? createAlert.error.message : ""}</div>}
            </form>
          )}
          {workspaceTab === "alerts" && !selectedInstrument && <p className="text-sm text-muted-foreground">Select a market before creating a price alert.</p>}
        </div>
      </div>

      {selectedInstrument && <MarketEconomicEvents instrument={selectedInstrument} />}
    </div>
  );
}

function OverviewRow({ label, value, mono, tone }: { label: string; value: string; mono?: boolean; tone?: "positive" | "negative" }) {
  return (
    <div className="market-overview-row">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`${mono ? "mono" : ""} text-xs ${tone === "positive" ? "text-primary" : tone === "negative" ? "text-destructive" : "text-foreground"}`}>{value}</span>
    </div>
  );
}

function IndicatorPanel({ indicators, setIndicators }: { indicators: IndicatorKind[]; setIndicators: (next: IndicatorKind[]) => void }) {
  const toggle = (indicator: IndicatorKind) => {
    setIndicators(indicators.includes(indicator) ? indicators.filter(item => item !== indicator) : [...indicators, indicator]);
  };
  return (
    <div>
      <div className="flex flex-col gap-1 mb-4">
        <div className="eyebrow">Calculated from loaded candles</div>
        <p className="text-sm text-muted-foreground">Indicators update from the real OHLC series currently shown on the chart.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {([
          ["sma20", "SMA 20", "Simple moving average over the latest 20 closes."],
          ["ema20", "EMA 20", "Exponential moving average over the latest 20 closes."],
        ] as const).map(([id, label, description]) => {
          const enabled = indicators.includes(id);
          return (
            <button key={id} type="button" className={`market-tool-card text-left ${enabled ? "active" : ""}`} onClick={() => toggle(id)} aria-pressed={enabled}>
              <span className="flex items-center justify-between gap-3"><span className="font-semibold">{label}</span><span className={`tag ${enabled ? "tag-open" : "bg-secondary text-muted-foreground"}`}>{enabled ? "On" : "Off"}</span></span>
              <span className="block text-[11px] text-muted-foreground mt-2">{description}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DrawingPanel({ price, currentPrice, onChange }: { price: number | null; currentPrice: number | null; onChange: (value: number | null) => void }) {
  const [draft, setDraft] = useState(price == null ? currentPrice?.toString() ?? "" : price.toString());
  useEffect(() => {
    setDraft(price == null ? currentPrice?.toString() ?? "" : price.toString());
  }, [currentPrice, price]);
  return (
    <div className="max-w-xl">
      <div className="eyebrow mb-2">Horizontal price level</div>
      <p className="text-sm text-muted-foreground mb-4">Add a real reference line to the chart. It is session-only and does not create an alert or trading instruction.</p>
      <div className="flex flex-col sm:flex-row gap-2">
        <input className="input" type="number" step="any" value={draft} onChange={event => setDraft(event.target.value)} placeholder="Price level" aria-label="Horizontal price level" />
        <button type="button" className="btn btn-primary" onClick={() => {
          const value = Number(draft);
          if (Number.isFinite(value)) onChange(value);
        }}>Add level</button>
        <button type="button" className="btn btn-secondary" onClick={() => onChange(null)} disabled={price == null}>Clear</button>
      </div>
      <div className="text-[11px] text-muted-foreground mt-3">{price == null ? "No horizontal level is active." : `Active at ${formatPrice(price)}.`}</div>
    </div>
  );
}

function marketEventDate(event: EconomicEvent) {
  const date = new Date(event.scheduledAt);
  if (event.timePrecision === "date") {
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
  }
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

function marketEventCountdown(event: EconomicEvent) {
  if (event.timePrecision !== "datetime") return null;
  const remaining = new Date(event.scheduledAt).getTime() - Date.now();
  if (remaining <= 0) return null;
  const minutes = Math.round(remaining / 60_000);
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `in ${hours}h`;
  return `in ${Math.round(hours / 24)}d`;
}

function marketImpactLabel(event: EconomicEvent) {
  return event.impact ? event.impact.toUpperCase() : "NOT CLASSIFIED";
}

function marketImpactSourceLabel(event: EconomicEvent) {
  if (event.impactSource === "provider" || (!event.impactSource && event.providerImpact)) return "Provider";
  if (event.impactSource === "application" || event.applicationImpact) return "Application rule";
  return "Not enough information";
}

function marketImpactClass(event: EconomicEvent) {
  if (event.impact === "high") return "tag tag-danger";
  if (event.impact === "medium") return "tag tag-warn";
  if (event.impact === "low") return "tag tag-open";
  return "tag bg-secondary text-muted-foreground";
}

function MarketEconomicEvents({ instrument }: { instrument: Instrument }) {
  const [scope, setScope] = useState<"relevant" | "all">("relevant");
  const [view, setView] = useState<"upcoming" | "recently_released">("upcoming");
  const params = {
    view,
    instrumentId: instrument.id,
    relevance: scope,
  } as const;
  const query = useListEconomicEvents(params, {
    query: {
      enabled: Number.isInteger(instrument.id) && instrument.id > 0,
      queryKey: getListEconomicEventsQueryKey(params),
    },
  });
  const events = query.data?.events ?? [];

  return (
    <section className="panel p-4 md:p-5" data-testid="market-economic-events">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="eyebrow mb-2">Economic context</div>
          <h2 className="font-semibold">Economic events</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Potentially relevant observations for {instrument.symbol}. This is informational context, not a forecast or signal.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="panel p-1 flex gap-1">
            <button
              className={`btn text-xs ${scope === "relevant" ? "bg-secondary text-foreground" : "btn-ghost"}`}
              onClick={() => setScope("relevant")}
              data-testid="button-economic-scope-relevant"
            >
              Relevant to this market
            </button>
            <button
              className={`btn text-xs ${scope === "all" ? "bg-secondary text-foreground" : "btn-ghost"}`}
              onClick={() => setScope("all")}
              data-testid="button-economic-scope-all"
            >
              All economic events
            </button>
          </div>
          <div className="panel p-1 flex gap-1">
            <button
              className={`btn text-xs ${view === "upcoming" ? "bg-secondary text-foreground" : "btn-ghost"}`}
              onClick={() => setView("upcoming")}
              data-testid="button-economic-view-upcoming"
            >
              Upcoming
            </button>
            <button
              className={`btn text-xs ${view === "recently_released" ? "bg-secondary text-foreground" : "btn-ghost"}`}
              onClick={() => setView("recently_released")}
              data-testid="button-economic-view-released"
            >
              Recently released
            </button>
          </div>
        </div>
      </div>

      {query.isLoading && <div className="mt-5 rounded-md bg-secondary/40 p-4 text-sm text-muted-foreground">Loading economic event data…</div>}
      {query.isError && <div className="mt-5 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">Economic event data unavailable</div>}
      {!query.isLoading && !query.isError && !events.length && (
        <div className="mt-5 rounded-md bg-secondary/40 p-4 text-sm text-muted-foreground">
          No economic events are available for this view.
        </div>
      )}
      {!query.isLoading && !query.isError && events.length > 0 && (
        <div className="mt-5 grid gap-3">
          {events.slice(0, 8).map(event => {
            const countdown = marketEventCountdown(event);
            return (
              <article key={event.id} className="rounded-md border border-border bg-secondary/20 p-4" data-testid={`market-economic-event-${event.id}`}>
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={marketImpactClass(event)}>{marketImpactLabel(event)}</span>
                      {event.currency && <span className="tag bg-secondary text-muted-foreground">{event.currency}</span>}
                      <span className="text-[11px] text-muted-foreground">{event.releaseStatus === "released" ? "Released" : "Upcoming"}</span>
                    </div>
                    <h3 className="mt-2 text-sm font-semibold">{event.name}</h3>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      Classification: {marketImpactSourceLabel(event)}
                      {event.impactClassificationReason ? ` · ${event.impactClassificationReason}` : ""}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span>{marketEventDate(event)}</span>
                      {event.region && <span>{event.region}</span>}
                      {countdown && <span>{countdown}</span>}
                      <span>Potentially relevant to {instrument.symbol}</span>
                    </div>
                  </div>
                  <div className="shrink-0 text-xs text-muted-foreground md:text-right">
                    {event.sourceUrl ? (
                      <a className="underline underline-offset-2 hover:text-foreground" href={event.sourceUrl} target="_blank" rel="noreferrer">
                        {event.sourceName || "Source"}
                      </a>
                    ) : (
                      event.sourceName || "Source unavailable"
                    )}
                    <div className="mt-2 space-y-1">
                      <div>Previous: {event.previous ?? "Not provided"}</div>
                      <div>Forecast: {event.forecast ?? "Not provided"}</div>
                      <div>Actual: {event.actual ?? "Not provided"}</div>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {query.data?.message && query.data.message.includes("Unavailable sources:") && (
        <div className="mt-4 text-xs text-destructive">{query.data.message}</div>
      )}
    </section>
  );
}

function CandleSvg({
  bars,
  currentPrice,
  indicators,
  drawingPrice,
  drawingMode,
  timeframeCode,
  onChartClickPrice,
}: {
  bars: ChartBar[];
  currentPrice: number | null;
  indicators: IndicatorKind[];
  drawingPrice: number | null;
  drawingMode: boolean;
  timeframeCode?: string;
  onChartClickPrice: (value: number) => void;
}) {
  const initialWindowSize = (code?: string) => {
    const preferred = code === "1m" || code === "5m" ? 70 : code === "15m" || code === "30m" ? 60 : code === "4h" ? 45 : code === "1d" ? 40 : 55;
    return Math.min(preferred, bars.length);
  };
  const [windowSize, setWindowSize] = useState(() => initialWindowSize(timeframeCode));
  const [start, setStart] = useState(() => Math.max(0, bars.length - initialWindowSize(timeframeCode)));
  const [verticalScale, setVerticalScale] = useState(1);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [hoverPoint, setHoverPoint] = useState<{ x: number; y: number } | null>(null);
  const lastPointerWasDrag = useRef(false);
  const dragRef = useRef<{
    mode: "pan" | "price-axis" | "time-axis";
    pointerId: number;
    startX: number;
    startY: number;
    originalStart: number;
    originalWindow: number;
    originalVerticalScale: number;
    didMove: boolean;
  } | null>(null);
  useEffect(() => {
    const nextWindow = initialWindowSize(timeframeCode);
    setWindowSize(nextWindow);
    setStart(Math.max(0, bars.length - nextWindow));
    setHoveredIndex(null);
    setHoverPoint(null);
    setVerticalScale(1);
  }, [bars.length, timeframeCode]);
  const effectiveWindowSize = Math.min(bars.length, Math.max(windowSize, Math.min(20, bars.length)));
  const maxStart = Math.max(0, bars.length - effectiveWindowSize);
  const effectiveStart = Math.min(start, maxStart);
  const visibleBars = bars.slice(effectiveStart, effectiveStart + effectiveWindowSize);
  const clampWindow = (value: number) => Math.max(20, Math.min(bars.length, Math.round(value)));
  const clampStart = (value: number, nextWindow = effectiveWindowSize) => Math.max(0, Math.min(Math.max(0, bars.length - nextWindow), Math.round(value)));
  const zoomIn = () => {
    const nextWindow = clampWindow(windowSize * 0.75);
    const delta = Math.max(1, windowSize - nextWindow);
    setWindowSize(nextWindow);
    setStart(current => clampStart(current + Math.floor(delta / 2), nextWindow));
  };
  const zoomOut = () => {
    const nextWindow = clampWindow(windowSize * 1.25);
    const delta = Math.max(1, nextWindow - windowSize);
    setWindowSize(nextWindow);
    setStart(current => clampStart(current - Math.floor(delta / 2), nextWindow));
  };
  const pan = (direction: number) => setStart(current => clampStart(current + direction * Math.max(5, Math.floor(windowSize / 3))));
  const fit = () => {
    setWindowSize(bars.length);
    setStart(0);
  };
  const latest = () => setStart(maxStart);
  const reset = () => {
    const nextWindow = initialWindowSize(timeframeCode);
    setWindowSize(nextWindow);
    setStart(Math.max(0, bars.length - nextWindow));
    setVerticalScale(1);
    setHoveredIndex(null);
    setHoverPoint(null);
  };
  const width = 900;
  const height = 360;
  const pad = { top: 20, right: 20, bottom: 30, left: 20 };
  const highs = visibleBars.map(bar => bar.high);
  const lows = visibleBars.map(bar => bar.low);
  const high = Math.max(...highs);
  const low = Math.min(...lows);
  const range = high - low || Math.max(Math.abs(high) * 0.01, 1);
  const center = (high + low) / 2;
  const scaledRange = range / verticalScale;
  const displayHigh = center + scaledRange / 2;
  const displayLow = center - scaledRange / 2;
  const chartHeight = height - pad.top - pad.bottom;
  const chartWidth = width - pad.left - pad.right;
  const xStep = chartWidth / Math.max(visibleBars.length, 1);
  const y = (value: number) => pad.top + ((displayHigh - value) / scaledRange) * chartHeight;
  const priceTicks = Array.from({ length: 5 }, (_, index) => {
    const ratio = index / 4;
    return {
      value: displayHigh - scaledRange * ratio,
      y: pad.top + chartHeight * ratio,
    };
  });
  const timeSpan = visibleBars.length > 1
    ? Math.max(0, new Date(visibleBars[visibleBars.length - 1].openTime).getTime() - new Date(visibleBars[0].openTime).getTime())
    : 0;
  const timeTickCount = Math.min(6, visibleBars.length);
  const timeTicks = visibleBars.length <= 1
    ? visibleBars.map((bar, index) => ({ bar, index }))
    : Array.from({ length: timeTickCount }, (_, index) => {
      const barIndex = Math.round(index * (visibleBars.length - 1) / Math.max(1, timeTickCount - 1));
      return { bar: visibleBars[barIndex], index: barIndex };
    });
  const indicatorSeries = useMemo(() => ({
    sma20: movingAverage(bars, 20, false),
    ema20: movingAverage(bars, 20, true),
  }), [bars]);
  const indicatorColor: Record<IndicatorKind, string> = { sma20: "#a875e8", ema20: "#5bc0eb" };
  const pathPoints = (kind: IndicatorKind) => visibleBars.map((_, index) => {
    const value = indicatorSeries[kind][effectiveStart + index];
    if (value == null) return null;
    const x = pad.left + xStep * index + xStep / 2;
    return `${x},${y(value)}`;
  }).filter(Boolean).join(" ");
  const getLocalPoint = (event: { clientX: number; clientY: number }, rect: DOMRect) => ({
    x: ((event.clientX - rect.left) / rect.width) * width,
    y: ((event.clientY - rect.top) / rect.height) * height,
  });
  const handlePointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const point = getLocalPoint(event, rect);
    const drag = dragRef.current;
    if (drag) {
      event.preventDefault();
      const deltaX = point.x - drag.startX;
      const deltaY = point.y - drag.startY;
      if (Math.abs(deltaX) > 1 || Math.abs(deltaY) > 1) drag.didMove = true;
      if (drag.mode === "pan") {
        setStart(clampStart(drag.originalStart - deltaX / xStep, drag.originalWindow));
      } else if (drag.mode === "price-axis") {
        setVerticalScale(Math.max(0.25, Math.min(4, drag.originalVerticalScale * Math.exp(-deltaY * 0.01))));
      } else {
        const nextWindow = clampWindow(drag.originalWindow - deltaX * 0.35);
        const anchor = drag.originalStart + drag.originalWindow / 2;
        setWindowSize(nextWindow);
        setStart(clampStart(anchor - nextWindow / 2, nextWindow));
      }
      return;
    }
    const nextIndex = Math.max(0, Math.min(visibleBars.length - 1, Math.floor((point.x - pad.left) / xStep)));
    setHoveredIndex(nextIndex);
    setHoverPoint({
      x: Math.max(pad.left, Math.min(width - pad.right, point.x)),
      y: Math.max(pad.top, Math.min(height - pad.bottom, point.y)),
    });
  };
  const handlePointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const point = getLocalPoint(event, rect);
    const mode = point.y >= height - pad.bottom
      ? "time-axis"
      : point.x >= width - pad.right - 55
        ? "price-axis"
        : "pan";
    dragRef.current = {
      mode,
      pointerId: event.pointerId,
      startX: point.x,
      startY: point.y,
      originalStart: effectiveStart,
      originalWindow: effectiveWindowSize,
      originalVerticalScale: verticalScale,
      didMove: false,
    };
    setHoveredIndex(null);
    setHoverPoint(null);
    lastPointerWasDrag.current = false;
    if (typeof event.currentTarget.setPointerCapture === "function") {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  };
  const handlePointerUp = (event: PointerEvent<SVGSVGElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      lastPointerWasDrag.current = dragRef.current.didMove;
      if (
        typeof event.currentTarget.hasPointerCapture === "function"
        && event.currentTarget.hasPointerCapture(event.pointerId)
        && typeof event.currentTarget.releasePointerCapture === "function"
      ) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      dragRef.current = null;
    }
  };
  const handleWheel = (event: WheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const point = getLocalPoint(event, rect);
    const direction = event.deltaY < 0 ? 0.82 : 1.22;
    const nextWindow = clampWindow(effectiveWindowSize * direction);
    if (nextWindow === effectiveWindowSize) return;
    const anchor = effectiveStart + Math.max(0, Math.min(visibleBars.length - 1, (point.x - pad.left) / xStep));
    const relative = anchor - effectiveStart;
    setWindowSize(nextWindow);
    setStart(clampStart(anchor - relative * (nextWindow / effectiveWindowSize), nextWindow));
  };
  const handleChartClick = (event: PointerEvent<SVGSVGElement>) => {
    if (!drawingMode || lastPointerWasDrag.current) {
      lastPointerWasDrag.current = false;
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const { y: localY } = getLocalPoint(event, rect);
    const value = displayHigh - ((localY - pad.top) / chartHeight) * scaledRange;
    if (Number.isFinite(value)) onChartClickPrice(value);
  };
  const markerY = currentPrice == null ? null : Math.max(pad.top, Math.min(height - pad.bottom, y(currentPrice)));
  const levelY = drawingPrice == null ? null : Math.max(pad.top, Math.min(height - pad.bottom, y(drawingPrice)));
  return (
    <div>
      <div className="chart-toolbar">
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="mono">{effectiveStart + 1}–{Math.min(effectiveStart + visibleBars.length, bars.length)}</span>
          <span>of {bars.length} loaded candles</span>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <button className="btn btn-ghost chart-control" type="button" onClick={() => pan(-1)} disabled={start === 0} aria-label="Pan chart backwards"><ChevronLeft size={14}/></button>
          <button className="btn btn-ghost chart-control" type="button" onClick={zoomOut} disabled={windowSize >= bars.length} aria-label="Zoom out"><ZoomOut size={14}/></button>
          <button className="btn btn-ghost chart-control" type="button" onClick={zoomIn} disabled={windowSize <= 20} aria-label="Zoom in"><ZoomIn size={14}/></button>
          <button className="btn btn-ghost chart-control" type="button" onClick={() => pan(1)} disabled={start >= maxStart} aria-label="Pan chart forwards"><ChevronRight size={14}/></button>
          <button className="btn btn-secondary chart-control-wide" type="button" onClick={latest} disabled={start >= maxStart}><Maximize2 size={13}/> Latest</button>
          <button className="btn btn-secondary chart-control-wide" type="button" onClick={fit} disabled={windowSize >= bars.length}><Maximize2 size={13}/> Fit</button>
           <button className="btn btn-ghost chart-control-wide" type="button" onClick={reset} aria-label="Reset chart view">Reset</button>
        </div>
      </div>
      <div className="overflow-x-auto">
       <svg viewBox={`0 0 ${width} ${height}`} className="w-full min-w-[680px] h-[300px] md:h-[360px] chart-interaction-surface" role="img" aria-label="BiQuote candlestick chart" style={{ touchAction: "none", userSelect: "none", WebkitUserSelect: "none" }} onDragStart={event => event.preventDefault()} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp} onPointerLeave={() => { if (!dragRef.current) { setHoveredIndex(null); setHoverPoint(null); } }} onWheel={handleWheel} onClick={handleChartClick}>
        {[0, 1, 2, 3, 4].map(index => {
          const gridY = pad.top + (chartHeight / 4) * index;
          return <line key={index} x1={pad.left} x2={width - pad.right} y1={gridY} y2={gridY} stroke="hsl(var(--border) / .55)" strokeDasharray="2 5" />;
        })}
        <line x1={pad.left} x2={width - pad.right} y1={height - pad.bottom} y2={height - pad.bottom} stroke="hsl(var(--border))" />
        {visibleBars.map((bar, index) => {
          const x = pad.left + xStep * index + xStep / 2;
          const candleWidth = Math.max(3, Math.min(12, xStep * 0.55));
          const rising = bar.close >= bar.open;
           const color = bar.isClosed ? (rising ? "#35c98b" : "#ef6b73") : "#d6a85d";
          const bodyTop = y(Math.max(bar.open, bar.close));
          const bodyHeight = Math.max(2, Math.abs(y(bar.open) - y(bar.close)));
          return <g key={`${bar.openTime}-${index}`} onMouseEnter={() => setHoveredIndex(index)} onMouseLeave={() => setHoveredIndex(null)}><title>{`${new Date(bar.openTime).toLocaleString()} · O ${bar.open.toFixed(5)} · H ${bar.high.toFixed(5)} · L ${bar.low.toFixed(5)} · C ${bar.close.toFixed(5)}`}</title>{hoveredIndex === index && <line x1={x} x2={x} y1={pad.top} y2={height - pad.bottom} stroke="hsl(var(--accent))" strokeDasharray="3 4" />}<line x1={x} x2={x} y1={y(bar.high)} y2={y(bar.low)} stroke={color} strokeWidth="1.5" /><rect x={x - candleWidth / 2} y={bodyTop} width={candleWidth} height={bodyHeight} fill={color} rx="1" /></g>;
        })}
        {indicators.map(kind => <polyline key={kind} points={pathPoints(kind)} fill="none" stroke={indicatorColor[kind]} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />)}
         {hoverPoint && <g pointerEvents="none"><line x1={hoverPoint.x} x2={hoverPoint.x} y1={pad.top} y2={height - pad.bottom} stroke="hsl(var(--accent))" strokeDasharray="3 4" /><line x1={pad.left} x2={width - pad.right} y1={hoverPoint.y} y2={hoverPoint.y} stroke="hsl(var(--accent))" strokeDasharray="3 4" /></g>}
         {markerY != null && <g><line x1={pad.left} x2={width - pad.right} y1={markerY} y2={markerY} stroke="hsl(var(--primary))" strokeDasharray="5 4" /><text x={width - pad.right} y={markerY - 4} textAnchor="end" fill="hsl(var(--primary))" fontSize="10">{formatPrice(currentPrice)}</text></g>}
        {levelY != null && <g><line x1={pad.left} x2={width - pad.right} y1={levelY} y2={levelY} stroke="hsl(var(--accent))" strokeDasharray="7 4" /><text x={pad.left + 5} y={levelY - 4} fill="hsl(var(--accent))" fontSize="10">{formatPrice(drawingPrice)}</text></g>}
         {priceTicks.map((tick, index) => (
           <text key={`price-tick-${index}`} data-testid={index === 0 ? "chart-price-high" : index === priceTicks.length - 1 ? "chart-price-low" : `chart-price-tick-${index}`} x={width - pad.right} y={tick.y + 4} textAnchor="end" fill="hsl(var(--muted-foreground))" fontSize="10">{tick.value.toFixed(5)}</text>
         ))}
         {timeTicks.map(({ bar, index }, tickIndex) => (
           <text key={`time-tick-${bar.openTime}-${tickIndex}`} data-testid={`chart-time-tick-${tickIndex}`} x={pad.left + xStep * index + xStep / 2} y={height - 8} textAnchor={tickIndex === 0 ? "start" : tickIndex === timeTicks.length - 1 ? "end" : "middle"} fill="hsl(var(--muted-foreground))" fontSize="10">{formatTimeAxisLabel(bar.openTime, timeSpan)}</text>
         ))}
         <path data-testid="chart-price-axis" d={`M ${width - pad.right - 55} ${pad.top} H ${width - pad.right} V ${height - pad.bottom} H ${width - pad.right - 55} Z`} fill="transparent" pointerEvents="all" style={{ cursor: "ns-resize" }} aria-label="Drag to scale price axis" />
         <path data-testid="chart-time-axis" d={`M ${pad.left} ${height - pad.bottom - 22} H ${width - pad.right} V ${height} H ${pad.left} Z`} fill="transparent" pointerEvents="all" style={{ cursor: "ew-resize" }} aria-label="Drag to scale time axis" />
       </svg>
      </div>
      {hoveredIndex != null && visibleBars[hoveredIndex] && <div className="chart-hover-readout" role="status">
        <span className="mono">{new Date(visibleBars[hoveredIndex].openTime).toLocaleString()}</span>
        <span>O {visibleBars[hoveredIndex].open.toFixed(5)}</span>
        <span>H {visibleBars[hoveredIndex].high.toFixed(5)}</span>
        <span>L {visibleBars[hoveredIndex].low.toFixed(5)}</span>
        <span>C {visibleBars[hoveredIndex].close.toFixed(5)}</span>
      </div>}
      <div className="flex flex-wrap gap-4 text-[11px] text-muted-foreground mt-2">
        <span><i className="inline-block w-2 h-2 rounded-sm mr-1" style={{ backgroundColor: "#35c98b" }} />bullish close</span>
        <span><i className="inline-block w-2 h-2 rounded-sm mr-1" style={{ backgroundColor: "#ef6b73" }} />bearish close</span>
        <span><i className="inline-block w-2 h-2 rounded-sm mr-1" style={{ backgroundColor: "#d6a85d" }} />forming from genuine ticks</span>
        {indicators.map(kind => <span key={kind}><i className="inline-block w-3 h-0.5 align-middle mr-1" style={{ backgroundColor: indicatorColor[kind] }} />{kind === "sma20" ? "SMA 20" : "EMA 20"}</span>)}
        {drawingMode && <span className="text-primary">Click chart to place horizontal level</span>}
      </div>
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

export function AddMarketTab({ onAdded }: { onAdded: (result: BiQuoteMarketResult) => void }) {
  const catalog = useGetBiQuoteCatalog();
  const timeframes = useListTimeframes();
  const instruments = useListInstruments();
  const addMarket = useAddBiQuoteMarket();
  const qc = useQueryClient();
  const [category, setCategory] = useState<MarketCategory>("Forex");
  const [search, setSearch] = useState("");
  const [providerSymbol, setProviderSymbol] = useState("");
  const [timeframeId, setTimeframeId] = useState<number | "">("");

  useEffect(() => {
    if (timeframeId !== "" || !timeframes.data?.length) return;
    const preferred = timeframes.data.find(timeframe => timeframe.code === "5m" && timeframe.isActive)
      ?? timeframes.data.find(timeframe => timeframe.isActive)
      ?? timeframes.data[0];
    setTimeframeId(preferred.id);
  }, [timeframeId, timeframes.data]);

  const categoryCounts = useMemo(() => MARKET_CATEGORIES.reduce<Record<MarketCategory, number>>((counts, marketCategory) => {
    const assetClass = CATEGORY_ASSET_CLASSES[marketCategory];
    counts[marketCategory] = assetClass
      ? (catalog.data ?? []).filter(item => item.assetClass === assetClass).length
      : 0;
    return counts;
  }, {} as Record<MarketCategory, number>), [catalog.data]);
  const unavailableCategories = MARKET_CATEGORIES.filter(marketCategory => categoryCounts[marketCategory] === 0);

  const results = useMemo(() => {
    const assetClass = CATEGORY_ASSET_CLASSES[category];
    const normalizedSearch = search.trim().toLowerCase();
    return (catalog.data ?? []).filter(item =>
      item.assetClass === assetClass
      && `${catalogMarketName(item)} ${item.providerSymbol}`.toLowerCase().includes(normalizedSearch),
    );
  }, [catalog.data, category, search]);

  useEffect(() => {
    if (!results.some(item => item.providerSymbol === providerSymbol)) {
      setProviderSymbol("");
    }
  }, [providerSymbol, results]);

  const selectedMarket = results.find(item => item.providerSymbol === providerSymbol);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (providerSymbol === "" || timeframeId === "") return;
    addMarket.mutate({
      data: { providerSymbol, timeframeId: Number(timeframeId) },
    }, {
      onSuccess: result => {
        saveMarketSelection(result.instrument.id, result.timeframe.id);
        qc.invalidateQueries({ queryKey: getListInstrumentsQueryKey() });
        qc.invalidateQueries({ queryKey: getGetMarketDataSummaryQueryKey() });
        qc.invalidateQueries({ queryKey: getListSourceInstrumentMappingsQueryKey() });
        onAdded(result);
      },
    });
  };

  if (catalog.isLoading || timeframes.isLoading || instruments.isLoading) return <LoadingBlock />;
  if (catalog.isError || timeframes.isError || instruments.isError) {
    return <ErrorBlock retry={() => { catalog.refetch(); timeframes.refetch(); instruments.refetch(); }} />;
  }

  return (
    <div className="space-y-5">
      <div className="panel p-5 md:p-6">
        <div className="eyebrow mb-2">Add market</div>
        <h2 className="text-xl font-semibold">Choose a market to monitor</h2>
        <p className="text-sm text-muted-foreground mt-2 max-w-2xl leading-relaxed">
          Select from instruments currently supported by BiQuote. Provider symbols and mappings are configured automatically.
        </p>

        <form onSubmit={submit} className="space-y-5 mt-6">
          <Field label="Market type">
            <select className="select" value={category} onChange={event => {
              setCategory(event.target.value as MarketCategory);
              setProviderSymbol("");
            }} data-testid="select-market-category">
              {MARKET_CATEGORIES.map(item => (
                <option key={item} value={item} disabled={categoryCounts[item] === 0}>
                  {item}{categoryCounts[item] === 0 ? " — not currently available" : ""}
                </option>
              ))}
            </select>
            {unavailableCategories.length > 0 && (
              <div className="space-y-1 mt-2" role="status">
                {unavailableCategories.map(item => (
                  <p key={item} className="text-[11px] text-muted-foreground">
                    No {item.toLowerCase()} markets are currently available from this data provider.
                  </p>
                ))}
              </div>
            )}
          </Field>

          <Field label="Search markets">
            <div className="relative">
              <Search size={15} className="absolute left-3 top-3 text-muted-foreground" />
              <input
                className="input pl-9"
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder="Search markets by name or symbol…"
                data-testid="input-search-markets"
              />
            </div>
          </Field>

          <Field label="Available markets" hint={`${results.length} available`}>
            {results.length ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-72 overflow-y-auto pr-1" role="listbox" aria-label={`${category} markets`}>
                {results.map(item => {
                  const selected = item.providerSymbol === providerSymbol;
                  return (
                    <button
                      key={item.providerSymbol}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className={`text-left rounded-lg border px-4 py-3 transition-colors ${selected
                        ? "border-primary bg-primary/10 ring-1 ring-primary/30"
                        : "border-border bg-secondary/30 hover:bg-secondary/65 hover:border-primary/40"}`}
                      onClick={() => setProviderSymbol(item.providerSymbol)}
                      data-testid={`market-card-${item.providerSymbol}`}
                    >
                      <span className="flex items-start justify-between gap-3">
                        <span className="min-w-0">
                          <span className="block font-semibold leading-snug">{catalogMarketName(item)}</span>
                          <span className="block mono text-xs text-muted-foreground mt-1">{item.providerSymbol}</span>
                        </span>
                        {selected && <Check size={16} className="text-primary shrink-0 mt-0.5" aria-hidden="true" />}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border bg-secondary/20 px-4 py-5 text-sm text-muted-foreground">
                No {category.toLowerCase()} markets are currently available from this data provider.
              </div>
            )}
          </Field>

          {selectedMarket ? (
            <Field label="Timeframe">
              <select className="select" value={timeframeId} onChange={event => setTimeframeId(event.target.value ? Number(event.target.value) : "")} data-testid="select-market-timeframe">
                <option value="">Choose a timeframe…</option>
                {(timeframes.data ?? []).filter(timeframe => timeframe.isActive).map(timeframe => (
                  <option key={timeframe.id} value={timeframe.id}>{timeframe.label} ({timeframe.code})</option>
                ))}
              </select>
            </Field>
          ) : (
            <p className="text-sm text-muted-foreground">Select a market above to choose its timeframe.</p>
          )}

          {addMarket.isError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {addMarket.error instanceof Error ? addMarket.error.message : "This market could not be added."}
            </div>
          )}
          <button className="btn btn-primary w-full sm:w-auto" type="submit" disabled={!providerSymbol || timeframeId === "" || addMarket.isPending}>
            <Plus size={14} /> {addMarket.isPending ? "Adding market…" : "Add Market"}
          </button>
        </form>
      </div>

      <div className="panel p-5">
        <div className="eyebrow mb-2">Your markets</div>
        <h2 className="font-semibold">Markets currently available in Monitor</h2>
        {!instruments.data?.length ? (
          <p className="text-sm text-muted-foreground mt-3">No markets added yet.</p>
        ) : (
          <div className="divide-y divide-border mt-3">
            {instruments.data.map(instrument => (
              <div key={instrument.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-3">
                <div>
                  <div className="font-semibold mono">{instrument.symbol}</div>
                  <div className="text-xs text-muted-foreground">{instrument.displayName ?? instrument.assetClass}</div>
                </div>
                <span className="tag tag-open">{instrument.assetClass}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// LEGACY TECHNICAL CATALOG
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
