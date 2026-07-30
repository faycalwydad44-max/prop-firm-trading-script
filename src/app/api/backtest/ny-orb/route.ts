import { NextResponse } from "next/server";
import { pool } from "@/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Direction = "BUY" | "SELL";
type Bias = "BULLISH" | "BEARISH" | "NEUTRAL";

type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

type Signal = {
  direction: Direction;
  entryTime: number;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  breakoutTime: number;
  breakoutLevel: number;
};

const M5_MS = 5 * 60 * 1000;
const M15_MS = 15 * 60 * 1000;
const H1_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

const SPREAD = 0.45;
const SLIPPAGE = 0.05;
const RISK_PERCENT = 0.1;
const TARGET_R = 1.5;

const MAX_TRADES_PER_DAY = 2;
const MAX_HOLDING_BARS = 72;
const SESSION_START_MINUTE = 6 * 60;
const SESSION_END_MINUTE = 20 * 60;
const FORCED_EXIT_MINUTE = 21 * 60;

function toCandles(
  rows: Record<string, unknown>[]
): Candle[] {
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

  if (values.length < period) {
    return output;
  }

  let value =
    values
      .slice(0, period)
      .reduce((sum, item) => sum + item, 0) /
    period;

  output[period - 1] = value;

  const multiplier = 2 / (period + 1);

  for (
    let index = period;
    index < values.length;
    index++
  ) {
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

  const ranges =
    new Array<number>(candles.length).fill(0);

  for (
    let index = 1;
    index < candles.length;
    index++
  ) {
    const candle = candles[index];
    const previousClose =
      candles[index - 1].close;

    ranges[index] = Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previousClose),
      Math.abs(candle.low - previousClose)
    );

    if (index >= period) {
      const recent = ranges.slice(
        index - period + 1,
        index + 1
      );

      output[index] =
        recent.reduce(
          (sum, item) => sum + item,
          0
        ) / recent.length;
    }
  }

  return output;
}

function trueRange(
  candles: Candle[],
  index: number
) {
  if (index <= 0) {
    return candles[index].high - candles[index].low;
  }

  const candle = candles[index];
  const previousClose = candles[index - 1].close;

  return Math.max(
    candle.high - candle.low,
    Math.abs(candle.high - previousClose),
    Math.abs(candle.low - previousClose)
  );
}

