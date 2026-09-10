import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  ChevronDown,
  Clock3,
  Database,
  FilterX,
  Radio,
  RefreshCw,
  Search,
  SlidersHorizontal,
} from 'lucide-react';
import {
  getListEconomicEventsQueryKey,
  useListEconomicEvents,
  useListInstruments,
  type EconomicEvent,
  type ListEconomicEventsParams,
} from '@workspace/api-client-react';
import { EmptyState, ErrorState, LoadingBlock, Page } from '../App';
import { EconomicEventReactionPanel } from './economic-event-reaction';

type CalendarView = NonNullable<ListEconomicEventsParams['view']>;
type SelectFilter = 'impact' | 'region' | 'currency' | 'market';

const VIEWS: Array<{ value: CalendarView; label: string; note: string }> = [
  { value: 'today', label: 'Today', note: 'The current session' },
  { value: 'upcoming', label: 'Upcoming', note: 'What is ahead' },
  { value: 'recently_released', label: 'Recently released', note: 'Fresh observations' },
  { value: 'all', label: 'All', note: 'The connected record' },
];

const IMPACTS = [
  { value: '', label: 'All impact' },
  { value: 'high', label: 'High impact' },
  { value: 'medium', label: 'Medium impact' },
  { value: 'low', label: 'Low impact' },
] as const;

function displayValue(value: string | null | undefined) {
  return value?.trim() || 'Not provided';
}

function formatDateTime(value: string, precision: EconomicEvent['timePrecision']) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Time unavailable';
  if (precision === 'date') {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(date);
  }
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(date);
}

