export interface ResultTrade {
  id: number;
  entryTime: Date;
  exitTime: Date;
  pnl: number;
}

export interface EquityPoint {
  timestamp: Date;
  equity: number;
  tradeId: number | null;
}

export interface BacktestStatistics {
  winningTrades: number;
  losingTrades: number;
  winRate: number | null;
  totalPnl: number | null;
  averageWinningTrade: number | null;
  averageLosingTrade: number | null;
  largestWinningTrade: number | null;
  largestLosingTrade: number | null;
  maximumDrawdown: number | null;
  profitFactor: number | null;
  equityCurve: EquityPoint[];
}

export function calculateBacktestStatistics(trades: ResultTrade[], startDate: Date): BacktestStatistics {
  let winningTrades = 0;
  let losingTrades = 0;
  let winningPnl = 0;
  let losingPnl = 0;
  let largestWinningTrade: number | null = null;
  let largestLosingTrade: number | null = null;
  const totalPnl = trades.reduce((sum, trade) => sum + trade.pnl, 0);
  const equityCurve: EquityPoint[] = [{ timestamp: startDate, equity: 0, tradeId: null }];
  let equity = 0;
  let peak = 0;
  let maximumDrawdown = 0;

  for (const trade of trades) {
    if (trade.pnl > 0) {
      winningTrades += 1;
      winningPnl += trade.pnl;
      largestWinningTrade = largestWinningTrade === null ? trade.pnl : Math.max(largestWinningTrade, trade.pnl);
    } else if (trade.pnl < 0) {
      losingTrades += 1;
      losingPnl += trade.pnl;
      largestLosingTrade = largestLosingTrade === null ? trade.pnl : Math.min(largestLosingTrade, trade.pnl);
    }
  }

  for (const trade of [...trades].sort((a, b) => a.exitTime.getTime() - b.exitTime.getTime())) {
    equity += trade.pnl;
    peak = Math.max(peak, equity);
    maximumDrawdown = Math.max(maximumDrawdown, peak - equity);
    equityCurve.push({ timestamp: trade.exitTime, equity, tradeId: trade.id });
  }

  return {
    winningTrades,
    losingTrades,
    winRate: trades.length ? (winningTrades / trades.length) * 100 : null,
    totalPnl: trades.length ? totalPnl : null,
    averageWinningTrade: winningTrades ? winningPnl / winningTrades : null,
    averageLosingTrade: losingTrades ? losingPnl / losingTrades : null,
    largestWinningTrade,
    largestLosingTrade,
    maximumDrawdown: trades.length ? maximumDrawdown : null,
    profitFactor: losingTrades ? winningPnl / Math.abs(losingPnl) : null,
    equityCurve,
  };
}