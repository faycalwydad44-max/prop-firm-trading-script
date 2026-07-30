import {
  Candle,
  M5_MS,
  dayStart,
  firstIndexAtOrAfter,
} from "./market-data";

export type Direction = "BUY" | "SELL";

export type ResearchSignal = {
  strategy: string;
  direction: Direction;
  entryTime: number;
  entry: number;
  stopLoss: number;
  targetR: number;
};

export type SimulationConfig = {
  startingEquity: number;
  riskPercent: number;
  spread: number;
  maximumTradesPerDay: number;
  maximumHoldingBars: number;
  forcedExitMinute: number;
};

export type TradeResult = {
  strategy: string;
  direction: Direction;
  entryTime: string;
  exitTime: string;
  outcome: "TP" | "SL" | "TIME";
  resultR: number;
  pnl: number;
  equity: number;
};

export type SimulationResult = {
  totalTrades: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRate: number;
  profitFactor: number | null;
  expectancyR: number;
  netR: number;
  returnPercent: number;
  maximumClosedTradeDrawdownPercent: number;
  maximumConsecutiveLosses: number;
  positiveActiveMonths: number;
  activeMonths: number;
  positiveActiveMonthsPercent: number;
  endingEquity: number;
  skippedOverlap: number;
  skippedDailyLimit: number;
  recentTrades: TradeResult[];
};

export type ThreeWayEvaluation = {
  splitTimes: {
    trainingEnd: string;
    validationEnd: string;
  };
  all: SimulationResult;
  training50: SimulationResult;
  validation25: SimulationResult;
  final25: SimulationResult;
};

export const DEFAULT_SIMULATION_CONFIG: SimulationConfig = {
  startingEquity: 100000,
  riskPercent: 0.1,
  spread: 0.45,
  maximumTradesPerDay: 2,
  maximumHoldingBars: 72,
  forcedExitMinute: 21 * 60,
};

const MINUTE_MS = 60 * 1000;

function rounded(value: number, decimals = 2) {
  return Number(value.toFixed(decimals));
}

