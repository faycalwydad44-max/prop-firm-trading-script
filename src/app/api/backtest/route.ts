import { NextResponse } from "next/server";
import { pool } from "@/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type ModuleName = "REVERSAL" | "CONTINUATION";
type Direction = "BUY" | "SELL";

type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

type Signal = {
  module: ModuleName;
  direction: Direction;
  entryTime: number;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  reason: string;
};

const M5_MS = 5 * 60 * 1000;
const M15_MS = 15 * 60 * 1000;
const H1_MS = 60 * 60 * 1000;

const FIXED_SPREAD = 0.45;
const SLIPPAGE = 0.05;
const RISK_PERCENT = 0.25;
const TARGET_R = 2.5;
const MAX_TRADES_PER_DAY = 2;
const MAX_HOLDING_BARS = 72;

function toCandles(rows: Record<string, unknown>[]): Candle[] {
  return rows.map((row) => ({
    time: new Date(String(row.open_time)).getTime(),
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
  }));
}

function emaSeries(
  values: number[],
  period: number
): Array<number | null> {
  const output: Array<number | null> =
    new Array(values.length).fill(null);

  if (values.length < period) return output;

  let value =
    values.slice(0, period).reduce((sum, item) => sum + item, 0) /
    period;

  output[period - 1] = value;

  const multiplier = 2 / (period + 1);

  for (let index = period; index < values.length; index++) {
    value =
      values[index] * multiplier +
      value * (1 - multiplier);

    output[index] = value;
  }

  return output;
}

function atrSeries(
  candles: Candle[],
  period = 14
): Array<number | null> {
  const output: Array<number | null> =
    new Array(candles.length).fill(null);

  const ranges: number[] = [];

  for (let index = 1; index < candles.length; index++) {
    const candle = candles[index];
    const previousClose = candles[index - 1].close;

    ranges[index] = Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previousClose),
      Math.abs(candle.low - previousClose)
    );

    if (index >= period) {
      const recent = ranges.slice(index - period + 1, index + 1);

      output[index] =
        recent.reduce((sum, value) => sum + value, 0) /
        recent.length;
    }
  }

  return output;
}

