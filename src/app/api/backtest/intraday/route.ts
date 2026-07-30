import { NextResponse } from "next/server";
import { pool } from "@/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Direction = "BUY" | "SELL";
type ModuleName =
  | "LONDON_SWEEP"
  | "NEW_YORK_CONTINUATION";

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
};

const M5_MS = 5 * 60 * 1000;
const M15_MS = 15 * 60 * 1000;
const H1_MS = 60 * 60 * 1000;

const SPREAD = 0.45;
const SLIPPAGE = 0.05;
const RISK_PERCENT = 0.1;
const TARGET_R = 2;
const MAX_TRADES_PER_DAY = 2;
const MAX_HOLDING_BARS = 72;

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
    values.slice(0, period).reduce(
      (sum, item) => sum + item,
      0
    ) / period;

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

  const ranges: number[] = new Array(
    candles.length
  ).fill(0);

  for (let index = 1; index < candles.length; index++) {
    const candle = candles[index];
    const previousClose = candles[index - 1].close;

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
          (sum, value) => sum + value,
          0
        ) / recent.length;
    }
  }

  return output;
}

function adxSeries(
  candles: Candle[],
  period = 14
): Array<number | null> {
  const output: Array<number | null> =
    new Array(candles.length).fill(null);

  const trueRanges: number[] =
    new Array(candles.length).fill(0);

  const plusDm: number[] =
    new Array(candles.length).fill(0);

  const minusDm: number[] =
    new Array(candles.length).fill(0);

  const dx: Array<number | null> =
    new Array(candles.length).fill(null);

  let smoothTr = 0;
  let smoothPlus = 0;
  let smoothMinus = 0;
  let currentAdx = 0;

  for (let index = 1; index < candles.length; index++) {
    const current = candles[index];
    const previous = candles[index - 1];

    const upMove = current.high - previous.high;
    const downMove = previous.low - current.low;

    plusDm[index] =
      upMove > downMove && upMove > 0
        ? upMove
        : 0;

    minusDm[index] =
      downMove > upMove && downMove > 0
        ? downMove
        : 0;

    trueRanges[index] = Math.max(
      current.high - current.low,
      Math.abs(current.high - previous.close),
      Math.abs(current.low - previous.close)
    );

    if (index === period) {
      smoothTr = trueRanges
        .slice(1, period + 1)
        .reduce((sum, value) => sum + value, 0);

      smoothPlus = plusDm
        .slice(1, period + 1)
        .reduce((sum, value) => sum + value, 0);

      smoothMinus = minusDm
        .slice(1, period + 1)
        .reduce((sum, value) => sum + value, 0);
    } else if (index > period) {
      smoothTr =
        smoothTr - smoothTr / period +
        trueRanges[index];

      smoothPlus =
        smoothPlus - smoothPlus / period +
        plusDm[index];

      smoothMinus =
        smoothMinus - smoothMinus / period +
        minusDm[index];
    }

    if (index >= period && smoothTr > 0) {
      const plusDi =
        (100 * smoothPlus) / smoothTr;

      const minusDi =
        (100 * smoothMinus) / smoothTr;

      const total = plusDi + minusDi;

      dx[index] =
        total > 0
          ? (100 * Math.abs(plusDi - minusDi)) /
            total
          : 0;
    }

    if (index === period * 2 - 1) {
      const values = dx
        .slice(period, period * 2)
        .filter(
          (value): value is number =>
            value !== null
        );

      currentAdx =
        values.reduce(
          (sum, value) => sum + value,
          0
        ) / values.length;

      output[index] = currentAdx;
    } else if (
      index >= period * 2 &&
      dx[index] !== null
    ) {
      currentAdx =
        (currentAdx * (period - 1) +
          (dx[index] as number)) /
        period;

      output[index] = currentAdx;
    }
  }

  return output;
}

