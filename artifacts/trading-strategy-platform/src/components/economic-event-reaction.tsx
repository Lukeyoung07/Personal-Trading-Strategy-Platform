import type { EconomicEventMarketReaction } from "@workspace/api-client-react";

type Reaction = EconomicEventMarketReaction;

const STATE_LABELS: Record<Reaction["state"], string> = {
  waiting_for_actual: "Waiting for actual",
  potentially_bullish: "Potentially bullish",
  potentially_bearish: "Potentially bearish",
  neutral_unclear: "Neutral / Unclear",
  insufficient_data: "Insufficient data",
};

function stateClass(state: Reaction["state"]) {
  if (state === "potentially_bullish") return "text-emerald-400";
  if (state === "potentially_bearish") return "text-red-400";
  if (state === "waiting_for_actual") return "text-primary";
  return "text-muted-foreground";
}

function stateLabel(state: Reaction["state"]) {
  return STATE_LABELS[state] ?? "Insufficient data";
}

export function EconomicEventReactionPanel({ reaction, compact = false }: { reaction: Reaction; compact?: boolean }) {
  const insufficient = reaction.state === "insufficient_data";
  const hasScenarios = reaction.scenarios.length > 0;

  return (
    <section className={`${compact ? "mt-3 rounded-md border border-border bg-background/30 p-3" : "mt-4 rounded-md border border-border bg-background/30 p-4"}`} data-testid={`reaction-${reaction.instrumentId}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="eyebrow">Potential {reaction.instrumentSymbol} reaction</div>
        <span className={`text-xs font-semibold uppercase tracking-wide ${stateClass(reaction.state)}`} data-testid={`reaction-state-${reaction.instrumentId}`}>
          {stateLabel(reaction.state)}
        </span>
      </div>

      {insufficient ? (
        <p className="mt-2 text-xs text-muted-foreground" data-testid={`reaction-reason-${reaction.instrumentId}`}>
          Insufficient data to determine potential reaction.
        </p>
      ) : (
        <>
          <p className="mt-2 text-xs text-muted-foreground" data-testid={`reaction-reason-${reaction.instrumentId}`}>
            {reaction.reason}
          </p>
          {hasScenarios && (
            <div className="mt-3 grid gap-2 md:grid-cols-3">
              {reaction.scenarios.map(scenario => (
                <div key={scenario.condition} className="rounded-md bg-secondary/50 p-3">
                  <div className="text-xs font-medium">{scenario.label}</div>
                  <div className={`mt-1 text-xs font-semibold ${stateClass(scenario.state)}`}>
                    {stateLabel(scenario.state)}
                  </div>
                  {!compact && <div className="mt-1 text-[11px] text-muted-foreground">{scenario.reason}</div>}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}