function lastClosedIndex(
  candles: Candle[],
  duration: number,
  timestamp: number
) {
  let low = 0;
  let high = candles.length - 1;
  let result = -1;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const closeTime = candles[middle].time + duration;

    if (closeTime <= timestamp) {
      result = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return result;
}

function firstM5After(candles: Candle[], timestamp: number) {
  let low = 0;
  let high = candles.length;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const closeTime = candles[middle].time + M5_MS;

    if (closeTime < timestamp) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return low;
}

function sessionAt(timestamp: number) {
  const date = new Date(timestamp);
  const minutes =
    date.getUTCHours() * 60 + date.getUTCMinutes();

  if (minutes >= 9 * 60 && minutes <= 13 * 60) {
    return "LONDON";
  }

  if (
    minutes >= 14 * 60 + 30 &&
    minutes <= 19 * 60 + 30
  ) {
    return "NEW_YORK";
  }

  return null;
}

function trendAt(
  timestamp: number,
  h1: Candle[],
  ema50: Array<number | null>,
  ema200: Array<number | null>
) {
  const index = lastClosedIndex(h1, H1_MS, timestamp);

  if (index < 0 || ema50[index] === null || ema200[index] === null) {
    return "NEUTRAL";
  }

  const close = h1[index].close;
  const fast = ema50[index] as number;
  const slow = ema200[index] as number;

  if (close > fast && fast > slow) return "BULLISH";
  if (close < fast && fast < slow) return "BEARISH";

  return "NEUTRAL";
}

function createReversalSignals(
  h1: Candle[],
  m15: Candle[],
  m5: Candle[],
  ema50: Array<number | null>,
  ema200: Array<number | null>,
  atr15: Array<number | null>,
  atr5: Array<number | null>
): Signal[] {
  const signals: Signal[] = [];

  for (let index = 20; index < m15.length; index++) {
    const sweep = m15[index];
    const sweepCloseTime = sweep.time + M15_MS;
    const trend = trendAt(sweepCloseTime, h1, ema50, ema200);
    const volatility15 = atr15[index];

    if (trend === "NEUTRAL" || volatility15 === null) continue;

    const previous = m15.slice(index - 20, index);
    const previousLow = Math.min(...previous.map((item) => item.low));
    const previousHigh = Math.max(...previous.map((item) => item.high));

    const buySweep =
      trend === "BULLISH" &&
      sweep.low < previousLow &&
      sweep.close > previousLow;

    const sellSweep =
      trend === "BEARISH" &&
      sweep.high > previousHigh &&
      sweep.close < previousHigh;

    if (!buySweep && !sellSweep) continue;

    const direction: Direction = buySweep ? "BUY" : "SELL";
    const start = Math.max(2, firstM5After(m5, sweepCloseTime));
    const end = Math.min(m5.length, start + 9);

    for (let m5Index = start; m5Index < end; m5Index++) {
      const first = m5[m5Index - 2];
      const current = m5[m5Index];
      const volatility5 = atr5[m5Index];

      if (volatility5 === null) continue;

      const body = Math.abs(current.close - current.open);
      const displacement = body >= volatility5 * 0.8;

      const bullishFvg =
        direction === "BUY" &&
        current.low > first.high &&
        current.close > sweep.high &&
        displacement;

      const bearishFvg =
        direction === "SELL" &&
        current.high < first.low &&
        current.close < sweep.low &&
        displacement;

      if (!bullishFvg && !bearishFvg) continue;

      const entryTime = current.time + M5_MS;

      if (!sessionAt(entryTime)) break;

      const entry =
        direction === "BUY"
          ? current.close + FIXED_SPREAD + SLIPPAGE
          : current.close - SLIPPAGE;

      const stopLoss =
        direction === "BUY"
          ? sweep.low - volatility15 * 0.15
          : sweep.high + volatility15 * 0.15 + FIXED_SPREAD;

      const risk = Math.abs(entry - stopLoss);

      if (
        risk <= FIXED_SPREAD ||
        risk > volatility15 * 2.5
      ) {
        break;
      }

      const takeProfit =
        direction === "BUY"
          ? entry + risk * TARGET_R
          : entry - risk * TARGET_R;

      signals.push({
        module: "REVERSAL",
        direction,
        entryTime,
        entry,
        stopLoss,
        takeProfit,
        reason:
          "Tendance H1, sweep M15 et confirmation FVG M5",
      });

      break;
    }
  }

  return signals;
}

function createContinuationSignals(
  h1: Candle[],
  m15: Candle[],
  m5: Candle[],
  ema50: Array<number | null>,
  ema200: Array<number | null>,
  atr15: Array<number | null>,
  atr5: Array<number | null>
): Signal[] {
  const signals: Signal[] = [];

  for (let index = 20; index < m15.length - 1; index++) {
    const breakout = m15[index];
    const breakoutTime = breakout.time + M15_MS;
    const trend = trendAt(breakoutTime, h1, ema50, ema200);
    const volatility15 = atr15[index];

    if (trend === "NEUTRAL" || volatility15 === null) continue;

    const previous = m15.slice(index - 20, index);
    const previousHigh = Math.max(...previous.map((item) => item.high));
    const previousLow = Math.min(...previous.map((item) => item.low));
    const body = Math.abs(breakout.close - breakout.open);

    const bullishBreakout =
      trend === "BULLISH" &&
      breakout.close > previousHigh &&
      body >= volatility15 * 0.8;

    const bearishBreakout =
      trend === "BEARISH" &&
      breakout.close < previousLow &&
      body >= volatility15 * 0.8;

    if (!bullishBreakout && !bearishBreakout) continue;

    const direction: Direction =
      bullishBreakout ? "BUY" : "SELL";

    const breakoutLevel =
      direction === "BUY" ? previousHigh : previousLow;

    const pullbackEnd = Math.min(m15.length, index + 7);

    for (
      let pullbackIndex = index + 1;
      pullbackIndex < pullbackEnd;
      pullbackIndex++
    ) {
      const pullback = m15[pullbackIndex];

      const validBuyPullback =
        direction === "BUY" &&
        pullback.low <= breakoutLevel + volatility15 * 0.15 &&
        pullback.low >= breakoutLevel - volatility15 * 0.35 &&
        pullback.close > breakoutLevel;

      const validSellPullback =
        direction === "SELL" &&
        pullback.high >= breakoutLevel - volatility15 * 0.15 &&
        pullback.high <= breakoutLevel + volatility15 * 0.35 &&
        pullback.close < breakoutLevel;

      if (!validBuyPullback && !validSellPullback) continue;

      const pullbackCloseTime = pullback.time + M15_MS;
      const start = Math.max(1, firstM5After(m5, pullbackCloseTime));
      const end = Math.min(m5.length, start + 9);

      for (let m5Index = start; m5Index < end; m5Index++) {
        const current = m5[m5Index];
        const volatility5 = atr5[m5Index];

        if (volatility5 === null) continue;

        const bodyM5 = Math.abs(current.close - current.open);
        const displacement = bodyM5 >= volatility5 * 0.6;

        const buyConfirmation =
          direction === "BUY" &&
          current.close > pullback.high &&
          displacement;

        const sellConfirmation =
          direction === "SELL" &&
          current.close < pullback.low &&
          displacement;

        if (!buyConfirmation && !sellConfirmation) continue;

        const entryTime = current.time + M5_MS;

        if (!sessionAt(entryTime)) break;

        if (
          trendAt(entryTime, h1, ema50, ema200) !== trend
        ) {
          break;
        }

        const entry =
          direction === "BUY"
            ? current.close + FIXED_SPREAD + SLIPPAGE
            : current.close - SLIPPAGE;

        const stopLoss =
          direction === "BUY"
            ? pullback.low - volatility15 * 0.15
            : pullback.high +
              volatility15 * 0.15 +
              FIXED_SPREAD;

        const risk = Math.abs(entry - stopLoss);

        if (
          risk <= FIXED_SPREAD ||
          risk > volatility15 * 2.5
        ) {
          break;
        }

        const takeProfit =
          direction === "BUY"
            ? entry + risk * TARGET_R
            : entry - risk * TARGET_R;

        signals.push({
          module: "CONTINUATION",
          direction,
          entryTime,
          entry,
          stopLoss,
          takeProfit,
          reason:
            "Tendance H1, cassure M15, pullback M15 et déplacement M5",
        });

        index = pullbackIndex;
        break;
      }

      break;
    }
  }

  return signals;
}

function simulate(signals: Signal[], m5: Candle[]) {
  const ordered = [...signals].sort((a, b) => {
    if (a.entryTime !== b.entryTime) {
      return a.entryTime - b.entryTime;
    }

    return a.module === "REVERSAL" ? -1 : 1;
  });

  let equity = 100000;
  let peak = equity;
  let maximumDrawdown = 0;
  let lastExitTime = 0;

  let wins = 0;
  let losses = 0;
  let breakeven = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let totalR = 0;
  let skippedOverlap = 0;
  let skippedDailyLimit = 0;

  const dailyTrades = new Map<string, number>();
  const trades: Record<string, unknown>[] = [];

  for (const signal of ordered) {
    if (signal.entryTime <= lastExitTime) {
      skippedOverlap++;
      continue;
    }

    const day = new Date(signal.entryTime)
      .toISOString()
      .slice(0, 10);

    const countForDay = dailyTrades.get(day) || 0;

    if (countForDay >= MAX_TRADES_PER_DAY) {
      skippedDailyLimit++;
      continue;
    }

    const start = m5.findIndex(
      (candle) => candle.time >= signal.entryTime
    );

    if (start < 0) continue;

    const riskDistance = Math.abs(
      signal.entry - signal.stopLoss
    );

    let exitTime = 0;
    let exitPrice = signal.entry;
    let outcome = "TIME";
    let resultR = 0;

    const finalIndex = Math.min(
      m5.length - 1,
      start + MAX_HOLDING_BARS
    );

    for (let index = start; index <= finalIndex; index++) {
      const candle = m5[index];

      const stopHit =
        signal.direction === "BUY"
          ? candle.low <= signal.stopLoss
          : candle.high + FIXED_SPREAD >= signal.stopLoss;

      const targetHit =
        signal.direction === "BUY"
          ? candle.high >= signal.takeProfit
          : candle.low + FIXED_SPREAD <= signal.takeProfit;

      // Cas ambigu : hypothèse conservatrice, le stop est touché avant le TP.
      if (stopHit) {
        outcome = "SL";
        resultR = -1;
        exitPrice = signal.stopLoss;
        exitTime = candle.time + M5_MS;
        break;
      }

      if (targetHit) {
        outcome = "TP";
        resultR = TARGET_R;
        exitPrice = signal.takeProfit;
        exitTime = candle.time + M5_MS;
        break;
      }

      if (index === finalIndex) {
        const effectiveClose =
          signal.direction === "BUY"
            ? candle.close
            : candle.close + FIXED_SPREAD;

        resultR =
          signal.direction === "BUY"
            ? (effectiveClose - signal.entry) / riskDistance
            : (signal.entry - effectiveClose) / riskDistance;

        resultR = Math.max(-1, Math.min(TARGET_R, resultR));
        exitPrice = effectiveClose;
        exitTime = candle.time + M5_MS;
      }
    }

    const riskCash = equity * (RISK_PERCENT / 100);
    const pnl = riskCash * resultR;

    equity += pnl;
    peak = Math.max(peak, equity);

    const drawdown =
      peak > 0 ? ((peak - equity) / peak) * 100 : 0;

    maximumDrawdown = Math.max(maximumDrawdown, drawdown);
    totalR += resultR;

    if (resultR > 0.01) {
      wins++;
      grossProfit += pnl;
    } else if (resultR < -0.01) {
      losses++;
      grossLoss += Math.abs(pnl);
    } else {
      breakeven++;
    }

    dailyTrades.set(day, countForDay + 1);
    lastExitTime = exitTime;

    trades.push({
      module: signal.module,
      direction: signal.direction,
      entryTime: new Date(signal.entryTime).toISOString(),
      exitTime: new Date(exitTime).toISOString(),
      entry: Number(signal.entry.toFixed(2)),
      stopLoss: Number(signal.stopLoss.toFixed(2)),
      takeProfit: Number(signal.takeProfit.toFixed(2)),
      exitPrice: Number(exitPrice.toFixed(2)),
      outcome,
      resultR: Number(resultR.toFixed(2)),
      pnl: Number(pnl.toFixed(2)),
      equity: Number(equity.toFixed(2)),
    });
  }

  const totalTrades = trades.length;
  const profitFactor =
    grossLoss > 0 ? grossProfit / grossLoss : null;

  return {
    totalTrades,
    wins,
    losses,
    breakeven,
    winRate:
      totalTrades > 0
        ? Number(((wins / totalTrades) * 100).toFixed(2))
        : 0,
    profitFactor:
      profitFactor === null
        ? null
        : Number(profitFactor.toFixed(2)),
    expectancyR:
      totalTrades > 0
        ? Number((totalR / totalTrades).toFixed(3))
        : 0,
    netR: Number(totalR.toFixed(2)),
    returnPercent: Number(
      (((equity - 100000) / 100000) * 100).toFixed(2)
    ),
    maximumDrawdownPercent: Number(
      maximumDrawdown.toFixed(2)
    ),
    endingEquity: Number(equity.toFixed(2)),
    skippedOverlap,
    skippedDailyLimit,
    sampleQuality:
      totalTrades >= 100
        ? "SUFFICIENT_FOR_INITIAL_REVIEW"
        : totalTrades >= 30
          ? "PRELIMINARY_ONLY"
          : "INSUFFICIENT",
    readyForDemoValidation:
      totalTrades >= 100 &&
      profitFactor !== null &&
      profitFactor >= 1.2 &&
      totalR > 0 &&
      maximumDrawdown < 5,
    recentTrades: trades.slice(-20),
  };
}

export async function GET() {
  try {
    const [h1Result, m15Result, m5Result] =
      await Promise.all([
        pool.query(
          `SELECT open_time, open, high, low, close
           FROM market_candles
           WHERE symbol = 'XAUUSD' AND timeframe = 'H1'
           ORDER BY open_time ASC`
        ),
        pool.query(
          `SELECT open_time, open, high, low, close
           FROM market_candles
           WHERE symbol = 'XAUUSD' AND timeframe = 'M15'
           ORDER BY open_time ASC`
        ),
        pool.query(
          `SELECT open_time, open, high, low, close
           FROM market_candles
           WHERE symbol = 'XAUUSD' AND timeframe = 'M5'
           ORDER BY open_time ASC`
        ),
      ]);

    const h1 = toCandles(h1Result.rows).slice(0, -1);
    const m15 = toCandles(m15Result.rows).slice(0, -1);
    const m5 = toCandles(m5Result.rows).slice(0, -1);

    if (h1.length < 220 || m15.length < 200 || m5.length < 500) {
      return NextResponse.json(
        {
          error: "Historique insuffisant pour le backtest.",
          counts: {
            h1: h1.length,
            m15: m15.length,
            m5: m5.length,
          },
        },
        { status: 400 }
      );
    }

    const closesH1 = h1.map((candle) => candle.close);
    const ema50 = emaSeries(closesH1, 50);
    const ema200 = emaSeries(closesH1, 200);
    const atr15 = atrSeries(m15);
    const atr5 = atrSeries(m5);

    const reversalSignals = createReversalSignals(
      h1,
      m15,
      m5,
      ema50,
      ema200,
      atr15,
      atr5
    );

    const continuationSignals = createContinuationSignals(
      h1,
      m15,
      m5,
      ema50,
      ema200,
      atr15,
      atr5
    );

    return NextResponse.json(
      {
        symbol: "XAUUSD",
        source: "FTMO-MT5",
        period: {
          from: new Date(m5[0].time).toISOString(),
          to: new Date(
            m5[m5.length - 1].time + M5_MS
          ).toISOString(),
          h1Candles: h1.length,
          m15Candles: m15.length,
          m5Candles: m5.length,
        },
        assumptions: {
          startingEquity: 100000,
          riskPercentPerTrade: RISK_PERCENT,
          targetR: TARGET_R,
          fixedSpread: FIXED_SPREAD,
          slippage: SLIPPAGE,
          maximumTradesPerDay: MAX_TRADES_PER_DAY,
          maximumHoldingHours:
            (MAX_HOLDING_BARS * 5) / 60,
          ambiguousBarRule: "STOP_FIRST",
        },
        signalsDetected: {
          reversal: reversalSignals.length,
          continuation: continuationSignals.length,
          combined:
            reversalSignals.length +
            continuationSignals.length,
        },
        results: {
          reversal: simulate(reversalSignals, m5),
          continuation: simulate(continuationSignals, m5),
          combined: simulate(
            [...reversalSignals, ...continuationSignals],
            m5
          ),
        },
        warning:
          "Backtest initial avec spread fixe. Il ne prouve pas une rentabilite future.",
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (error) {
    console.error("Erreur backtest:", error);

    return NextResponse.json(
      {
        error: "Backtest impossible.",
      },
      { status: 500 }
    );
  }
}
