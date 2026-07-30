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
  forcedExitTime: number;
};

const M5_MS = 5 * 60 * 1000;
const H1_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

const SPREAD = 0.45;
const SLIPPAGE = 0.05;
const RISK_PERCENT = 0.1;
const TARGET_R = 1.5;

const MAX_HOLDING_BARS = 72;
const RANGE_DURATION_MINUTES = 30;
const TRADING_WINDOW_MINUTES = 150;

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

  if (values.length < period) return output;

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

function dayStart(timestamp: number) {
  const date = new Date(timestamp);

  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate()
  );
}

function nthSunday(
  year: number,
  month: number,
  occurrence: number
) {
  const firstDay = new Date(
    Date.UTC(year, month, 1)
  );

  const daysUntilSunday =
    (7 - firstDay.getUTCDay()) % 7;

  return Date.UTC(
    year,
    month,
    1 +
      daysUntilSunday +
      (occurrence - 1) * 7
  );
}

function lastSunday(
  year: number,
  month: number
) {
  const lastDay = new Date(
    Date.UTC(year, month + 1, 0)
  );

  return Date.UTC(
    year,
    month,
    lastDay.getUTCDate() -
      lastDay.getUTCDay()
  );
}

function isUsDst(day: number) {
  const date = new Date(day);
  const year = date.getUTCFullYear();

  const start = nthSunday(year, 2, 2);
  const end = nthSunday(year, 10, 1);

  return day >= start && day < end;
}

function isEuropeDst(day: number) {
  const date = new Date(day);
  const year = date.getUTCFullYear();

  const start = lastSunday(year, 2);
  const end = lastSunday(year, 9);

  return day >= start && day < end;
}

function newYorkSessionOnFtmoClock(
  day: number
) {
  const ftmoUtcOffset =
    isEuropeDst(day) ? 3 : 2;

  const newYorkUtcOffset =
    isUsDst(day) ? -4 : -5;

  const difference =
    ftmoUtcOffset - newYorkUtcOffset;

  const openMinute =
    9 * 60 + 30 + difference * 60;

  const rangeStart =
    day + openMinute * MINUTE_MS;

  const rangeEnd =
    rangeStart +
    RANGE_DURATION_MINUTES * MINUTE_MS;

  const tradeEnd =
    rangeEnd +
    TRADING_WINDOW_MINUTES * MINUTE_MS;

  return {
    rangeStart,
    rangeEnd,
    tradeEnd,
    ftmoUtcOffset,
    newYorkUtcOffset,
  };
}

function h1BiasAt(
  timestamp: number,
  h1: Candle[],
  ema20: Array<number | null>,
  ema50: Array<number | null>
): Bias {
  const index = lastClosedIndex(
    h1,
    H1_MS,
    timestamp
  );

  if (
    index < 3 ||
    ema20[index] === null ||
    ema50[index] === null ||
    ema20[index - 3] === null
  ) {
    return "NEUTRAL";
  }

  const close = h1[index].close;
  const fast = ema20[index] as number;
  const slow = ema50[index] as number;
  const previousFast =
    ema20[index - 3] as number;

  if (
    close > slow &&
    fast > slow &&
    fast >= previousFast
  ) {
    return "BULLISH";
  }

  if (
    close < slow &&
    fast < slow &&
    fast <= previousFast
  ) {
    return "BEARISH";
  }

  return "NEUTRAL";
}

