import { useQueryClient } from '@tanstack/react-query';
import { 
  useListStrategyMonitors, 
  useEvaluateActiveStrategies, 
  getListStrategyMonitorsQueryKey,
  type StrategyMonitor,
  type StrategyMonitorCondition
} from '@workspace/api-client-react';
import { Activity, Play, Info, RefreshCw, Clock, Layers, Database } from 'lucide-react';
import { Page, LoadingBlock, ErrorState, EmptyState } from '../App';

function StatusBadge({ status }: { status: string }) {
  const getStyle = (s: string) => {
    switch(s.toLowerCase()) {
      case 'met': return 'text-primary bg-primary/10 border-primary/20';
      case 'not_met': return 'text-muted-foreground bg-secondary border-border';
      case 'waiting': return 'text-accent bg-accent/10 border-accent/20';
      case 'invalid': return 'text-destructive bg-destructive/10 border-destructive/20';
      case 'monitoring': return 'text-primary bg-primary/10 border-primary/20';
      case 'paused': return 'text-muted-foreground bg-secondary border-border';
      case 'error': return 'text-destructive bg-destructive/10 border-destructive/20';
      case 'ready': return 'text-primary bg-primary/10 border-primary/20';
      case 'not_configured': return 'text-muted-foreground bg-secondary border-border';
      default: return 'text-muted-foreground bg-secondary border-border';
    }
  };
  return (
    <span className={`inline-flex items-center rounded-sm px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-widest border ${getStyle(status)}`}>
      {status.replace('_', ' ')}
    </span>
  );
}

function formatDate(dateStr: string | null | undefined) {
  if (!dateStr) return '—';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).format(new Date(dateStr));
}