function averageTrueRange(
  candles: Candle[],
  start: number,
  end: number
) {
  if (start < 1 || end <= start) {
    return null;
  }

  let total = 0;

  for (let index = start; index < end; index++) {
    total += trueRange(candles, index);
  }

  return total / (end - start);
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
    const middle = Math.floor(
      (low + high) / 2
    );

    const closeTime =
      candles[middle].time + duration;

    if (closeTime <= timestamp) {
      result = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return result;
}

function firstIndexAtOrAfter(
  candles: Candle[],
  timestamp: number
) {
  let low = 0;
  let high = candles.length;

  while (low < high) {
    const middle = Math.floor(
      (low + high) / 2
    );

    if (candles[middle].time < timestamp) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return low;
}

function minuteOfDay(timestamp: number) {
  const date = new Date(timestamp);

  return (
    date.getUTCHours() * 60 +
    date.getUTCMinutes()
  );
}

function dayStart(timestamp: number) {
  const date = new Date(timestamp);

  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate()
  );
}

function h1BiasAt(
  timestamp: number,
  h1: Candle[],
  ema50: Array<number | null>
): Bias {
  const index = lastClosedIndex(
    h1,
    H1_MS,
    timestamp
  );

  if (
    index < 5 ||
    ema50[index] === null ||
    ema50[index - 5] === null
  ) {
    return "NEUTRAL";
  }

  const close = h1[index].close;
  const currentEma = ema50[index] as number;
  const previousEma = ema50[index - 5] as number;

  if (
    close > currentEma &&
    currentEma > previousEma
  ) {
    return "BULLISH";
  }

  if (
    close < currentEma &&
    currentEma < previousEma
  ) {
    return "BEARISH";
  }

  return "NEUTRAL";
}

function createSignals(
  h1: Candle[],
  m15: Candle[],
  m5: Candle[],
  ema50H1: Array<number | null>,
  atr15: Array<number | null>,
  atr5: Array<number | null>
): Signal[] {
  const signals: Signal[] = [];
  let lastSignalTime = 0;

  for (
    let index = 50;
    index < m15.length;
    index++
  ) {
    const breakout = m15[index];
    const breakoutClose =
      breakout.time + M15_MS;

    const minutes =
      minuteOfDay(breakoutClose);

    if (
      minutes < SESSION_START_MINUTE ||
      minutes > SESSION_END_MINUTE
    ) {
      continue;
    }

    if (
      breakoutClose - lastSignalTime <
      120 * MINUTE_MS
    ) {
      continue;
    }

    const volatility = atr15[index];

    if (volatility === null) {
      continue;
    }

    const bias = h1BiasAt(
      breakoutClose,
      h1,
      ema50H1
    );

    if (bias === "NEUTRAL") {
      continue;
    }

    const recentCompression =
      averageTrueRange(
        m15,
        index - 8,
        index
      );

    const baselineVolatility =
      averageTrueRange(
        m15,
        index - 40,
        index - 8
      );

    if (
      recentCompression === null ||
      baselineVolatility === null ||
      recentCompression >
        baselineVolatility * 0.8
    ) {
      continue;
    }

    const previousRange = m15.slice(
      index - 20,
      index
    );

    const rangeHigh = Math.max(
      ...previousRange.map(
        (candle) => candle.high
      )
    );

    const rangeLow = Math.min(
      ...previousRange.map(
        (candle) => candle.low
      )
    );

    const candleRange =
      breakout.high - breakout.low;

    const body = Math.abs(
      breakout.close - breakout.open
    );

    if (
      candleRange <= 0 ||
      body < volatility * 0.7
    ) {
      continue;
    }

    const closeLocation =
      (breakout.close - breakout.low) /
      candleRange;

    const buyBreakout =
      bias === "BULLISH" &&
      breakout.close > rangeHigh &&
      closeLocation >= 0.7 &&
      breakout.close - rangeHigh <=
        volatility * 1.2;

    const sellBreakout =
      bias === "BEARISH" &&
      breakout.close < rangeLow &&
      closeLocation <= 0.3 &&
      rangeLow - breakout.close <=
        volatility * 1.2;

    if (!buyBreakout && !sellBreakout) {
      continue;
    }

    const direction: Direction =
      buyBreakout ? "BUY" : "SELL";

    const breakoutLevel =
      direction === "BUY"
        ? rangeHigh
        : rangeLow;

    const m5Start =
      firstIndexAtOrAfter(
        m5,
        breakoutClose
      );

    const m5End = Math.min(
      m5.length,
      m5Start + 6
    );

    for (
      let m5Index = m5Start;
      m5Index < m5End;
      m5Index++
    ) {
      const confirmation = m5[m5Index];
      const volatility5 =
        atr5[m5Index];

      if (volatility5 === null) {
        continue;
      }

      const entryTime =
        confirmation.time + M5_MS;

      if (
        minuteOfDay(entryTime) >
        SESSION_END_MINUTE
      ) {
        break;
      }

      if (
        h1BiasAt(
          entryTime,
          h1,
          ema50H1
        ) !== bias
      ) {
        break;
      }

      const confirmationBody = Math.abs(
        confirmation.close -
        confirmation.open
      );

      const continuationBuy =
        direction === "BUY" &&
        confirmation.close >
          breakout.high &&
        confirmation.close >
          confirmation.open &&
        confirmationBody >=
          volatility5 * 0.3;

      const continuationSell =
        direction === "SELL" &&
        confirmation.close <
          breakout.low &&
        confirmation.close <
          confirmation.open &&
        confirmationBody >=
          volatility5 * 0.3;

      const retestBuy =
        direction === "BUY" &&
        confirmation.low <=
          breakoutLevel +
            volatility * 0.15 &&
        confirmation.close >
          breakoutLevel &&
        confirmation.close >
          confirmation.open;

      const retestSell =
        direction === "SELL" &&
        confirmation.high >=
          breakoutLevel -
            volatility * 0.15 &&
        confirmation.close <
          breakoutLevel &&
        confirmation.close <
          confirmation.open;

      if (
        !continuationBuy &&
        !continuationSell &&
        !retestBuy &&
        !retestSell
      ) {
        continue;
      }

      const entry =
        direction === "BUY"
          ? confirmation.close +
            SPREAD +
            SLIPPAGE
          : confirmation.close -
            SLIPPAGE;

      const stopBase =
        direction === "BUY"
          ? Math.min(
              breakout.low,
              confirmation.low
            )
          : Math.max(
              breakout.high,
              confirmation.high
            );

      const stopLoss =
        direction === "BUY"
          ? stopBase -
            volatility * 0.1
          : stopBase +
            volatility * 0.1 +
            SPREAD;

      const risk = Math.abs(
        entry - stopLoss
      );

      if (
        risk <= SPREAD * 1.5 ||
        risk > volatility * 2.2
      ) {
        continue;
      }

      signals.push({
        direction,
        entryTime,
        entry,
        stopLoss,
        takeProfit:
          direction === "BUY"
            ? entry +
              risk * TARGET_R
            : entry -
              risk * TARGET_R,
        breakoutTime: breakout.time,
        breakoutLevel,
      });

      lastSignalTime = entryTime;
      index += 2;
      break;
    }
  }

  return signals;
}

function simulate(
  signals: Signal[],
  m5: Candle[]
) {
  const ordered = [...signals].sort(
    (a, b) =>
      a.entryTime - b.entryTime
  );

  let equity = 100000;
  let peak = equity;
  let maximumDrawdown = 0;
  let lastExitTime = 0;

  let wins = 0;
  let losses = 0;
  let breakeven = 0;
  let totalR = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let maximumConsecutiveLosses = 0;
  let currentConsecutiveLosses = 0;

  const dailyTrades =
    new Map<string, number>();

  const monthlyR =
    new Map<string, number>();

  const trades: Record<
    string,
    unknown
  >[] = [];

  for (const signal of ordered) {
    if (
      signal.entryTime <=
      lastExitTime
    ) {
      continue;
    }

    const dayKey = new Date(
      signal.entryTime
    )
      .toISOString()
      .slice(0, 10);

    const monthKey = dayKey.slice(0, 7);
    const dailyCount =
      dailyTrades.get(dayKey) || 0;

    if (
      dailyCount >=
      MAX_TRADES_PER_DAY
    ) {
      continue;
    }

    const start =
      firstIndexAtOrAfter(
        m5,
        signal.entryTime
      );

    if (start >= m5.length) {
      continue;
    }

    const riskDistance =
      Math.abs(
        signal.entry -
        signal.stopLoss
      );

    const maximumExitTime =
      signal.entryTime +
      MAX_HOLDING_BARS * M5_MS;

    const forcedExitTime =
      dayStart(signal.entryTime) +
      FORCED_EXIT_MINUTE *
        MINUTE_MS;

    const allowedExitTime =
      Math.min(
        maximumExitTime,
        forcedExitTime
      );

    const timeExitIndex =
      firstIndexAtOrAfter(
        m5,
        allowedExitTime
      ) - 1;

    const finalIndex =
      Math.min(
        m5.length - 1,
        start +
          MAX_HOLDING_BARS -
          1,
        timeExitIndex
      );

    if (finalIndex < start) {
      continue;
    }

    let resultR = 0;
    let outcome = "TIME";
    let exitTime =
      m5[finalIndex].time + M5_MS;

    for (
      let index = start;
      index <= finalIndex;
      index++
    ) {
      const candle = m5[index];

      const stopHit =
        signal.direction === "BUY"
          ? candle.low <=
            signal.stopLoss
          : candle.high + SPREAD >=
            signal.stopLoss;

      const targetHit =
        signal.direction === "BUY"
          ? candle.high >=
            signal.takeProfit
          : candle.low + SPREAD <=
            signal.takeProfit;

      if (stopHit) {
        resultR = -1;
        outcome = "SL";
        exitTime =
          candle.time + M5_MS;
        break;
      }

      if (targetHit) {
        resultR = TARGET_R;
        outcome = "TP";
        exitTime =
          candle.time + M5_MS;
        break;
      }

      if (index === finalIndex) {
        const effectiveClose =
          signal.direction === "BUY"
            ? candle.close
            : candle.close + SPREAD;

        resultR =
          signal.direction === "BUY"
            ? (effectiveClose -
                signal.entry) /
              riskDistance
            : (signal.entry -
                effectiveClose) /
              riskDistance;

        resultR = Math.max(
          -1,
          Math.min(
            TARGET_R,
            resultR
          )
        );
      }
    }

    const riskCash =
      equity *
      (RISK_PERCENT / 100);

    const pnl =
      riskCash * resultR;

    equity += pnl;
    peak = Math.max(peak, equity);

    maximumDrawdown =
      Math.max(
        maximumDrawdown,
        ((peak - equity) /
          peak) *
          100
      );

    totalR += resultR;

    monthlyR.set(
      monthKey,
      (monthlyR.get(monthKey) || 0) +
        resultR
    );

    if (resultR > 0.01) {
      wins++;
      grossProfit += pnl;
      currentConsecutiveLosses = 0;
    } else if (
      resultR < -0.01
    ) {
      losses++;
      grossLoss +=
        Math.abs(pnl);

      currentConsecutiveLosses++;

      maximumConsecutiveLosses =
        Math.max(
          maximumConsecutiveLosses,
          currentConsecutiveLosses
        );
    } else {
      breakeven++;
    }

    dailyTrades.set(
      dayKey,
      dailyCount + 1
    );

    lastExitTime = exitTime;

    trades.push({
      direction:
        signal.direction,
      entryTime:
        new Date(
          signal.entryTime
        ).toISOString(),
      exitTime:
        new Date(
          exitTime
        ).toISOString(),
      outcome,
      resultR:
        Number(
          resultR.toFixed(2)
        ),
    });
  }

  const totalTrades = trades.length;

  const profitFactor =
    grossLoss > 0
      ? grossProfit /
        grossLoss
      : null;

  const expectancyR =
    totalTrades > 0
      ? totalR /
        totalTrades
      : 0;

  const months = [
    ...monthlyR.entries(),
  ];

  const positiveMonths =
    months.filter(
      ([, value]) => value > 0
    ).length;

  return {
    totalTrades,
    wins,
    losses,
    breakeven,
    winRate:
      totalTrades > 0
        ? Number(
            (
              (wins /
                totalTrades) *
              100
            ).toFixed(2)
          )
        : 0,
    profitFactor:
      profitFactor === null
        ? null
        : Number(
            profitFactor.toFixed(2)
          ),
    expectancyR:
      Number(
        expectancyR.toFixed(3)
      ),
    netR:
      Number(
        totalR.toFixed(2)
      ),
    returnPercent:
      Number(
        (
          ((equity - 100000) /
            100000) *
          100
        ).toFixed(2)
      ),
    maximumDrawdownPercent:
      Number(
        maximumDrawdown.toFixed(2)
      ),
    maximumConsecutiveLosses,
    positiveMonths,
    totalMonths: months.length,
    positiveMonthsPercent:
      months.length > 0
        ? Number(
            (
              (positiveMonths /
                months.length) *
              100
            ).toFixed(2)
          )
        : 0,
    endingEquity:
      Number(
        equity.toFixed(2)
      ),
    recentTrades:
      trades.slice(-15),
  };
}

function evaluate(
  signals: Signal[],
  m5: Candle[],
  splitTime: number
) {
  return {
    all: simulate(signals, m5),
    training70: simulate(
      signals.filter(
        (signal) =>
          signal.entryTime <
          splitTime
      ),
      m5
    ),
    outOfSample30: simulate(
      signals.filter(
        (signal) =>
          signal.entryTime >=
          splitTime
      ),
      m5
    ),
  };
}

export async function GET() {
  try {
    const [
      h1Result,
      m15Result,
      m5Result,
    ] = await Promise.all([
      pool.query(
        `SELECT open_time, open, high, low, close
         FROM market_candles
         WHERE symbol = 'XAUUSD'
           AND timeframe = 'H1'
         ORDER BY open_time ASC`
      ),
      pool.query(
        `SELECT open_time, open, high, low, close
         FROM market_candles
         WHERE symbol = 'XAUUSD'
           AND timeframe = 'M15'
         ORDER BY open_time ASC`
      ),
      pool.query(
        `SELECT open_time, open, high, low, close
         FROM market_candles
         WHERE symbol = 'XAUUSD'
           AND timeframe = 'M5'
         ORDER BY open_time ASC`
      ),
    ]);

    const h1 =
      toCandles(
        h1Result.rows
      ).slice(0, -1);

    const m15 =
      toCandles(
        m15Result.rows
      ).slice(0, -1);

    const m5 =
      toCandles(
        m5Result.rows
      ).slice(0, -1);

    if (
      h1.length < 1000 ||
      m15.length < 3000 ||
      m5.length < 10000
    ) {
      return NextResponse.json(
        {
          error:
            "Historique insuffisant.",
        },
        { status: 400 }
      );
    }

    const ema50H1 =
      emaSeries(
        h1.map(
          (candle) =>
            candle.close
        ),
        50
      );

    const atr15 =
      atrSeries(m15);

    const atr5 =
      atrSeries(m5);

    const signals = createSignals(
      h1,
      m15,
      m5,
      ema50H1,
      atr15,
      atr5
    );

    const splitIndex =
      Math.floor(
        m5.length * 0.7
      );

    const splitTime =
      m5[splitIndex].time;

    const results = evaluate(
      signals,
      m5,
      splitTime
    );

    const all = results.all;
    const out = results.outOfSample30;

    const finalValidation =
      all.totalTrades >= 100 &&
      all.profitFactor !== null &&
      all.profitFactor >= 1.2 &&
      all.expectancyR >= 0.1 &&
      all.maximumDrawdownPercent < 5 &&
      out.totalTrades >= 25 &&
      out.profitFactor !== null &&
      out.profitFactor >= 1.15 &&
      out.expectancyR > 0.05 &&
      out.netR > 0;

    const periodMonths =
      (m5[m5.length - 1].time -
        m5[0].time) /
      (30.4375 *
        24 *
        H1_MS);

    return NextResponse.json(
      {
        strategy:
          "VOLATILITY_EXPANSION_BREAKOUT_V1",
        symbol: "XAUUSD",
        source: "FTMO-MT5",
        status: finalValidation
          ? "CANDIDATE_FOR_DEMO"
          : "DO_NOT_TRADE",
        frozenRules: {
          compression:
            "TR moyen 8 bougies <= 80% du TR moyen precedent",
          breakout:
            "Cassure range M15 20 bougies, corps >= 0.7 ATR",
          bias:
            "H1 au-dessus/sous EMA50 avec pente",
          confirmation:
            "Continuation ou retest M5",
          targetR: TARGET_R,
          riskPercent:
            RISK_PERCENT,
          sessionUtc:
            "06:00-20:00",
          spread: SPREAD,
          slippage: SLIPPAGE,
          maximumTradesPerDay:
            MAX_TRADES_PER_DAY,
          overnightTrades: false,
          ambiguousBar:
            "STOP_FIRST",
        },
        period: {
          from:
            new Date(
              m5[0].time
            ).toISOString(),
          to:
            new Date(
              m5[
                m5.length - 1
              ].time +
                M5_MS
            ).toISOString(),
          splitTime:
            new Date(
              splitTime
            ).toISOString(),
          approximateMonths:
            Number(
              periodMonths.toFixed(1)
            ),
        },
        detectedSignals:
          signals.length,
        signalsPerMonth:
          Number(
            (
              signals.length /
              periodMonths
            ).toFixed(2)
          ),
        results,
        validationChecks: {
          allTradesMinimum:
            all.totalTrades >= 100,
          allProfitFactor:
            all.profitFactor !== null &&
            all.profitFactor >= 1.2,
          allExpectancy:
            all.expectancyR >= 0.1,
          drawdown:
            all.maximumDrawdownPercent < 5,
          outOfSampleTrades:
            out.totalTrades >= 25,
          outOfSampleProfitFactor:
            out.profitFactor !== null &&
            out.profitFactor >= 1.15,
          outOfSampleExpectancy:
            out.expectancyR > 0.05,
          outOfSamplePositive:
            out.netR > 0,
          finalDecision:
            finalValidation
              ? "SHORT_DEMO_TEST_ALLOWED"
              : "DO_NOT_TRADE",
        },
        warning:
          "Backtest experimental avec couts fixes. Aucun resultat ne garantit les performances futures.",
      },
      {
        headers: {
          "Cache-Control":
            "no-store",
        },
      }
    );
  } catch (error) {
    console.error(
      "Erreur volatility breakout:",
      error
    );

    return NextResponse.json(
      {
        error:
          "Backtest Volatility Breakout impossible.",
      },
      { status: 500 }
    );
  }
}