function createSignals(
  days: number[],
  h1: Candle[],
  m5: Candle[],
  ema20H1: Array<number | null>,
  ema50H1: Array<number | null>,
  atr5: Array<number | null>
): Signal[] {
  const signals: Signal[] = [];

  for (const day of days) {
    const session =
      newYorkSessionOnFtmoClock(day);

    const rangeStartIndex =
      firstIndexAtOrAfter(
        m5,
        session.rangeStart
      );

    const rangeEndIndex =
      firstIndexAtOrAfter(
        m5,
        session.rangeEnd
      );

    const rangeCandles = m5.slice(
      rangeStartIndex,
      rangeEndIndex
    );

    if (rangeCandles.length < 6) {
      continue;
    }

    const rangeHigh = Math.max(
      ...rangeCandles.map(
        (candle) => candle.high
      )
    );

    const rangeLow = Math.min(
      ...rangeCandles.map(
        (candle) => candle.low
      )
    );

    const rangeWidth =
      rangeHigh - rangeLow;

    const bias = h1BiasAt(
      session.rangeEnd,
      h1,
      ema20H1,
      ema50H1
    );

    if (bias === "NEUTRAL") {
      continue;
    }

    const referenceAtr =
      atr5[Math.max(0, rangeEndIndex - 1)];

    if (
      referenceAtr === null ||
      rangeWidth <
        referenceAtr * 1.2 ||
      rangeWidth >
        referenceAtr * 8
    ) {
      continue;
    }

    const tradeStart =
      rangeEndIndex;

    const tradeEnd =
      firstIndexAtOrAfter(
        m5,
        session.tradeEnd
      );

    for (
      let index = tradeStart;
      index < tradeEnd;
      index++
    ) {
      const candle = m5[index];
      const volatility = atr5[index];

      if (volatility === null) {
        continue;
      }

      const candleRange =
        candle.high - candle.low;

      const body = Math.abs(
        candle.close - candle.open
      );

      if (
        candleRange <= 0 ||
        body < volatility * 0.45 ||
        body > volatility * 2.5
      ) {
        continue;
      }

      const closeLocation =
        (candle.close - candle.low) /
        candleRange;

      const breakoutBuffer =
        volatility * 0.05;

      const buyBreakout =
        bias === "BULLISH" &&
        candle.close >
          rangeHigh + breakoutBuffer &&
        closeLocation >= 0.7;

      const sellBreakout =
        bias === "BEARISH" &&
        candle.close <
          rangeLow - breakoutBuffer &&
        closeLocation <= 0.3;

      if (!buyBreakout && !sellBreakout) {
        continue;
      }

      const direction: Direction =
        buyBreakout ? "BUY" : "SELL";

      const entry =
        direction === "BUY"
          ? candle.close +
            SPREAD +
            SLIPPAGE
          : candle.close -
            SLIPPAGE;

      const rangeMidpoint =
        (rangeHigh + rangeLow) / 2;

      const stopLoss =
        direction === "BUY"
          ? rangeMidpoint -
            volatility * 0.1
          : rangeMidpoint +
            volatility * 0.1;

      const risk = Math.abs(
        entry - stopLoss
      );

      if (
        risk <= SPREAD * 1.5 ||
        risk >
          rangeWidth * 1.8
      ) {
        continue;
      }

      const takeProfit =
        direction === "BUY"
          ? entry + risk * TARGET_R
          : entry - risk * TARGET_R;

      signals.push({
        direction,
        entryTime:
          candle.time + M5_MS,
        entry,
        stopLoss,
        takeProfit,
        forcedExitTime:
          session.tradeEnd,
      });

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

    const start =
      firstIndexAtOrAfter(
        m5,
        signal.entryTime
      );

    if (start >= m5.length) {
      continue;
    }

    const maximumExit =
      signal.entryTime +
      MAX_HOLDING_BARS * M5_MS;

    const allowedExit =
      Math.min(
        maximumExit,
        signal.forcedExitTime
      );

    const finalIndex =
      Math.min(
        m5.length - 1,
        start +
          MAX_HOLDING_BARS -
          1,
        firstIndexAtOrAfter(
          m5,
          allowedExit
        ) - 1
      );

    if (finalIndex < start) {
      continue;
    }

    const riskDistance =
      Math.abs(
        signal.entry -
        signal.stopLoss
      );

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

    const monthKey =
      new Date(signal.entryTime)
        .toISOString()
        .slice(0, 7);

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
      grossLoss += Math.abs(pnl);
      currentConsecutiveLosses++;

      maximumConsecutiveLosses =
        Math.max(
          maximumConsecutiveLosses,
          currentConsecutiveLosses
        );
    } else {
      breakeven++;
    }

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
    ...monthlyR.values(),
  ];

  const positiveMonths =
    months.filter(
      (value) => value > 0
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
           AND timeframe = 'M5'
         ORDER BY open_time ASC`
      ),
    ]);

    const h1 =
      toCandles(
        h1Result.rows
      ).slice(0, -1);

    const m5 =
      toCandles(
        m5Result.rows
      ).slice(0, -1);

    if (
      h1.length < 1000 ||
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

    const ema20H1 =
      emaSeries(
        h1.map(
          (candle) =>
            candle.close
        ),
        20
      );

    const ema50H1 =
      emaSeries(
        h1.map(
          (candle) =>
            candle.close
        ),
        50
      );

    const atr5 =
      atrSeries(m5);

    const days = [
      ...new Set(
        m5.map(
          (candle) =>
            dayStart(
              candle.time
            )
        )
      ),
    ].sort(
      (a, b) => a - b
    );

    const signals = createSignals(
      days,
      h1,
      m5,
      ema20H1,
      ema50H1,
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
    const out =
      results.outOfSample30;

    const validation =
      all.totalTrades >= 100 &&
      all.profitFactor !== null &&
      all.profitFactor >= 1.25 &&
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
          "NEW_YORK_ORB_V1_FROZEN",
        symbol: "XAUUSD",
        source: "FTMO-MT5",
        status: validation
          ? "CANDIDATE_FOR_DEMO"
          : "DO_NOT_TRADE",
        timing: {
          newYorkLocalRange:
            "09:30-10:00 America/New_York",
          ftmoConversion:
            "Automatic US and Europe DST",
          tradeWindow:
            "150 minutes after opening range",
        },
        frozenRules: {
          range:
            "First 30 minutes after New York cash open",
          bias:
            "H1 EMA20/50 with EMA20 slope",
          breakout:
            "M5 close outside range with 0.45 ATR body",
          stop:
            "Opening range midpoint plus ATR buffer",
          targetR:
            TARGET_R,
          riskPercent:
            RISK_PERCENT,
          spread:
            SPREAD,
          slippage:
            SLIPPAGE,
          maximumTradesPerDay:
            1,
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
            all.profitFactor >= 1.25,
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
            validation
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
      "Erreur NY ORB:",
      error
    );

    return NextResponse.json(
      {
        error:
          "Backtest NY ORB impossible.",
      },
      { status: 500 }
    );
  }
}
