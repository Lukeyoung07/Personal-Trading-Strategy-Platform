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
  const winning = trades.filter(trade => trade.pnl > 0);
  const losing = trades.filter(trade => trade.pnl < 0);
  const totalPnl = trades.reduce((sum, trade) => sum + trade.pnl, 0);
  const equityCurve: EquityPoint[] = [{ timestamp: startDate, equity: 0, tradeId: null }];
  let equity = 0;
  let peak = 0;
  let maximumDrawdown = 0;

  for (const trade of [...trades].sort((a, b) => a.exitTime.getTime() - b.exitTime.getTime())) {
    equity += trade.pnl;
    peak = Math.max(peak, equity);
    maximumDrawdown = Math.max(maximumDrawdown, peak - equity);
    equityCurve.push({ timestamp: trade.exitTime, equity, tradeId: trade.id });
  }

  return {
    winningTrades: winning.length,
    losingTrades: losing.length,
    winRate: trades.length ? (winning.length / trades.length) * 100 : null,
    totalPnl: trades.length ? totalPnl : null,
    averageWinningTrade: winning.length ? winning.reduce((sum, trade) => sum + trade.pnl, 0) / winning.length : null,
    averageLosingTrade: losing.length ? losing.reduce((sum, trade) => sum + trade.pnl, 0) / losing.length : null,
    largestWinningTrade: winning.length ? Math.max(...winning.map(trade => trade.pnl)) : null,
    largestLosingTrade: losing.length ? Math.min(...losing.map(trade => trade.pnl)) : null,
    maximumDrawdown: trades.length ? maximumDrawdown : null,
    profitFactor: losing.length ? winning.reduce((sum, trade) => sum + trade.pnl, 0) / Math.abs(losing.reduce((sum, trade) => sum + trade.pnl, 0)) : null,
    equityCurve,
  };
}