export function StrategyMonitoringPage() {
  const queryClient = useQueryClient();
  const monitors = useListStrategyMonitors();
  const evaluate = useEvaluateActiveStrategies();

  const handleEvaluateAll = () => {
    evaluate.mutate({ data: {} }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListStrategyMonitorsQueryKey() });
      }
    });
  };

  const handleEvaluateSingle = (strategyId: number) => {
    evaluate.mutate({ data: { strategyId } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListStrategyMonitorsQueryKey() });
      }
    });
  };

  if (monitors.isLoading) {
    return <Page eyebrow="Architecture" title="Monitor"><LoadingBlock /></Page>;
  }

  if (monitors.isError) {
    return <Page eyebrow="Architecture" title="Monitor"><ErrorState retry={() => monitors.refetch()} /></Page>;
  }

  const data = monitors.data || [];

  return (
    <Page 
      eyebrow="Architecture" 
      title="Monitor" 
      description="Point-in-time evaluation state for active strategies. No continuous data feeds are active. WAITING and INVALID are honest outcomes for rules lacking current executable detectors."
      action={
        <button 
          className="btn btn-primary" 
          onClick={handleEvaluateAll} 
          disabled={evaluate.isPending || data.length === 0}
          data-testid="button-evaluate-all"
        >
          {evaluate.isPending ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />}
          {evaluate.isPending ? 'Evaluating...' : 'Evaluate active'}
        </button>
      }
    >
      {evaluate.isError && (
        <div className="panel p-4 mb-5 border-destructive/40 text-sm text-destructive" role="alert">
          Evaluation could not be completed. Existing monitoring state has not been changed.
        </div>
      )}
      {!data.length ? (
        <EmptyState 
          icon={Activity} 
          title="No monitors active" 
          text="Activate a strategy version to begin monitoring its evaluation state."
        />
      ) : (
        <div className="space-y-6 mt-2">
          {data.map((monitor: StrategyMonitor) => (
            <div key={`${monitor.strategyId}-${monitor.strategyVersionId}`} className="panel flex flex-col rise" data-testid={`monitor-card-${monitor.strategyId}`}>
              {/* Header */}
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 p-5 border-b border-border">
                <div>
                  <div className="flex items-center gap-3">
                    <h2 className="font-semibold text-lg">{monitor.strategyName}</h2>
                    <span className="font-mono text-xs text-muted-foreground bg-secondary px-2 py-0.5 rounded-sm">v{monitor.versionNumber}</span>
                    <StatusBadge status={monitor.monitoringStatus} />
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-3 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1.5"><Layers size={13} /> {monitor.instrumentSymbol || 'No Market'}</div>
                    <div className="flex items-center gap-1.5"><Database size={13} /> {monitor.sourceId ? `Source ${monitor.sourceId}` : 'No Source'}</div>
                    <div className="flex items-center gap-1.5"><Clock size={13} /> Evaluated: {formatDate(monitor.lastEvaluationAt)}</div>
                     <div className="flex items-center gap-1.5"><Database size={13} /> Market data: {formatDate(monitor.lastMarketDataAt)}</div>
                    {monitor.resetStatus !== 'not_configured' && (
                      <div className="flex items-center gap-1.5 border-l border-border pl-4">
                        Reset: {monitor.resetStatus} {monitor.resetReason ? `(${monitor.resetReason})` : ''}
                      </div>
                    )}
                  </div>
                </div>
                
                <div className="flex items-center gap-3">
                  <div className="text-right hidden sm:block">
                    <div className="eyebrow mb-1 text-[9px]">Overall Status</div>
                    <StatusBadge status={monitor.overallStatus} />
                  </div>
                  <button 
                    className="btn btn-secondary h-full"
                    onClick={() => handleEvaluateSingle(monitor.strategyId)}
                    disabled={evaluate.isPending}
                    title="Evaluate this strategy"
                    data-testid={`button-evaluate-${monitor.strategyId}`}
                  >
                    <RefreshCw size={13} className={evaluate.isPending ? 'animate-spin' : ''} />
                  </button>
                </div>
              </div>

              {/* Progress & Stats */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-px bg-border text-center">
                <div className="bg-card p-3">
                  <div className="text-[10px] uppercase font-mono tracking-widest text-muted-foreground mb-1">Met</div>
                  <div className="font-semibold text-primary">{monitor.metCount}</div>
                </div>
                <div className="bg-card p-3">
                  <div className="text-[10px] uppercase font-mono tracking-widest text-muted-foreground mb-1">Waiting</div>
                  <div className="font-semibold text-accent">{monitor.waitingCount}</div>
                </div>
                <div className="bg-card p-3">
                  <div className="text-[10px] uppercase font-mono tracking-widest text-muted-foreground mb-1">Not Met</div>
                  <div className="font-semibold text-muted-foreground">{monitor.notMetCount}</div>
                </div>
                <div className="bg-card p-3">
                  <div className="text-[10px] uppercase font-mono tracking-widest text-muted-foreground mb-1">Invalid</div>
                  <div className="font-semibold text-destructive">{monitor.invalidCount}</div>
                </div>
                <div className="bg-card p-3 col-span-2 md:col-span-1">
                  <div className="text-[10px] uppercase font-mono tracking-widest text-muted-foreground mb-1">Remaining</div>
                  <div className="font-semibold">{monitor.remainingCount}</div>
                </div>
              </div>
              <div className="h-1 w-full bg-secondary">
                <div 
                  className="h-full bg-primary transition-all duration-500 ease-out" 
                  style={{ width: `${monitor.progressPercent}%` }}
                />
              </div>
              <div className="px-5 py-2 text-[10px] font-mono uppercase tracking-widest text-muted-foreground border-b border-border">
                Progress {monitor.metCount}/{monitor.conditionCount} conditions met · {monitor.progressPercent}%
              </div>

              {/* Status Reason */}
              {monitor.statusReason && (
                <div className="p-3 bg-secondary/30 text-xs text-muted-foreground border-b border-border flex items-start gap-2">
                  <Info size={14} className="mt-0.5 shrink-0" />
                  <span className="leading-relaxed">{monitor.statusReason}</span>
                </div>
              )}

              {/* Conditions Table */}
              <div className="table-wrap">
                {monitor.conditions.length > 0 ? (
                  <table>
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Stage</th>
                        <th>Condition</th>
                        <th>Timeframe</th>
                        <th>Status</th>
                        <th>Reason / Details</th>
                      </tr>
                    </thead>
                    <tbody>
                      {monitor.conditions.map((c: StrategyMonitorCondition) => (
                        <tr key={c.strategyVersionConditionId} className="hover:bg-secondary/20 transition-colors">
                          <td className="font-mono text-muted-foreground">{String(c.conditionOrder).padStart(2, '0')}</td>
                          <td className="capitalize text-muted-foreground">{c.stage}</td>
                          <td className="font-medium">
                            {c.name}
                            {c.requirement === 'optional' && <span className="text-[9px] font-mono text-muted-foreground ml-2">(Optional)</span>}
                          </td>
                          <td className="font-mono text-muted-foreground">{c.timeframe}</td>
                          <td><StatusBadge status={c.status} /></td>
                          <td className="text-muted-foreground">
                            {c.reasonCode ? (
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono text-[10px] bg-secondary px-1 py-0.5 rounded">{c.reasonCode}</span>
                                {c.reason && <span className="truncate max-w-[200px]" title={c.reason}>{c.reason}</span>}
                              </div>
                            ) : (
                              <span className="truncate max-w-[250px] block" title={c.reason || ''}>{c.reason || '—'}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="text-center py-6 text-sm text-muted-foreground">
                    No conditions defined for this version.
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Page>
  );
}