function choppinessSeries(
  candles: Candle[],
  period = 14
): Array<number | null> {
  const output: Array<number | null> =
    new Array(candles.length).fill(null);

  for (
    let index = period;
    index < candles.length;
    index++
  ) {
    const window = candles.slice(
      index - period + 1,
      index + 1
    );

    let trueRangeSum = 0;

    for (
      let windowIndex = 0;
      windowIndex < window.length;
      windowIndex++
    ) {
      const candle = window[windowIndex];

      const previousClose =
        windowIndex === 0
          ? candle.open
          : window[windowIndex - 1].close;

      trueRangeSum += Math.max(
        candle.high - candle.low,
        Math.abs(candle.high - previousClose),
        Math.abs(candle.low - previousClose)
      );
    }

    const highest = Math.max(
      ...window.map((candle) => candle.high)
    );

    const lowest = Math.min(
      ...window.map((candle) => candle.low)
    );

    const range = highest - lowest;

    if (range > 0 && trueRangeSum > 0) {
      output[index] =
        (100 *
          Math.log10(trueRangeSum / range)) /
        Math.log10(period);
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

function biasAt(
  timestamp: number,
  h1: Candle[],
  ema20: Array<number | null>,
  ema50: Array<number | null>
) {
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

function filtersPass(
  m15Index: number,
  adx15: Array<number | null>,
  chop15: Array<number | null>
) {
  const adx = adx15[m15Index];
  const chop = chop15[m15Index];

  return (
    adx !== null &&
    chop !== null &&
    adx >= 18 &&
    chop <= 61.8
  );
}

function createLondonSignals(
  days: number[],
  h1: Candle[],
  m15: Candle[],
  m5: Candle[],
  ema20: Array<number | null>,
  ema50: Array<number | null>,
  atr15: Array<number | null>,
  atr5: Array<number | null>,
  adx15: Array<number | null>,
  chop15: Array<number | null>
): Signal[] {
  const signals: Signal[] = [];

  for (const day of days) {
    const asianStart = day;
    const asianEnd = day + 8 * H1_MS;

    const asia = m15.filter(
      (candle) =>
        candle.time >= asianStart &&
        candle.time < asianEnd
    );

    if (asia.length < 16) continue;

    const asianHigh = Math.max(
      ...asia.map((candle) => candle.high)
    );

    const asianLow = Math.min(
      ...asia.map((candle) => candle.low)
    );

    const londonStart =
      firstIndexAtOrAfter(
        m5,
        day + 8 * H1_MS
      );

    const londonEnd =
      firstIndexAtOrAfter(
        m5,
        day + 12 * H1_MS
      );

    let created = false;

    for (
      let sweepIndex = londonStart;
      sweepIndex < londonEnd && !created;
      sweepIndex++
    ) {
      const sweep = m5[sweepIndex];
      const sweepClose =
        sweep.time + M5_MS;

      const bias = biasAt(
        sweepClose,
        h1,
        ema20,
        ema50
      );

      const buySweep =
        bias === "BULLISH" &&
        sweep.low < asianLow &&
        sweep.close > asianLow;

      const sellSweep =
        bias === "BEARISH" &&
        sweep.high > asianHigh &&
        sweep.close < asianHigh;

      if (!buySweep && !sellSweep) continue;

      const direction: Direction =
        buySweep ? "BUY" : "SELL";

      const confirmationEnd = Math.min(
        londonEnd,
        sweepIndex + 7
      );

      for (
        let index = sweepIndex + 1;
        index < confirmationEnd;
        index++
      ) {
        const current = m5[index];
        const volatility5 = atr5[index];

        if (volatility5 === null) continue;

        const body = Math.abs(
          current.close - current.open
        );

        const confirmation =
          direction === "BUY"
            ? current.close > sweep.high
            : current.close < sweep.low;

        if (
          !confirmation ||
          body < volatility5 * 0.4
        ) {
          continue;
        }

        const entryTime =
          current.time + M5_MS;

        const m15Index = lastClosedIndex(
          m15,
          M15_MS,
          entryTime
        );

        if (
          m15Index < 0 ||
          !filtersPass(
            m15Index,
            adx15,
            chop15
          ) ||
          atr15[m15Index] === null
        ) {
          continue;
        }

        const volatility15 =
          atr15[m15Index] as number;

        const entry =
          direction === "BUY"
            ? current.close +
              SPREAD +
              SLIPPAGE
            : current.close - SLIPPAGE;

        const stopLoss =
          direction === "BUY"
            ? sweep.low -
              volatility15 * 0.15
            : sweep.high +
              volatility15 * 0.15 +
              SPREAD;

        const risk = Math.abs(
          entry - stopLoss
        );

        if (
          risk <= SPREAD ||
          risk > volatility15 * 2.5
        ) {
          continue;
        }

        signals.push({
          module: "LONDON_SWEEP",
          direction,
          entryTime,
          entry,
          stopLoss,
          takeProfit:
            direction === "BUY"
              ? entry + risk * TARGET_R
              : entry - risk * TARGET_R,
        });

        created = true;
        break;
      }
    }
  }

  return signals;
}

function createNewYorkSignals(
  days: number[],
  h1: Candle[],
  m15: Candle[],
  m5: Candle[],
  ema20: Array<number | null>,
  ema50: Array<number | null>,
  atr15: Array<number | null>,
  atr5: Array<number | null>,
  adx15: Array<number | null>,
  chop15: Array<number | null>
): Signal[] {
  const signals: Signal[] = [];

  for (const day of days) {
    const rangeStart = day + 9 * H1_MS;
    const rangeEnd =
      day +
      14 * H1_MS +
      30 * 60 * 1000;

    const preNewYork = m15.filter(
      (candle) =>
        candle.time >= rangeStart &&
        candle.time < rangeEnd
    );

    if (preNewYork.length < 12) continue;

    const rangeHigh = Math.max(
      ...preNewYork.map(
        (candle) => candle.high
      )
    );

    const rangeLow = Math.min(
      ...preNewYork.map(
        (candle) => candle.low
      )
    );

    const breakoutStart =
      firstIndexAtOrAfter(m15, rangeEnd);

    const breakoutEnd =
      firstIndexAtOrAfter(
        m15,
        day + 17 * H1_MS
      );

    let created = false;

    for (
      let breakoutIndex = breakoutStart;
      breakoutIndex < breakoutEnd &&
      !created;
      breakoutIndex++
    ) {
      const breakout = m15[breakoutIndex];
      const breakoutClose =
        breakout.time + M15_MS;

      const bias = biasAt(
        breakoutClose,
        h1,
        ema20,
        ema50
      );

      const volatility15 =
        atr15[breakoutIndex];

      if (
        bias === "NEUTRAL" ||
        volatility15 === null ||
        !filtersPass(
          breakoutIndex,
          adx15,
          chop15
        )
      ) {
        continue;
      }

      const body = Math.abs(
        breakout.close - breakout.open
      );

      const buyBreakout =
        bias === "BULLISH" &&
        breakout.close > rangeHigh &&
        body >= volatility15 * 0.6;

      const sellBreakout =
        bias === "BEARISH" &&
        breakout.close < rangeLow &&
        body >= volatility15 * 0.6;

      if (!buyBreakout && !sellBreakout) {
        continue;
      }

      const direction: Direction =
        buyBreakout ? "BUY" : "SELL";

      const level =
        direction === "BUY"
          ? rangeHigh
          : rangeLow;

      const pullbackEnd = Math.min(
        m15.length,
        breakoutIndex + 5
      );

      for (
        let pullbackIndex =
          breakoutIndex + 1;
        pullbackIndex < pullbackEnd;
        pullbackIndex++
      ) {
        const pullback =
          m15[pullbackIndex];

        const buyPullback =
          direction === "BUY" &&
          pullback.low <=
            level + volatility15 * 0.2 &&
          pullback.low >=
            level - volatility15 * 0.5 &&
          pullback.close > level;

        const sellPullback =
          direction === "SELL" &&
          pullback.high >=
            level - volatility15 * 0.2 &&
          pullback.high <=
            level + volatility15 * 0.5 &&
          pullback.close < level;

        if (!buyPullback && !sellPullback) {
          continue;
        }

        const pullbackClose =
          pullback.time + M15_MS;

        const m5Start =
          firstIndexAtOrAfter(
            m5,
            pullbackClose
          );

        const m5End = Math.min(
          m5.length,
          m5Start + 7
        );

        for (
          let index = m5Start;
          index < m5End;
          index++
        ) {
          const current = m5[index];
          const volatility5 = atr5[index];

          if (volatility5 === null) continue;

          const bodyM5 = Math.abs(
            current.close - current.open
          );

          const confirmation =
            direction === "BUY"
              ? current.close >
                pullback.high
              : current.close <
                pullback.low;

          if (
            !confirmation ||
            bodyM5 < volatility5 * 0.4
          ) {
            continue;
          }

          const entryTime =
            current.time + M5_MS;

          if (
            minuteOfDay(entryTime) >
            18 * 60 + 30
          ) {
            break;
          }

          if (
            biasAt(
              entryTime,
              h1,
              ema20,
              ema50
            ) !== bias
          ) {
            break;
          }

          const entry =
            direction === "BUY"
              ? current.close +
                SPREAD +
                SLIPPAGE
              : current.close -
                SLIPPAGE;

          const stopLoss =
            direction === "BUY"
              ? pullback.low -
                volatility15 * 0.15
              : pullback.high +
                volatility15 * 0.15 +
                SPREAD;

          const risk = Math.abs(
            entry - stopLoss
          );

          if (
            risk <= SPREAD ||
            risk > volatility15 * 2.5
          ) {
            continue;
          }

          signals.push({
            module:
              "NEW_YORK_CONTINUATION",
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
          });

          created = true;
          break;
        }

        if (created) break;
      }
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
  let totalR = 0;
  let grossProfit = 0;
  let grossLoss = 0;

  const dailyTrades =
    new Map<string, number>();

  const trades: Record<
    string,
    unknown
  >[] = [];

  for (const signal of ordered) {
    if (signal.entryTime <= lastExitTime) {
      continue;
    }

    const day = new Date(
      signal.entryTime
    )
      .toISOString()
      .slice(0, 10);

    const dailyCount =
      dailyTrades.get(day) || 0;

    if (
      dailyCount >= MAX_TRADES_PER_DAY
    ) {
      continue;
    }

    const start =
      firstIndexAtOrAfter(
        m5,
        signal.entryTime
      );

    if (start >= m5.length) continue;

    const riskDistance = Math.abs(
      signal.entry - signal.stopLoss
    );

    const finalIndex = Math.min(
      m5.length - 1,
      start + MAX_HOLDING_BARS
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
        const close =
          signal.direction === "BUY"
            ? candle.close
            : candle.close + SPREAD;

        resultR =
          signal.direction === "BUY"
            ? (close - signal.entry) /
              riskDistance
            : (signal.entry - close) /
              riskDistance;

        resultR = Math.max(
          -1,
          Math.min(TARGET_R, resultR)
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

    maximumDrawdown = Math.max(
      maximumDrawdown,
      ((peak - equity) / peak) * 100
    );

    totalR += resultR;

    if (resultR > 0) {
      wins++;
      grossProfit += pnl;
    } else {
      losses++;
      grossLoss += Math.abs(pnl);
    }

    dailyTrades.set(
      day,
      dailyCount + 1
    );

    lastExitTime = exitTime;

    trades.push({
      module: signal.module,
      direction: signal.direction,
      entryTime: new Date(
        signal.entryTime
      ).toISOString(),
      exitTime: new Date(
        exitTime
      ).toISOString(),
      outcome,
      resultR: Number(
        resultR.toFixed(2)
      ),
    });
  }

  const totalTrades = trades.length;

  const profitFactor =
    grossLoss > 0
      ? grossProfit / grossLoss
      : null;

  const expectancyR =
    totalTrades > 0
      ? totalR / totalTrades
      : 0;

  return {
    totalTrades,
    wins,
    losses,
    winRate:
      totalTrades > 0
        ? Number(
            (
              (wins / totalTrades) *
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
    expectancyR: Number(
      expectancyR.toFixed(3)
    ),
    netR: Number(
      totalR.toFixed(2)
    ),
    returnPercent: Number(
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
    endingEquity: Number(
      equity.toFixed(2)
    ),
    passesBasicCriteria:
      totalTrades >= 100 &&
      profitFactor !== null &&
      profitFactor >= 1.2 &&
      expectancyR >= 0.1 &&
      maximumDrawdown < 5,
    recentTrades:
      trades.slice(-10),
  };
}

function evaluateModule(
  signals: Signal[],
  m5: Candle[],
  splitTime: number
) {
  const trainingSignals =
    signals.filter(
      (signal) =>
        signal.entryTime < splitTime
    );

  const testSignals =
    signals.filter(
      (signal) =>
        signal.entryTime >= splitTime
    );

  return {
    all: simulate(signals, m5),
    training70: simulate(
      trainingSignals,
      m5
    ),
    outOfSample30: simulate(
      testSignals,
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

    const h1 = toCandles(
      h1Result.rows
    ).slice(0, -1);

    const m15 = toCandles(
      m15Result.rows
    ).slice(0, -1);

    const m5 = toCandles(
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
            "Historique intraday insuffisant.",
          counts: {
            h1: h1.length,
            m15: m15.length,
            m5: m5.length,
          },
        },
        { status: 400 }
      );
    }

    const closesH1 = h1.map(
      (candle) => candle.close
    );

    const ema20 = emaSeries(
      closesH1,
      20
    );

    const ema50 = emaSeries(
      closesH1,
      50
    );

    const atr15 =
      atrSeries(m15);

    const atr5 =
      atrSeries(m5);

    const adx15 =
      adxSeries(m15);

    const chop15 =
      choppinessSeries(m15);

    const days = [
      ...new Set(
        m15.map((candle) =>
          dayStart(candle.time)
        )
      ),
    ].sort((a, b) => a - b);

    const londonSignals =
      createLondonSignals(
        days,
        h1,
        m15,
        m5,
        ema20,
        ema50,
        atr15,
        atr5,
        adx15,
        chop15
      );

    const newYorkSignals =
      createNewYorkSignals(
        days,
        h1,
        m15,
        m5,
        ema20,
        ema50,
        atr15,
        atr5,
        adx15,
        chop15
      );

    const splitIndex = Math.floor(
      m5.length * 0.7
    );

    const splitTime =
      m5[splitIndex].time;

    const combinedSignals = [
      ...londonSignals,
      ...newYorkSignals,
    ];

    return NextResponse.json(
      {
        symbol: "XAUUSD",
        source: "FTMO-MT5",
        period: {
          from: new Date(
            m5[0].time
          ).toISOString(),
          to: new Date(
            m5[m5.length - 1].time +
              M5_MS
          ).toISOString(),
          splitTime:
            new Date(
              splitTime
            ).toISOString(),
        },
        assumptions: {
          startingEquity: 100000,
          riskPercentPerTrade:
            RISK_PERCENT,
          targetR: TARGET_R,
          spread: SPREAD,
          slippage: SLIPPAGE,
          maximumTradesPerDay:
            MAX_TRADES_PER_DAY,
          ambiguousBarRule:
            "STOP_FIRST",
          filters:
            "H1 EMA20/50, M15 ADX >= 18, Choppiness <= 61.8",
        },
        detected: {
          london:
            londonSignals.length,
          newYork:
            newYorkSignals.length,
          combined:
            combinedSignals.length,
        },
        results: {
          london: evaluateModule(
            londonSignals,
            m5,
            splitTime
          ),
          newYork: evaluateModule(
            newYorkSignals,
            m5,
            splitTime
          ),
          combined: evaluateModule(
            combinedSignals,
            m5,
            splitTime
          ),
        },
        acceptanceCriteria: {
          totalTradesMinimum: 100,
          profitFactorMinimum: 1.2,
          expectancyRMinimum: 0.1,
          maximumDrawdownPercent: 5,
          outOfSampleMustBePositive:
            true,
        },
        warning:
          "Backtest experimental. Aucun resultat ne garantit les performances futures.",
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (error) {
    console.error(
      "Erreur backtest intraday:",
      error
    );

    return NextResponse.json(
      {
        error:
          "Backtest intraday impossible.",
      },
      { status: 500 }
    );
  }
}
