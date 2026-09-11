import { useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  BookOpen,
  CalendarDays,
  ChevronDown,
  CircleHelp,
  ClipboardCheck,
  FileText,
  Hammer,
  Info,
  LoaderCircle,
  MessageSquare,
  PencilLine,
  Save,
  Send,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import {
  useChatAssistant,
  type AssistantBacktestSetup,
  type AssistantChatResponse,
  type AssistantContext,
  type AssistantMessage,
  type AssistantStrategyDraft,
} from '@workspace/api-client-react';

export type AssistantPanelContext = AssistantContext;

export interface AssistantPanelProps {
  open: boolean;
  onClose: () => void;
  context: AssistantPanelContext;
  onReviewStrategy: (draft: unknown, action?: 'review' | 'save-version') => void;
  onOpenBacktest: (setup: unknown) => void;
}

type PanelMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  response?: AssistantChatResponse;
};

type PromptGroup = {
  label: 'BUILD' | 'ICT / SMC' | 'PRICE ACTION' | 'MULTI-TIMEFRAME' | 'RISK' | 'MODIFY' | 'ANALYSE' | 'LEARN';
  icon: typeof Hammer;
  prompts: string[];
};

const promptGroups: PromptGroup[] = [
  {
    label: 'BUILD',
    icon: Hammer,
    prompts: [
      'Build me a simple XAUUSD strategy',
      'Create a BUY strategy using the 20 EMA',
      'Build a strategy using support and resistance',
    ],
  },
  {
    label: 'ICT / SMC',
    icon: Sparkles,
    prompts: [
      'Build a liquidity sweep strategy',
      'Create an FVG strategy',
      'Use market structure and BOS',
    ],
  },
  {
    label: 'PRICE ACTION',
    icon: FileText,
    prompts: [
      'Build a breakout and retest strategy',
      'Create a bullish candle confirmation strategy',
    ],
  },
  {
    label: 'MULTI-TIMEFRAME',
    icon: CalendarDays,
    prompts: [
      'Use the 4H trend and find entries on the 15M',
      'Create a higher-timeframe bias strategy',
    ],
  },
  {
    label: 'RISK',
    icon: ShieldCheck,
    prompts: [
      'Use a 1% stop loss and 2% take profit',
      'Explain position sizing for this strategy',
    ],
  },
  {
    label: 'MODIFY',
    icon: PencilLine,
    prompts: ['Make this strategy less selective', 'Add a clear invalidation rule'],
  },
  {
    label: 'ANALYSE',
    icon: BarChart3,
    prompts: ['What should I check before backtesting?', 'Explain the weak points in this setup'],
  },
  {
    label: 'LEARN',
    icon: BookOpen,
    prompts: ['What makes a condition testable?', 'Explain walk-forward testing simply'],
  },
];