export function simulateSignals(
  signals: ResearchSignal[],
  m5: Candle[],
  config: SimulationConfig = DEFAULT_SIMULATION_CONFIG
): SimulationResult {
  const ordered = [...signals].sort(
    (left, right) => left.entryTime - right.entryTime
  );

  let equity = config.startingEquity;
  let peak = equity;
  let maximumDrawdown = 0;
  let lastExitTime = 0;

  let wins = 0;
  let losses = 0;
  let breakeven = 0;
  let totalR = 0;
  let grossProfitR = 0;
  let grossLossR = 0;
  let maximumConsecutiveLosses = 0;
  let currentConsecutiveLosses = 0;
  let skippedOverlap = 0;
  let skippedDailyLimit = 0;

  const dailyTrades = new Map<string, number>();
  const monthlyR = new Map<string, number>();
  const trades: TradeResult[] = [];

  for (const signal of ordered) {
    if (
      !Number.isFinite(signal.entry) ||
      !Number.isFinite(signal.stopLoss) ||
      !Number.isFinite(signal.targetR) ||
      signal.entry <= 0 ||
      signal.stopLoss <= 0 ||
      signal.targetR <= 0
    ) {
      continue;
    }

    if (signal.entryTime <= lastExitTime) {
      skippedOverlap++;
      continue;
    }

    const dayKey = new Date(signal.entryTime)
      .toISOString()
      .slice(0, 10);

    const monthKey = dayKey.slice(0, 7);
    const dailyCount = dailyTrades.get(dayKey) || 0;

    if (dailyCount >= config.maximumTradesPerDay) {
      skippedDailyLimit++;
      continue;
    }

    const startIndex = firstIndexAtOrAfter(
      m5,
      signal.entryTime
    );

    if (startIndex >= m5.length) {
      continue;
    }

    const riskDistance = Math.abs(
      signal.entry - signal.stopLoss
    );

    if (riskDistance <= 0) {
      continue;
    }

    const takeProfit =
      signal.direction === "BUY"
        ? signal.entry + riskDistance * signal.targetR
        : signal.entry - riskDistance * signal.targetR;

    const holdingExit =
      signal.entryTime +
      config.maximumHoldingBars * M5_MS;

    const dailyExit =
      dayStart(signal.entryTime) +
      config.forcedExitMinute * MINUTE_MS;

    const allowedExit = Math.min(
      holdingExit,
      dailyExit
    );

    if (allowedExit <= signal.entryTime) {
      continue;
    }

    const timeExitIndex =
      firstIndexAtOrAfter(m5, allowedExit) - 1;

    const finalIndex = Math.min(
      m5.length - 1,
      startIndex + config.maximumHoldingBars - 1,
      timeExitIndex
    );

    if (finalIndex < startIndex) {
      continue;
    }

    let resultR = 0;
    let outcome: "TP" | "SL" | "TIME" = "TIME";
    let exitTime = m5[finalIndex].time + M5_MS;

    for (
      let candleIndex = startIndex;
      candleIndex <= finalIndex;
      candleIndex++
    ) {
      const candle = m5[candleIndex];

      const stopHit =
        signal.direction === "BUY"
          ? candle.low <= signal.stopLoss
          : candle.high + config.spread >=
            signal.stopLoss;

      const targetHit =
        signal.direction === "BUY"
          ? candle.high >= takeProfit
          : candle.low + config.spread <=
            takeProfit;

      // Hypothese conservatrice si SL et TP sont touches
      // dans la meme bougie.
      if (stopHit) {
        resultR = -1;
        outcome = "SL";
        exitTime = candle.time + M5_MS;
        break;
      }

      if (targetHit) {
        resultR = signal.targetR;
        outcome = "TP";
        exitTime = candle.time + M5_MS;
        break;
      }

      if (candleIndex === finalIndex) {
        const effectiveClose =
          signal.direction === "BUY"
            ? candle.close
            : candle.close + config.spread;

        resultR =
          signal.direction === "BUY"
            ? (effectiveClose - signal.entry) /
              riskDistance
            : (signal.entry - effectiveClose) /
              riskDistance;

        resultR = Math.max(
          -1,
          Math.min(signal.targetR, resultR)
        );
      }
    }

    const riskCash =
      equity * (config.riskPercent / 100);

    const pnl = riskCash * resultR;

    equity += pnl;
    peak = Math.max(peak, equity);

    maximumDrawdown = Math.max(
      maximumDrawdown,
      ((peak - equity) / peak) * 100
    );

    totalR += resultR;

    monthlyR.set(
      monthKey,
      (monthlyR.get(monthKey) || 0) + resultR
    );

    if (resultR > 0.01) {
      wins++;
      grossProfitR += resultR;
      currentConsecutiveLosses = 0;
    } else if (resultR < -0.01) {
      losses++;
      grossLossR += Math.abs(resultR);
      currentConsecutiveLosses++;

      maximumConsecutiveLosses = Math.max(
        maximumConsecutiveLosses,
        currentConsecutiveLosses
      );
    } else {
      breakeven++;
    }

    dailyTrades.set(dayKey, dailyCount + 1);
    lastExitTime = exitTime;

    trades.push({
      strategy: signal.strategy,
      direction: signal.direction,
      entryTime: new Date(
        signal.entryTime
      ).toISOString(),
      exitTime: new Date(exitTime).toISOString(),
      outcome,
      resultR: rounded(resultR),
      pnl: rounded(pnl),
      equity: rounded(equity),
    });
  }

  const totalTrades = trades.length;

  const profitFactor =
    grossLossR > 0
      ? grossProfitR / grossLossR
      : null;

  const expectancyR =
    totalTrades > 0
      ? totalR / totalTrades
      : 0;

  const activeMonthValues = [
    ...monthlyR.values(),
  ];

  const positiveActiveMonths =
    activeMonthValues.filter(
      (value) => value > 0
    ).length;

  return {
    totalTrades,
    wins,
    losses,
    breakeven,
    winRate:
      totalTrades > 0
        ? rounded((wins / totalTrades) * 100)
        : 0,
    profitFactor:
      profitFactor === null
        ? null
        : rounded(profitFactor),
    expectancyR: rounded(expectancyR, 3),
    netR: rounded(totalR),
    returnPercent: rounded(
      ((equity - config.startingEquity) /
        config.startingEquity) *
        100
    ),
    maximumClosedTradeDrawdownPercent:
      rounded(maximumDrawdown),
    maximumConsecutiveLosses,
    positiveActiveMonths,
    activeMonths: activeMonthValues.length,
    positiveActiveMonthsPercent:
      activeMonthValues.length > 0
        ? rounded(
            (positiveActiveMonths /
              activeMonthValues.length) *
              100
          )
        : 0,
    endingEquity: rounded(equity),
    skippedOverlap,
    skippedDailyLimit,
    recentTrades: trades.slice(-15),
  };
}

export function evaluateThreeWay(
  signals: ResearchSignal[],
  m5: Candle[],
  config: SimulationConfig = DEFAULT_SIMULATION_CONFIG
): ThreeWayEvaluation {
  const trainingIndex = Math.floor(
    m5.length * 0.5
  );

  const validationIndex = Math.floor(
    m5.length * 0.75
  );

  const trainingEnd = m5[trainingIndex].time;
  const validationEnd = m5[validationIndex].time;

  return {
    splitTimes: {
      trainingEnd: new Date(
        trainingEnd
      ).toISOString(),
      validationEnd: new Date(
        validationEnd
      ).toISOString(),
    },
    all: simulateSignals(
      signals,
      m5,
      config
    ),
    training50: simulateSignals(
      signals.filter(
        (signal) =>
          signal.entryTime < trainingEnd
      ),
      m5,
      config
    ),
    validation25: simulateSignals(
      signals.filter(
        (signal) =>
          signal.entryTime >= trainingEnd &&
          signal.entryTime < validationEnd
      ),
      m5,
      config
    ),
    final25: simulateSignals(
      signals.filter(
        (signal) =>
          signal.entryTime >= validationEnd
      ),
      m5,
      config
    ),
  };
}
