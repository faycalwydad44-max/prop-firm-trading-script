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
  impulseTime: number;
  pullbackTime: number;
};

const M5_MS = 5 * 60 * 1000;
const M15_MS = 15 * 60 * 1000;
const H1_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

const SPREAD = 0.45;
const SLIPPAGE = 0.05;
const RISK_PERCENT = 0.1;
const TARGET_R = 1.8;

const MAX_TRADES_PER_DAY = 2;
const MAX_HOLDING_BARS = 72;
const SESSION_START_MINUTE = 7 * 60;
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

function adxSeries(
  candles: Candle[],
  period = 14
): Array<number | null> {
  const output: Array<number | null> =
    new Array(candles.length).fill(null);

  const tr =
    new Array<number>(candles.length).fill(0);

  const plusDm =
    new Array<number>(candles.length).fill(0);

  const minusDm =
    new Array<number>(candles.length).fill(0);

  const dx: Array<number | null> =
    new Array(candles.length).fill(null);

  let smoothTr = 0;
  let smoothPlus = 0;
  let smoothMinus = 0;
  let currentAdx = 0;

  for (
    let index = 1;
    index < candles.length;
    index++
  ) {
    const current = candles[index];
    const previous = candles[index - 1];

    const upMove =
      current.high - previous.high;

    const downMove =
      previous.low - current.low;

    plusDm[index] =
      upMove > downMove && upMove > 0
        ? upMove
        : 0;

    minusDm[index] =
      downMove > upMove && downMove > 0
        ? downMove
        : 0;

    tr[index] = Math.max(
      current.high - current.low,
      Math.abs(current.high - previous.close),
      Math.abs(current.low - previous.close)
    );

    if (index === period) {
      smoothTr = tr
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
        smoothTr -
        smoothTr / period +
        tr[index];

      smoothPlus =
        smoothPlus -
        smoothPlus / period +
        plusDm[index];

      smoothMinus =
        smoothMinus -
        smoothMinus / period +
        minusDm[index];
    }

    if (
      index >= period &&
      smoothTr > 0
    ) {
      const plusDi =
        (100 * smoothPlus) / smoothTr;

      const minusDi =
        (100 * smoothMinus) / smoothTr;

      const total = plusDi + minusDi;

      dx[index] =
        total > 0
          ? (100 *
              Math.abs(plusDi - minusDi)) /
            total
          : 0;
    }

    if (index === period * 2 - 1) {
      const initial = dx
        .slice(period, period * 2)
        .filter(
          (value): value is number =>
            value !== null
        );

      if (initial.length > 0) {
        currentAdx =
          initial.reduce(
            (sum, value) => sum + value,
            0
          ) / initial.length;

        output[index] = currentAdx;
      }
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
      let itemIndex = 0;
      itemIndex < window.length;
      itemIndex++
    ) {
      const candle = window[itemIndex];

      const previousClose =
        itemIndex === 0
          ? candle.open
          : window[itemIndex - 1].close;

      trueRangeSum += Math.max(
        candle.high - candle.low,
        Math.abs(candle.high - previousClose),
        Math.abs(candle.low - previousClose)
      );
    }

    const highest = Math.max(
      ...window.map(
        (candle) => candle.high
      )
    );

    const lowest = Math.min(
      ...window.map(
        (candle) => candle.low
      )
    );

    const range = highest - lowest;

    if (
      range > 0 &&
      trueRangeSum > 0
    ) {
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

function h1BiasAt(
  timestamp: number,
  h1: Candle[],
  ema20H1: Array<number | null>,
  ema50H1: Array<number | null>
): Bias {
  const index = lastClosedIndex(
    h1,
    H1_MS,
    timestamp
  );

  if (
    index < 3 ||
    ema20H1[index] === null ||
    ema50H1[index] === null ||
    ema20H1[index - 3] === null
  ) {
    return "NEUTRAL";
  }

  const close = h1[index].close;
  const fast = ema20H1[index] as number;
  const slow = ema50H1[index] as number;
  const previousFast =
    ema20H1[index - 3] as number;

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

function findImpulse(
  pullbackIndex: number,
  direction: Direction,
  m15: Candle[],
  atr15: Array<number | null>
) {
  const firstIndex = Math.max(
    8,
    pullbackIndex - 8
  );

  for (
    let index = pullbackIndex - 1;
    index >= firstIndex;
    index--
  ) {
    const candle = m15[index];
    const volatility = atr15[index];

    if (volatility === null) {
      continue;
    }

    const previous = m15.slice(
      index - 6,
      index
    );

    const previousHigh = Math.max(
      ...previous.map(
        (item) => item.high
      )
    );

    const previousLow = Math.min(
      ...previous.map(
        (item) => item.low
      )
    );

    const body = Math.abs(
      candle.close - candle.open
    );

    const buyImpulse =
      direction === "BUY" &&
      candle.close > candle.open &&
      candle.close > previousHigh &&
      body >= volatility * 0.55;

    const sellImpulse =
      direction === "SELL" &&
      candle.close < candle.open &&
      candle.close < previousLow &&
      body >= volatility * 0.55;

    if (
      buyImpulse ||
      sellImpulse
    ) {
      return {
        index,
        candle,
        breakoutLevel:
          direction === "BUY"
            ? previousHigh
            : previousLow,
      };
    }
  }

  return null;
}

function createSignals(
  h1: Candle[],
  m15: Candle[],
  m5: Candle[],
  ema20H1: Array<number | null>,
  ema50H1: Array<number | null>,
  ema20M15: Array<number | null>,
  ema50M15: Array<number | null>,
  atr15: Array<number | null>,
  atr5: Array<number | null>,
  adx15: Array<number | null>,
  chop15: Array<number | null>
): Signal[] {
  const signals: Signal[] = [];
  let lastSignalTime = 0;

  for (
    let pullbackIndex = 60;
    pullbackIndex < m15.length;
    pullbackIndex++
  ) {
    const pullback = m15[pullbackIndex];
    const pullbackClose =
      pullback.time + M15_MS;

    const minutes =
      minuteOfDay(pullbackClose);

    if (
      minutes < SESSION_START_MINUTE ||
      minutes > SESSION_END_MINUTE
    ) {
      continue;
    }

    if (
      pullbackClose -
        lastSignalTime <
      90 * MINUTE_MS
    ) {
      continue;
    }

    const bias = h1BiasAt(
      pullbackClose,
      h1,
      ema20H1,
      ema50H1
    );

    if (bias === "NEUTRAL") {
      continue;
    }

    const fast =
      ema20M15[pullbackIndex];

    const slow =
      ema50M15[pullbackIndex];

    const volatility15 =
      atr15[pullbackIndex];

    const adx =
      adx15[pullbackIndex];

    const chop =
      chop15[pullbackIndex];

    if (
      fast === null ||
      slow === null ||
      volatility15 === null ||
      adx === null ||
      chop === null ||
      adx < 17 ||
      chop > 62
    ) {
      continue;
    }

    const direction: Direction =
      bias === "BULLISH"
        ? "BUY"
        : "SELL";

    const trendAligned =
      direction === "BUY"
        ? fast > slow
        : fast < slow;

    if (!trendAligned) {
      continue;
    }

    const impulse = findImpulse(
      pullbackIndex,
      direction,
      m15,
      atr15
    );

    if (!impulse) {
      continue;
    }

    const touchesEma =
      direction === "BUY"
        ? pullback.low <=
          fast + volatility15 * 0.2
        : pullback.high >=
          fast - volatility15 * 0.2;

    const touchesBreakout =
      direction === "BUY"
        ? pullback.low <=
            impulse.breakoutLevel +
              volatility15 * 0.2 &&
          pullback.high >=
            impulse.breakoutLevel -
              volatility15 * 0.2
        : pullback.high >=
            impulse.breakoutLevel -
              volatility15 * 0.2 &&
          pullback.low <=
            impulse.breakoutLevel +
              volatility15 * 0.2;

    const holdsTrend =
      direction === "BUY"
        ? pullback.low >=
            slow -
              volatility15 * 0.25 &&
          pullback.close > fast
        : pullback.high <=
            slow +
              volatility15 * 0.25 &&
          pullback.close < fast;

    const notExtended =
      Math.abs(
        pullback.close - fast
      ) <=
      volatility15 * 1.2;

    if (
      (!touchesEma &&
        !touchesBreakout) ||
      !holdsTrend ||
      !notExtended
    ) {
      continue;
    }

    const m5Start =
      firstIndexAtOrAfter(
        m5,
        pullbackClose
      );

    const m5End = Math.min(
      m5.length,
      m5Start + 9
    );

    for (
      let m5Index = m5Start;
      m5Index < m5End;
      m5Index++
    ) {
      const current = m5[m5Index];
      const volatility5 =
        atr5[m5Index];

      if (volatility5 === null) {
        continue;
      }

      const entryTime =
        current.time + M5_MS;

      const entryMinutes =
        minuteOfDay(entryTime);

      if (
        entryMinutes >
        SESSION_END_MINUTE
      ) {
        break;
      }

      if (
        h1BiasAt(
          entryTime,
          h1,
          ema20H1,
          ema50H1
        ) !== bias
      ) {
        break;
      }

      const body = Math.abs(
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
        body <
          volatility5 * 0.35
      ) {
        continue;
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
            volatility15 * 0.2
          : pullback.high +
            volatility15 * 0.2 +
            SPREAD;

      const risk = Math.abs(
        entry - stopLoss
      );

      if (
        risk <= SPREAD * 1.5 ||
        risk >
          volatility15 * 2.8
      ) {
        continue;
      }

      const takeProfit =
        direction === "BUY"
          ? entry +
            risk * TARGET_R
          : entry -
            risk * TARGET_R;

      signals.push({
        direction,
        entryTime,
        entry,
        stopLoss,
        takeProfit,
        impulseTime:
          impulse.candle.time,
        pullbackTime:
          pullback.time,
      });

      lastSignalTime = entryTime;
      pullbackIndex += 2;
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
      a.entryTime -
      b.entryTime
  );

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

  const dailyTrades =
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
      skippedOverlap++;
      continue;
    }

    const dayKey = new Date(
      signal.entryTime
    )
      .toISOString()
      .slice(0, 10);

    const dailyCount =
      dailyTrades.get(dayKey) || 0;

    if (
      dailyCount >=
      MAX_TRADES_PER_DAY
    ) {
      skippedDailyLimit++;
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
      MAX_HOLDING_BARS *
        M5_MS;

    const dailyExitTime =
      dayStart(
        signal.entryTime
      ) +
      FORCED_EXIT_MINUTE *
        MINUTE_MS;

    const allowedExitTime =
      Math.min(
        maximumExitTime,
        dailyExitTime
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
      m5[finalIndex].time +
      M5_MS;

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
          : candle.high +
              SPREAD >=
            signal.stopLoss;

      const targetHit =
        signal.direction === "BUY"
          ? candle.high >=
            signal.takeProfit
          : candle.low +
              SPREAD <=
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
    peak = Math.max(
      peak,
      equity
    );

    maximumDrawdown =
      Math.max(
        maximumDrawdown,
        ((peak - equity) /
          peak) *
          100
      );

    totalR += resultR;

    if (resultR > 0.01) {
      wins++;
      grossProfit += pnl;
    } else if (
      resultR < -0.01
    ) {
      losses++;
      grossLoss +=
        Math.abs(pnl);
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

  const totalTrades =
    trades.length;

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
    endingEquity:
      Number(
        equity.toFixed(2)
      ),
    skippedOverlap,
    skippedDailyLimit,
    passesBasicCriteria:
      totalTrades >= 100 &&
      profitFactor !== null &&
      profitFactor >= 1.25 &&
      expectancyR >= 0.1 &&
      maximumDrawdown < 5,
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
    all: simulate(
      signals,
      m5
    ),
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

    const ema20M15 =
      emaSeries(
        m15.map(
          (candle) =>
            candle.close
        ),
        20
      );

    const ema50M15 =
      emaSeries(
        m15.map(
          (candle) =>
            candle.close
        ),
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

    const signals = createSignals(
      h1,
      m15,
      m5,
      ema20H1,
      ema50H1,
      ema20M15,
      ema50M15,
      atr15,
      atr5,
      adx15,
      chop15
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

    const outOfSample =
      results.outOfSample30;

    const validation =
      results.all.passesBasicCriteria &&
      outOfSample.totalTrades >= 25 &&
      outOfSample.profitFactor !== null &&
      outOfSample.profitFactor >= 1.15 &&
      outOfSample.expectancyR > 0.05 &&
      outOfSample.netR > 0;

    const periodMonths =
      (m5[m5.length - 1].time -
        m5[0].time) /
      (30.4375 *
        24 *
        H1_MS);

    return NextResponse.json(
      {
        strategy:
          "TREND_PULLBACK_V1_FROZEN",
        symbol: "XAUUSD",
        source: "FTMO-MT5",
        status: validation
          ? "CANDIDATE_FOR_DEMO"
          : "REJECTED_OR_NEEDS_REVIEW",
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
        frozenRules: {
          h1Bias:
            "EMA20/50 avec pente EMA20",
          m15Impulse:
            "Cassure 6 bougies et corps >= 0.55 ATR",
          m15Pullback:
            "Retour EMA20 ou niveau casse, maintien EMA50",
          filters:
            "ADX >= 17, Choppiness <= 62",
          m5Confirmation:
            "Cassure du pullback, corps >= 0.35 ATR",
          sessionUtc:
            "07:00-20:00",
          targetR:
            TARGET_R,
          riskPercent:
            RISK_PERCENT,
          maximumTradesPerDay:
            MAX_TRADES_PER_DAY,
          spread:
            SPREAD,
          slippage:
            SLIPPAGE,
          overnightTrades:
            false,
          ambiguousBar:
            "STOP_FIRST",
        },
        detectedSignals:
          signals.length,
        frequency: {
          signalsPerMonth:
            Number(
              (
                signals.length /
                periodMonths
              ).toFixed(2)
            ),
        },
        results,
        validationChecks: {
          allSample:
            results.all
              .passesBasicCriteria,
          outOfSampleTradesMinimum:
            outOfSample.totalTrades >=
            25,
          outOfSampleProfitFactor:
            outOfSample.profitFactor !==
              null &&
            outOfSample.profitFactor >=
              1.15,
          outOfSampleExpectancy:
            outOfSample.expectancyR >
            0.05,
          outOfSamplePositive:
            outOfSample.netR > 0,
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
      "Erreur trend pullback:",
      error
    );

    return NextResponse.json(
      {
        error:
          "Backtest Trend Pullback impossible.",
      },
      { status: 500 }
    );
  }
}