function compactContext(context: AssistantPanelContext): string {
  const parts = [
    context.page,
    context.strategyId ? `strategy ${context.strategyId}` : null,
    context.versionId ? `version ${context.versionId}` : null,
    context.backtestId ? `backtest ${context.backtestId}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Workspace context';
}

function getErrorCopy(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'The assistant could not answer this time. Your message is still here—try again when ready.';
}

function displayValue(value: string | number | null | undefined): string {
  return value === null || value === undefined || value === '' ? 'Not set' : String(value);
}

function StrategyDraftCard({
  draft,
  onReview,
}: {
  draft: AssistantStrategyDraft;
  onReview: (draft: AssistantStrategyDraft, action?: 'review' | 'save-version') => void;
}) {
  return (
    <section className="mt-4 overflow-hidden rounded-lg border border-primary/30 bg-primary/[0.045]" data-testid="assistant-strategy-draft">
      <div className="flex items-start justify-between gap-3 border-b border-primary/15 px-4 py-3">
        <div className="flex items-start gap-2.5">
          <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary">
            <FileText size={14} />
          </div>
          <div>
            <div className="eyebrow">Strategy draft</div>
            <h3 className="mt-1 text-sm font-semibold">{draft.name}</h3>
          </div>
        </div>
        <span className={`tag ${draft.compatibility.compatible ? 'tag-active' : 'tag-draft'}`}>
          {draft.compatibility.compatible ? 'Compatible' : 'Review needed'}
        </span>
      </div>
      <div className="space-y-4 px-4 py-4">
        <p className="text-xs leading-relaxed text-muted-foreground">{draft.description}</p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          <DraftField label="Direction" value={draft.direction} />
          <DraftField label="Market" value={displayValue(draft.marketSymbol)} />
          <DraftField label="Timeframes" value={draft.timeframes.length ? draft.timeframes.join(', ') : 'Not set'} />
          <DraftField label="Conditions" value={String(draft.conditions.length)} />
        </div>
        <div className="border-t border-primary/15 pt-3">
          <div className="eyebrow">Risk management</div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{displayValue(draft.riskManagementRules)}</p>
        </div>
        {draft.conditions.length > 0 && (
          <div className="border-t border-primary/15 pt-3">
            <div className="eyebrow mb-2">Condition sequence</div>
            <div className="space-y-2">
              {draft.conditions.map((condition, index) => (
                <div key={`${condition.name}-${index}`} className="rounded-md border border-border/70 bg-background/35 px-3 py-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs font-semibold">{condition.name}</div>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        {condition.stage} · {condition.requirement} · {condition.timeframe}
                      </div>
                    </div>
                    <span className="tag tag-draft shrink-0">{condition.conceptName}</span>
                  </div>
                  <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{condition.triggerRules}</p>
                </div>
              ))}
            </div>
          </div>
        )}
        {draft.conceptsUsed && draft.conceptsUsed.length > 0 && (
          <div className="border-t border-primary/15 pt-3" data-testid="assistant-draft-concepts">
            <div className="eyebrow mb-2">Concepts identified</div>
            <div className="space-y-2">
              {draft.conceptsUsed.map((concept) => (
                <div key={concept.name} className="flex items-start gap-2 rounded-md border border-border/70 bg-background/35 px-3 py-2">
                  <span className={`tag shrink-0 ${concept.supported ? 'tag-active' : 'tag-draft'}`}>
                    {concept.supported ? 'Executable' : 'AI understanding'}
                  </span>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold">{concept.name}</div>
                    <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{concept.explanation}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {!draft.compatibility.compatible && draft.compatibility.unsupportedConditions.length > 0 && (
          <div className="flex gap-2 rounded-md border border-accent/25 bg-accent/[0.06] p-3 text-[11px] leading-relaxed text-accent">
            <Info size={14} className="mt-0.5 shrink-0" />
            <span>Needs attention: {draft.compatibility.unsupportedConditions.join(', ')}</span>
          </div>
        )}
        <div className="flex flex-col gap-2 pt-1 sm:flex-row">
          <button
            type="button"
            className="btn btn-primary flex-1"
            onClick={() => onReview(draft)}
            data-testid="button-review-strategy"
          >
            <ClipboardCheck size={14} />
            Review Strategy
          </button>
          <button
            type="button"
            className="btn btn-secondary flex-1"
            onClick={() => onReview(draft, 'save-version')}
            data-testid="button-save-new-version"
          >
            <Save size={14} />
            Save as New Version
          </button>
        </div>
        <p className="text-center text-[10px] text-muted-foreground">Nothing is saved until you choose an action.</p>
      </div>
    </section>
  );
}

function DraftField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="eyebrow">{label}</div>
      <div className="mt-1 truncate text-xs font-semibold capitalize">{value}</div>
    </div>
  );
}

function BacktestSetupCard({
  setup,
  onOpen,
}: {
  setup: AssistantBacktestSetup;
  onOpen: (setup: AssistantBacktestSetup) => void;
}) {
  return (
    <section className="mt-4 overflow-hidden rounded-lg border border-accent/30 bg-accent/[0.045]" data-testid="assistant-backtest-setup">
      <div className="flex items-start gap-2.5 border-b border-accent/15 px-4 py-3">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent/15 text-accent">
          <BarChart3 size={14} />
        </div>
        <div>
          <div className="eyebrow text-accent">Backtest setup</div>
          <h3 className="mt-1 text-sm font-semibold">Ready to open in Backtesting</h3>
        </div>
      </div>
      <div className="space-y-4 px-4 py-4">
        <div className="grid grid-cols-2 gap-3">
          <SetupField label="Strategy ID" value={setup.strategyId} />
          <SetupField label="Version ID" value={setup.versionId} />
          <SetupField label="Instrument ID" value={setup.instrumentId} />
          <SetupField label="Timeframe ID" value={setup.timeframeId} />
          <SetupField label="Start date" value={setup.startDate} icon={<CalendarDays size={12} />} />
          <SetupField label="End date" value={setup.endDate} icon={<CalendarDays size={12} />} />
        </div>
        <button
          type="button"
          className="btn btn-secondary w-full border-accent/25 hover:border-accent/60"
          onClick={() => onOpen(setup)}
          data-testid="button-open-backtesting"
        >
          <ArrowRight size={14} />
          Open Backtesting
        </button>
      </div>
    </section>
  );
}

function SetupField({
  label,
  value,
  icon,
}: {
  label: string;
  value: string | number | null;
  icon?: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <div className="eyebrow flex items-center gap-1">{icon}{label}</div>
      <div className="mono mt-1 truncate text-[11px] text-foreground">{displayValue(value)}</div>
    </div>
  );
}

function AssistantMessageBubble({
  message,
  onReviewStrategy,
  onOpenBacktest,
}: {
  message: PanelMessage;
  onReviewStrategy: (draft: unknown) => void;
  onOpenBacktest: (setup: unknown) => void;
}) {
  const isAssistant = message.role === 'assistant';
  return (
    <div className={`flex gap-2.5 ${isAssistant ? 'items-start' : 'items-start justify-end'}`}>
      {isAssistant && (
        <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-primary/25 bg-primary/10 text-primary">
          <Sparkles size={14} />
        </div>
      )}
      <div className={`max-w-[88%] ${isAssistant ? 'min-w-0' : 'items-end'}`}>
        <div className={`mb-1 flex items-center gap-2 ${isAssistant ? '' : 'justify-end'}`}>
          <span className="eyebrow">{isAssistant ? 'Assistant' : 'You'}</span>
        </div>
        <div
          className={`rounded-lg px-3.5 py-3 text-xs leading-relaxed ${
            isAssistant
              ? 'border border-border bg-secondary/70 text-foreground'
              : 'bg-primary text-primary-foreground'
          }`}
          data-testid={`assistant-message-${message.role}`}
        >
          {message.content}
        </div>
        {isAssistant && message.response?.strategyDraft && (
          <StrategyDraftCard draft={message.response.strategyDraft} onReview={onReviewStrategy} />
        )}
        {isAssistant && message.response?.backtestSetup && (
          <BacktestSetupCard setup={message.response.backtestSetup} onOpen={onOpenBacktest} />
        )}
      </div>
    </div>
  );
}

export function AssistantPanel({
  open,
  onClose,
  context,
  onReviewStrategy,
  onOpenBacktest,
}: AssistantPanelProps) {
  const [messages, setMessages] = useState<PanelMessage[]>([]);
  const [input, setInput] = useState('');
  const [expandedGroup, setExpandedGroup] = useState<PromptGroup['label'] | null>('BUILD');
  const scrollRef = useRef<HTMLDivElement>(null);
  const chat = useChatAssistant();

  const apiMessages = useMemo<AssistantMessage[]>(
    () =>
      messages.slice(-12).map(({ role, content }) => ({
        role,
        content,
      })),
    [messages],
  );

  if (!open) return null;

  const sendMessage = (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    const message = input.trim();
    if (!message || chat.isPending) return;

    const userMessage: PanelMessage = {
      id: `${Date.now()}-user`,
      role: 'user',
      content: message,
    };
    setMessages((current) => [...current, userMessage]);
    setInput('');
    chat.mutate(
      {
        data: {
          message,
          messages: apiMessages,
          context,
        },
      },
      {
        onSuccess: (response) => {
          if (!response) return;
          setMessages((current) => [
            ...current,
            {
              id: `${Date.now()}-assistant`,
              role: 'assistant',
              content: response.reply || statusCopy(response.status),
              response,
            },
          ]);
          requestAnimationFrame(() => {
            const scrollElement = scrollRef.current;
            if (scrollElement && typeof scrollElement.scrollTo === 'function') {
              scrollElement.scrollTo({ top: scrollElement.scrollHeight, behavior: 'smooth' });
            }
          });
        },
      },
    );
  };

  const choosePrompt = (prompt: string) => {
    setInput(prompt);
    requestAnimationFrame(() => document.getElementById('assistant-message-input')?.focus());
  };

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby="assistant-panel-title">
      <button
        type="button"
        aria-label="Close assistant"
        className="absolute inset-0 h-full w-full cursor-default bg-background/70 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <aside className="rise absolute right-0 top-0 flex h-[100dvh] w-full max-w-[480px] flex-col border-l border-border bg-card shadow-2xl shadow-background/50">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-5 py-4 sm:px-6">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Sparkles size={17} />
            </div>
            <div>
               <div className="eyebrow">TradeX copilot</div>
              <h2 id="assistant-panel-title" className="mt-1 text-base font-bold tracking-tight">AI Trading Assistant</h2>
              <div className="mt-1 flex max-w-[280px] items-center gap-1.5 truncate text-[10px] text-muted-foreground">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                <span className="truncate">{compactContext(context)}</span>
              </div>
            </div>
          </div>
          <button type="button" onClick={onClose} className="btn btn-ghost -mr-2 -mt-1" aria-label="Close AI Trading Assistant" data-testid="button-close-assistant">
            <X size={17} />
          </button>
        </header>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
          {messages.length === 0 ? (
            <div className="pb-3">
              <div className="mb-6 border-b border-border pb-6">
                <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-md border border-primary/25 bg-primary/10 text-primary">
                  <MessageSquare size={15} />
                </div>
                <h3 className="max-w-[320px] text-2xl font-bold leading-tight tracking-[-0.04em]">
                  Tell me what you want to build, test, or understand.
                </h3>
                <p className="mt-3 max-w-[380px] text-xs leading-relaxed text-muted-foreground">
                  I can turn a rough idea into a reviewable draft, explain the trade-offs, or prepare a backtest setup. You stay in control of every save.
                </p>
              </div>
              <div className="mb-3">
                <div className="text-xs font-semibold">What can I ask?</div>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  Try a plain-English idea. I can identify trading concepts, explain them simply, and prepare a draft for your review.
                </p>
              </div>
              <div className="space-y-2.5">
                {promptGroups.map((group) => {
                  const Icon = group.icon;
                  const expanded = expandedGroup === group.label;
                  return (
                    <div key={group.label} className="overflow-hidden rounded-lg border border-border bg-secondary/25">
                      <button
                        type="button"
                        className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-secondary/70"
                        onClick={() => setExpandedGroup(expanded ? null : group.label)}
                        aria-expanded={expanded}
                        data-testid={`button-prompt-group-${group.label.toLowerCase()}`}
                      >
                        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary"><Icon size={14} /></span>
                        <span className="flex-1 font-mono text-[10px] font-medium tracking-[0.16em] text-muted-foreground">{group.label}</span>
                        <ChevronDown size={14} className={`text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`} />
                      </button>
                      {expanded && (
                        <div className="space-y-1 border-t border-border px-2 py-2">
                          {group.prompts.map((prompt) => (
                            <button
                              key={prompt}
                              type="button"
                              className="flex w-full items-center gap-2 rounded-md px-2.5 py-2.5 text-left text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                              onClick={() => choosePrompt(prompt)}
                              data-testid="button-assistant-prompt"
                            >
                              <ArrowRight size={12} className="shrink-0 text-primary" />
                              <span>{prompt}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="mt-5 flex gap-2 rounded-md border border-border/70 bg-secondary/20 p-3 text-[11px] leading-relaxed text-muted-foreground">
                <ShieldCheck size={14} className="mt-0.5 shrink-0 text-primary" />
                <span>Suggestions are drafts. Review them before they become part of your workspace.</span>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              {messages.map((message) => (
                <AssistantMessageBubble
                  key={message.id}
                  message={message}
                  onReviewStrategy={onReviewStrategy}
                  onOpenBacktest={onOpenBacktest}
                />
              ))}
              {chat.isPending && (
                <div className="flex items-start gap-2.5" data-testid="assistant-loading">
                  <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-primary/25 bg-primary/10 text-primary">
                    <Sparkles size={14} />
                  </div>
                  <div className="rounded-lg border border-border bg-secondary/70 px-3.5 py-3">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <LoaderCircle size={13} className="animate-spin text-primary" />
                      Thinking through the records…
                    </div>
                  </div>
                </div>
              )}
              {chat.isError && !chat.isPending && (
                <div className="flex gap-2.5 rounded-lg border border-destructive/30 bg-destructive/[0.06] p-3 text-xs leading-relaxed text-destructive" role="alert" data-testid="assistant-error">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  <span>{getErrorCopy(chat.error)}</span>
                </div>
              )}
              {chat.data && chat.data.status !== 'available' && (
                <div className="flex gap-2.5 rounded-lg border border-accent/30 bg-accent/[0.06] p-3 text-xs leading-relaxed text-accent" role="status" data-testid="assistant-unavailable">
                  <CircleHelp size={14} className="mt-0.5 shrink-0" />
                  <span>{statusCopy(chat.data.status)}</span>
                </div>
              )}
            </div>
          )}
        </div>

        <footer className="shrink-0 border-t border-border bg-card px-5 py-4 sm:px-6">
          <form onSubmit={sendMessage} className="relative">
            <label htmlFor="assistant-message-input" className="sr-only">Ask the AI Trading Assistant</label>
            <textarea
              id="assistant-message-input"
              className="textarea min-h-[74px] resize-none pb-11 pr-12 text-xs"
              value={input}
              maxLength={2000}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask about a strategy, condition, or backtest…"
              disabled={chat.isPending}
              data-testid="input-assistant-message"
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  sendMessage();
                }
              }}
            />
            <div className="absolute bottom-2.5 left-3 text-[10px] text-muted-foreground">
              {input.length > 0 ? `${input.length}/2000` : 'Shift + Enter for a new line'}
            </div>
            <button
              type="submit"
              className="btn btn-primary absolute bottom-2 right-2 h-8 w-8 p-0"
              disabled={!input.trim() || chat.isPending}
              aria-label="Send message"
              data-testid="button-send-assistant"
            >
              {chat.isPending ? <LoaderCircle size={14} className="animate-spin" /> : <Send size={14} />}
            </button>
          </form>
          <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
            <span>AI can make mistakes. Check assumptions against your records.</span>
            {messages.length > 0 && <button type="button" className="shrink-0 text-primary hover:underline" onClick={() => setMessages([])} data-testid="button-clear-assistant">Clear chat</button>}
          </div>
        </footer>
      </aside>
    </div>
  );
}

function statusCopy(status: AssistantChatResponse['status']): string {
  if (status === 'rate_limited') {
    return 'The assistant is temporarily rate-limited. Please wait a moment and try again.';
  }
  if (status === 'unavailable') {
    return 'The assistant is currently unavailable. Your workspace is unaffected—try again later.';
  }
  return 'The assistant is ready.';
}