function formatRelativeTime(value: string, status: EconomicEvent['releaseStatus']) {
  if (status !== 'upcoming' && status !== 'live') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  if (status === 'live') return 'Live now';

  const difference = date.getTime() - Date.now();
  if (difference <= 0) return 'Starting now';
  const minutes = Math.round(difference / 60000);
  if (minutes < 60) return `In ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `In ${hours} hr${hours === 1 ? '' : 's'}`;
  const days = Math.floor(hours / 24);
  return `In ${days} day${days === 1 ? '' : 's'}`;
}

function statusLabel(status: EconomicEvent['releaseStatus']) {
  return status.replace('_', ' ');
}

function optionValues(events: EconomicEvent[], field: 'region' | 'currency') {
  return Array.from(
    new Set(events.map((event) => event[field]).filter((value): value is string => Boolean(value?.trim()))),
  ).sort((a, b) => a.localeCompare(b));
}

function marketOptions(events: EconomicEvent[]) {
  return Array.from(
    new Set(
      events.flatMap((event) =>
        event.affectedMarkets
          .map((market) => market.marketLabel)
          .filter((value): value is string => Boolean(value?.trim())),
      ),
    ),
  ).sort((a, b) => a.localeCompare(b));
}

function impactClassificationLabel(event: EconomicEvent) {
  if (event.impactSource === 'provider' || (!event.impactSource && event.providerImpact)) return 'Provider';
  if (event.impactSource === 'application' || event.applicationImpact) return 'Application rule';
  return 'Not enough information';
}

function EventCard({ event }: { event: EconomicEvent }) {
  const relativeTime = formatRelativeTime(event.scheduledAt, event.releaseStatus);
  const isHighImpact = event.impact === 'high';
  const isLive = event.releaseStatus === 'live';

  return (
    <article
      className={`panel panel-hover rise overflow-hidden ${
        isHighImpact ? 'border-accent/60 bg-accent/[0.035]' : ''
      }`}
      data-testid={`card-economic-event-${event.id}`}
    >
      <div className="flex flex-col gap-4 p-5 md:grid md:grid-cols-[150px_1fr_auto] md:items-start md:gap-6">
        <div className="border-b border-border pb-4 md:border-b-0 md:border-r md:pb-0 md:pr-6">
          <time
            className="mono block text-xs text-foreground"
            dateTime={event.scheduledAt}
            data-testid={`text-event-date-${event.id}`}
          >
            {formatDateTime(event.scheduledAt, event.timePrecision)}
          </time>
          {relativeTime && (
            <div
              className={`mt-2 flex items-center gap-1.5 text-xs font-semibold ${
                isLive ? 'text-accent' : 'text-primary'
              }`}
              data-testid={`text-event-timing-${event.id}`}
            >
              {isLive ? <Radio size={13} /> : <Clock3 size={13} />}
              {relativeTime}
            </div>
          )}
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`tag ${
                isHighImpact ? 'bg-accent/15 text-accent' : 'tag-active'
              }`}
              data-testid={`status-event-impact-${event.id}`}
            >
              {isHighImpact && <AlertTriangle size={11} aria-hidden="true" />}
              {event.impact ? `${event.impact} impact` : 'Not classified'}
            </span>
            <span
              className="text-[11px] text-muted-foreground"
              data-testid={`text-event-impact-classification-${event.id}`}
            >
              Classification: {impactClassificationLabel(event)}
            </span>
            <span
              className={`tag ${
                isLive ? 'bg-accent/15 text-accent' : 'bg-secondary text-muted-foreground'
              }`}
              data-testid={`status-event-release-${event.id}`}
            >
              {statusLabel(event.releaseStatus)}
            </span>
            {event.currency && (
              <span className="tag bg-secondary text-muted-foreground" data-testid={`text-event-currency-${event.id}`}>
                {event.currency}
              </span>
            )}
          </div>
          <h2 className="mt-3 text-base font-semibold tracking-tight" data-testid={`text-event-name-${event.id}`}>
            {event.name}
          </h2>
          {event.impactClassificationReason && (
            <p className="mt-2 text-xs text-muted-foreground" data-testid={`text-event-impact-reason-${event.id}`}>
              {event.impactClassificationReason}
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span data-testid={`text-event-region-${event.id}`}>{displayValue(event.region)}</span>
            {event.affectedMarkets.length > 0 && (
              <span data-testid={`text-event-markets-${event.id}`}>
                Affects {event.affectedMarkets.map((market) => market.marketLabel || `Market ${market.marketId ?? '—'}`).join(', ')}
              </span>
            )}
            <span data-testid={`text-event-source-${event.id}`}>
              Source:{' '}
              {event.sourceUrl ? (
                <a
                  href={event.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="underline decoration-muted-foreground/50 underline-offset-2 hover:text-foreground"
                >
                  {displayValue(event.sourceName)}
                </a>
              ) : (
                displayValue(event.sourceName)
              )}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4 border-t border-border pt-4 md:min-w-[190px] md:border-l md:border-t-0 md:pl-6">
          <EventValue label="Previous" value={event.previous} testId={`text-event-previous-${event.id}`} />
          <EventValue label="Forecast" value={event.forecast} testId={`text-event-forecast-${event.id}`} />
          <EventValue label="Actual" value={event.actual} testId={`text-event-actual-${event.id}`} />
        </div>
      </div>
      {event.marketReaction && <EconomicEventReactionPanel reaction={event.marketReaction} />}
      {isHighImpact && (
        <div
          className="flex items-center gap-2 border-t border-accent/20 bg-accent/[0.06] px-5 py-2.5 text-[11px] font-semibold text-accent"
          data-testid={`text-high-impact-${event.id}`}
        >
          <AlertTriangle size={13} aria-hidden="true" />
          High-impact event — review your own exposure before the release.
        </div>
      )}
    </article>
  );
}

function EventValue({ label, value, testId }: { label: string; value: string | null; testId: string }) {
  return (
    <div>
      <div className="eyebrow">{label}</div>
      <div className="mono mt-2 text-xs text-foreground" data-testid={testId}>
        {displayValue(value)}
      </div>
    </div>
  );
}

export function EconomicCalendar() {
  const [view, setView] = useState<CalendarView>('today');
  const [impact, setImpact] = useState<ListEconomicEventsParams['impact']>();
  const [region, setRegion] = useState('');
  const [currency, setCurrency] = useState('');
  const [market, setMarket] = useState('');
  const [search, setSearch] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [reactionInstrumentId, setReactionInstrumentId] = useState<number>();
  const instruments = useListInstruments();

  useEffect(() => {
    if (reactionInstrumentId !== undefined || !instruments.data?.length) return;
    const preferred = instruments.data.find(instrument => instrument.symbol.toUpperCase() === 'XAUUSD')
      ?? instruments.data.find(instrument => instrument.isActive !== false)
      ?? instruments.data[0];
    if (preferred) setReactionInstrumentId(preferred.id);
  }, [instruments.data, reactionInstrumentId]);

  const params = useMemo<ListEconomicEventsParams>(() => {
    const next: ListEconomicEventsParams = { view };
    if (impact) next.impact = impact;
    if (region) next.region = region;
    if (currency) next.currency = currency;
    if (market) next.market = market;
    if (search.trim()) next.search = search.trim();
    if (reactionInstrumentId !== undefined) {
      next.instrumentId = reactionInstrumentId;
      next.relevance = 'all';
    }
    return next;
  }, [currency, impact, market, reactionInstrumentId, region, search, view]);

  const query = useListEconomicEvents(params, {
    query: {
      enabled: reactionInstrumentId !== undefined,
      queryKey: getListEconomicEventsQueryKey(params),
    },
  });
  const events = query.data?.events ?? [];
  const hasFilters = Boolean(impact || region || currency || market || search.trim());
  const regions = optionValues(events, 'region');
  const currencies = optionValues(events, 'currency');
  const markets = marketOptions(events);

  const clearFilters = () => {
    setImpact(undefined);
    setRegion('');
    setCurrency('');
    setMarket('');
    setSearch('');
  };

  return (
    <Page
      eyebrow="Calendar / observed data"
      title="Economic calendar"
      description="A provider-neutral record of scheduled releases. Nothing here is a forecast of price or a substitute for your own preparation."
      action={
        <button
          type="button"
          className={`btn ${filtersOpen || hasFilters ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setFiltersOpen((open) => !open)}
          data-testid="button-toggle-economic-filters"
          aria-expanded={filtersOpen}
        >
          <SlidersHorizontal size={15} />
          Filters
          {hasFilters && <span className="mono text-[10px]">active</span>}
          <ChevronDown size={14} className={filtersOpen ? 'rotate-180' : ''} />
        </button>
      }
    >
      <div className="space-y-5">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_auto]">
          <div className="panel p-1.5" role="tablist" aria-label="Calendar views">
            <div className="grid grid-cols-2 gap-1 md:grid-cols-4">
              {VIEWS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  role="tab"
                  aria-selected={view === item.value}
                  className={`rounded-md px-3 py-2.5 text-left transition-colors ${
                    view === item.value ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary/60'
                  }`}
                  onClick={() => setView(item.value)}
                  data-testid={`button-calendar-view-${item.value}`}
                >
                  <span className="block text-xs font-semibold">{item.label}</span>
                  <span className="mt-1 block text-[10px] text-muted-foreground">{item.note}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="panel flex items-center gap-3 px-4 py-3 text-xs text-muted-foreground">
            <CalendarDays size={16} className="text-primary" />
            <span data-testid="text-calendar-count">
              {query.isLoading ? 'Reading calendar…' : `${events.length} ${events.length === 1 ? 'event' : 'events'} in view`}
            </span>
          </div>
        </div>

        <div className="panel p-4">
          <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="eyebrow">Reaction context</div>
              <div className="mt-1 text-xs text-muted-foreground">
                Choose an instrument to see conditional, informational market reactions.
              </div>
            </div>
            <select
              className="select md:max-w-xs"
              value={reactionInstrumentId ?? ''}
              onChange={(event) => setReactionInstrumentId(event.target.value ? Number(event.target.value) : undefined)}
              data-testid="select-reaction-market"
            >
              <option value="">Choose reaction market</option>
              {(instruments.data ?? []).map(instrument => (
                <option key={instrument.id} value={instrument.id}>
                  {instrument.symbol} — {instrument.displayName || instrument.symbol}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative min-w-0 flex-1">
              <Search size={15} className="absolute left-3 top-3 text-muted-foreground" />
              <input
                className="input pl-9"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search releases, regions, or currencies"
                aria-label="Search economic events"
                data-testid="input-search-economic-events"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <SelectFilter
                label="Impact"
                value={impact ?? ''}
                options={IMPACTS.map((item) => ({ value: item.value, label: item.label }))}
                onChange={(value) => setImpact((value || undefined) as ListEconomicEventsParams['impact'])}
                testId="select-economic-impact"
              />
              {filtersOpen && (
                <>
                  <SelectFilter label="Region" value={region} options={regions.map((value) => ({ value, label: value }))} onChange={setRegion} testId="select-economic-region" />
                  <SelectFilter label="Currency" value={currency} options={currencies.map((value) => ({ value, label: value }))} onChange={setCurrency} testId="select-economic-currency" />
                  <SelectFilter label="Market" value={market} options={markets.map((value) => ({ value, label: value }))} onChange={setMarket} testId="select-economic-market" />
                </>
              )}
              {hasFilters && (
                <button type="button" className="btn btn-ghost" onClick={clearFilters} data-testid="button-clear-economic-filters">
                  <FilterX size={14} />
                  Clear
                </button>
              )}
            </div>
          </div>
          {!filtersOpen && hasFilters && (
            <div className="mt-3 text-[11px] text-muted-foreground">
              Additional filters are active. Open Filters to review them.
            </div>
          )}
        </div>

        {query.isLoading ? (
          <div data-testid="loading-economic-calendar">
            <LoadingBlock />
          </div>
        ) : query.isError ? (
          <div data-testid="error-economic-calendar">
            <ErrorState
              retry={() => query.refetch()}
              message="The economic-calendar provider is unavailable or returned invalid data. No stale records are shown as current."
            />
          </div>
        ) : !query.data?.providerConnected ? (
          <EmptyState
            icon={Database}
            title="Calendar data is not connected"
            text="No economic calendar data is currently connected."
            testId="empty-economic-provider"
          />
        ) : events.length === 0 ? (
          <EmptyState
            icon={CalendarDays}
            title={hasFilters ? 'No releases match these filters' : 'No releases in this view'}
            text={
              hasFilters
                ? 'Try widening the view or clearing one of the filters. The calendar will only show records returned by the connected provider.'
                : 'The connected provider returned no events for this view. No substitute or sample events are shown.'
            }
            action={
              hasFilters ? (
                <button type="button" className="btn btn-secondary" onClick={clearFilters} data-testid="button-empty-clear-economic-filters">
                  <FilterX size={14} />
                  Clear filters
                </button>
              ) : undefined
            }
            testId="empty-economic-events"
          />
        ) : (
          <div className="space-y-3" data-testid="list-economic-events">
            {events.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        )}

        {query.data?.providerConnected && query.data.providerName && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4 text-[11px] text-muted-foreground" data-testid="text-economic-provider">
            <span className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              Connected sources: <span className="text-foreground">{query.data.providerName}</span>
              {query.data.message?.includes('Unavailable sources:') && (
                <span className="ml-3 text-destructive">{query.data.message}</span>
              )}
            </span>
            <span className="flex items-center gap-1.5">
              <RefreshCw size={12} />
              Dates and times reflect the precision provided by the source
            </span>
          </div>
        )}
      </div>
    </Page>
  );
}

function SelectFilter({
  label,
  value,
  options,
  onChange,
  testId,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  testId: string;
}) {
  return (
    <label className="relative">
      <span className="sr-only">{label}</span>
      <select
        className="select min-w-[132px] py-2.5 pr-8 text-xs"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={label}
        data-testid={testId}
      >
        <option value="">All {label.toLowerCase()}</option>
        {options
          .filter((option) => option.value)
          .map((option) => (
            <option value={option.value} key={option.value}>
              {option.label}
            </option>
          ))}
      </select>
    </label>
  );
}