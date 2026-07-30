import { NextResponse } from "next/server";
import { pool } from "@/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Direction = "BUY" | "SELL";
type ModuleName = "H1_OB" | "M15_OB_H1_BIAS";
type Bias = "BULLISH" | "BEARISH" | "NEUTRAL";

type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

type Zone = {
  module: ModuleName;
  direction: Direction;
  low: number;
  high: number;
  createdTime: number;
  sourceTime: number;
  sourceAtr: number;
};

type SetupSignal = {
  module: ModuleName;
  direction: Direction;
  entryTime: number;
  entry: number;
  stopLoss: number;
  zoneLow: number;
  zoneHigh: number;
  sweepTime: number;
  chochTime: number;
};

type PivotState = {
  high: Array<number | null>;
  low: Array<number | null>;
};

const M5_MS = 5 * 60 * 1000;
const M15_MS = 15 * 60 * 1000;
const H1_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

const SPREAD = 0.45;
const SLIPPAGE = 0.05;
const RISK_PERCENT = 0.1;

const TARGETS = [1, 1.5, 2];
const MAX_TRADES_PER_DAY = 2;
const MAX_HOLDING_BARS = 72;

const SESSION_START_MINUTE = 6 * 60;
const SESSION_END_MINUTE = 20 * 60;
const FORCED_EXIT_MINUTE = 21 * 60;

function toCandles(
  rows: Record<string, unknown>[]
): Candle[] {
  return rows.map((row) => ({
    time: new Date(
      String(row.open_time)
    ).getTime(),
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
      .reduce(
        (sum, item) => sum + item,
        0
      ) / period;

  output[period - 1] = value;

  const multiplier =
    2 / (period + 1);

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
    new Array<number>(
      candles.length
    ).fill(0);

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
      Math.abs(
        candle.high - previousClose
      ),
      Math.abs(
        candle.low - previousClose
      )
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

function confirmedPivots(
  candles: Candle[],
  left = 2,
  right = 2
): PivotState {
  const high:
    Array<number | null> =
      new Array(candles.length).fill(
        null
      );

  const low:
    Array<number | null> =
      new Array(candles.length).fill(
        null
      );

  let latestHigh: number | null =
    null;

  let latestLow: number | null =
    null;

  for (
    let confirmedAt = 0;
    confirmedAt < candles.length;
    confirmedAt++
  ) {
    const pivotIndex =
      confirmedAt - right;

    if (pivotIndex >= left) {
      let isHigh = true;
      let isLow = true;

      for (
        let index =
          pivotIndex - left;
        index <=
        pivotIndex + right;
        index++
      ) {
        if (index === pivotIndex) {
          continue;
        }

        if (
          candles[index].high >=
          candles[pivotIndex].high
        ) {
          isHigh = false;
        }

        if (
          candles[index].low <=
          candles[pivotIndex].low
        ) {
          isLow = false;
        }
      }

      if (isHigh) {
        latestHigh =
          candles[pivotIndex].high;
      }

      if (isLow) {
        latestLow =
          candles[pivotIndex].low;
      }
    }

    high[confirmedAt] =
      latestHigh;

    low[confirmedAt] =
      latestLow;
  }

  return {
    high,
    low,
  };
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
      candles[middle].time +
      duration;

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

    if (
      candles[middle].time <
      timestamp
    ) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return low;
}

function minuteOfDay(
  timestamp: number
) {
  const date =
    new Date(timestamp);

  return (
    date.getUTCHours() * 60 +
    date.getUTCMinutes()
  );
}

function dayStart(
  timestamp: number
) {
  const date =
    new Date(timestamp);

  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate()
  );
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
  const fast =
    ema20[index] as number;

  const slow =
    ema50[index] as number;

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

function findOppositeCandle(
  candles: Candle[],
  impulseIndex: number,
  direction: Direction
) {
  const firstIndex = Math.max(
    0,
    impulseIndex - 6
  );

  for (
    let index =
      impulseIndex - 1;
    index >= firstIndex;
    index--
  ) {
    const candle =
      candles[index];

    const opposite =
      direction === "BUY"
        ? candle.close <
          candle.open
        : candle.close >
          candle.open;

    if (opposite) {
      return candle;
    }
  }

  return null;
}

function buildOrderBlocks(
  candles: Candle[],
  duration: number,
  module: ModuleName,
  atrValues:
    Array<number | null>,
  pivots: PivotState,
  h1: Candle[],
  ema20H1:
    Array<number | null>,
  ema50H1:
    Array<number | null>
): Zone[] {
  const zones: Zone[] = [];
  const usedKeys =
    new Set<string>();

  for (
    let index = 20;
    index < candles.length;
    index++
  ) {
    const candle =
      candles[index];

    const volatility =
      atrValues[index];

    if (volatility === null) {
      continue;
    }

    const body = Math.abs(
      candle.close - candle.open
    );

    if (
      body <
      volatility * 0.9
    ) {
      continue;
    }

    const previousHigh =
      pivots.high[index - 1];

    const previousLow =
      pivots.low[index - 1];

    const bullishBos =
      previousHigh !== null &&
      candle.close >
        previousHigh &&
      candle.close >
        candle.open;

    const bearishBos =
      previousLow !== null &&
      candle.close <
        previousLow &&
      candle.close <
        candle.open;

    if (
      !bullishBos &&
      !bearishBos
    ) {
      continue;
    }

    const direction: Direction =
      bullishBos
        ? "BUY"
        : "SELL";

    const createdTime =
      candle.time + duration;

    if (
      module ===
      "M15_OB_H1_BIAS"
    ) {
      const bias = h1BiasAt(
        createdTime,
        h1,
        ema20H1,
        ema50H1
      );

      if (
        (direction === "BUY" &&
          bias !== "BULLISH") ||
        (direction === "SELL" &&
          bias !== "BEARISH")
      ) {
        continue;
      }
    }

    const orderBlock =
      findOppositeCandle(
        candles,
        index,
        direction
      );

    if (!orderBlock) {
      continue;
    }

    const zoneLow =
      orderBlock.low;

    const zoneHigh =
      orderBlock.high;

    const zoneSize =
      zoneHigh - zoneLow;

    if (
      zoneSize <= 0 ||
      zoneSize >
        volatility * 1.6
    ) {
      continue;
    }

    const key = [
      module,
      direction,
      orderBlock.time,
    ].join(":");

    if (usedKeys.has(key)) {
      continue;
    }

    usedKeys.add(key);

    zones.push({
      module,
      direction,
      low: zoneLow,
      high: zoneHigh,
      createdTime,
      sourceTime:
        orderBlock.time,
      sourceAtr:
        volatility,
    });
  }

  return zones;
}

function createSignalsFromZones(
  zones: Zone[],
  h1: Candle[],
  m15: Candle[],
  m5: Candle[],
  ema20H1:
    Array<number | null>,
  ema50H1:
    Array<number | null>,
  atr15:
    Array<number | null>,
  atr5:
    Array<number | null>,
  m5Pivots: PivotState
): SetupSignal[] {
  const signals:
    SetupSignal[] = [];

  const signalKeys =
    new Set<string>();

  const orderedZones =
    [...zones].sort(
      (a, b) =>
        a.createdTime -
        b.createdTime
    );

  for (
    const zone
    of orderedZones
  ) {
    const expiryDays =
      zone.module === "H1_OB"
        ? 10
        : 3;

    const start =
      firstIndexAtOrAfter(
        m5,
        zone.createdTime
      );

    const end = Math.min(
      m5.length,
      firstIndexAtOrAfter(
        m5,
        zone.createdTime +
          expiryDays *
            24 *
            H1_MS
      )
    );

    let touchIndex = -1;
    let sweepIndex = -1;
    let chochLevel:
      number | null = null;

    for (
      let index = start;
      index < end;
      index++
    ) {
      const candle =
        m5[index];

      const invalidated =
        zone.direction === "BUY"
          ? candle.close <
            zone.low
          : candle.close >
            zone.high;

      if (invalidated) {
        break;
      }

      if (touchIndex < 0) {
        const overlapsZone =
          candle.low <=
            zone.high &&
          candle.high >=
            zone.low;

        if (overlapsZone) {
          touchIndex = index;
        }

        continue;
      }

      if (sweepIndex < 0) {
        if (
          index -
            touchIndex >
          12
        ) {
          break;
        }

        if (index < 10) {
          continue;
        }

        const previous =
          m5.slice(
            index - 10,
            index
          );

        const previousLow =
          Math.min(
            ...previous.map(
              (item) =>
                item.low
            )
          );

        const previousHigh =
          Math.max(
            ...previous.map(
              (item) =>
                item.high
            )
          );

        const buySweep =
          zone.direction ===
            "BUY" &&
          candle.low <
            previousLow &&
          candle.close >
            previousLow &&
          candle.low <=
            zone.high;

        const sellSweep =
          zone.direction ===
            "SELL" &&
          candle.high >
            previousHigh &&
          candle.close <
            previousHigh &&
          candle.high >=
            zone.low;

        if (
          !buySweep &&
          !sellSweep
        ) {
          continue;
        }

        const level =
          zone.direction ===
          "BUY"
            ? m5Pivots.high[
                index
              ]
            : m5Pivots.low[
                index
              ];

        if (level === null) {
          continue;
        }

        sweepIndex = index;
        chochLevel = level;
        continue;
      }

      if (
        index -
          sweepIndex >
        12
      ) {
        break;
      }

      const minutes =
        minuteOfDay(
          candle.time + M5_MS
        );

      if (
        minutes <
          SESSION_START_MINUTE ||
        minutes >
          SESSION_END_MINUTE
      ) {
        continue;
      }

      const volatility5 =
        atr5[index];

      if (
        volatility5 === null ||
        chochLevel === null
      ) {
        continue;
      }

      const body = Math.abs(
        candle.close -
          candle.open
      );

      const buyChoch =
        zone.direction === "BUY" &&
        candle.close >
          chochLevel &&
        candle.close >
          candle.open &&
        body >=
          volatility5 * 0.5;

      const sellChoch =
        zone.direction === "SELL" &&
        candle.close <
          chochLevel &&
        candle.close <
          candle.open &&
        body >=
          volatility5 * 0.5;

      if (
        !buyChoch &&
        !sellChoch
      ) {
        continue;
      }

      const entryTime =
        candle.time + M5_MS;

      if (
        zone.module ===
        "M15_OB_H1_BIAS"
      ) {
        const bias = h1BiasAt(
          entryTime,
          h1,
          ema20H1,
          ema50H1
        );

        if (
          (zone.direction ===
            "BUY" &&
            bias !==
              "BULLISH") ||
          (zone.direction ===
            "SELL" &&
            bias !==
              "BEARISH")
        ) {
          break;
        }
      }

      const m15Index =
        lastClosedIndex(
          m15,
          M15_MS,
          entryTime
        );

      if (
        m15Index < 0 ||
        atr15[m15Index] ===
          null
      ) {
        continue;
      }

      const volatility15 =
        atr15[m15Index] as number;

      const sweepCandle =
        m5[sweepIndex];

      const entry =
        zone.direction === "BUY"
          ? candle.close +
            SPREAD +
            SLIPPAGE
          : candle.close -
            SLIPPAGE;

      const stopBase =
        zone.direction === "BUY"
          ? Math.min(
              zone.low,
              sweepCandle.low
            )
          : Math.max(
              zone.high,
              sweepCandle.high
            );

      const stopLoss =
        zone.direction === "BUY"
          ? stopBase -
            volatility15 * 0.1
          : stopBase +
            volatility15 * 0.1 +
            SPREAD;

      const risk = Math.abs(
        entry - stopLoss
      );

      if (
        risk <=
          SPREAD * 1.5 ||
        risk >
          volatility15 * 2.8
      ) {
        break;
      }

      const signalKey = [
        zone.module,
        zone.direction,
        entryTime,
      ].join(":");

      if (
        signalKeys.has(
          signalKey
        )
      ) {
        break;
      }

      signalKeys.add(
        signalKey
      );

      signals.push({
        module:
          zone.module,
        direction:
          zone.direction,
        entryTime,
        entry,
        stopLoss,
        zoneLow:
          zone.low,
        zoneHigh:
          zone.high,
        sweepTime:
          sweepCandle.time,
        chochTime:
          candle.time,
      });

      break;
    }
  }

  return signals;
}

function simulate(
  signals: SetupSignal[],
  m5: Candle[],
  targetR: number
) {
  const ordered =
    [...signals].sort(
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
  let totalR = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let maximumConsecutiveLosses = 0;
  let currentConsecutiveLosses = 0;

  const dailyTrades =
    new Map<string, number>();

  const monthlyR =
    new Map<string, number>();

  const trades:
    Record<string, unknown>[] = [];

  for (
    const signal
    of ordered
  ) {
    if (
      signal.entryTime <=
      lastExitTime
    ) {
      continue;
    }

    const dayKey =
      new Date(
        signal.entryTime
      )
        .toISOString()
        .slice(0, 10);

    const dailyCount =
      dailyTrades.get(
        dayKey
      ) || 0;

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

    const takeProfit =
      signal.direction ===
      "BUY"
        ? signal.entry +
          riskDistance *
            targetR
        : signal.entry -
          riskDistance *
            targetR;

    const maximumExitTime =
      signal.entryTime +
      MAX_HOLDING_BARS *
        M5_MS;

    const forcedExitTime =
      dayStart(
        signal.entryTime
      ) +
      FORCED_EXIT_MINUTE *
        MINUTE_MS;

    const allowedExitTime =
      Math.min(
        maximumExitTime,
        forcedExitTime
      );

    const finalIndex =
      Math.min(
        m5.length - 1,
        start +
          MAX_HOLDING_BARS -
          1,
        firstIndexAtOrAfter(
          m5,
          allowedExitTime
        ) - 1
      );

    if (
      finalIndex < start
    ) {
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
      const candle =
        m5[index];

      const stopHit =
        signal.direction ===
        "BUY"
          ? candle.low <=
            signal.stopLoss
          : candle.high +
              SPREAD >=
            signal.stopLoss;

      const targetHit =
        signal.direction ===
        "BUY"
          ? candle.high >=
            takeProfit
          : candle.low +
              SPREAD <=
            takeProfit;

      if (stopHit) {
        resultR = -1;
        outcome = "SL";
        exitTime =
          candle.time +
          M5_MS;
        break;
      }

      if (targetHit) {
        resultR = targetR;
        outcome = "TP";
        exitTime =
          candle.time +
          M5_MS;
        break;
      }

      if (
        index ===
        finalIndex
      ) {
        const effectiveClose =
          signal.direction ===
          "BUY"
            ? candle.close
            : candle.close +
              SPREAD;

        resultR =
          signal.direction ===
          "BUY"
            ? (effectiveClose -
                signal.entry) /
              riskDistance
            : (signal.entry -
                effectiveClose) /
              riskDistance;

        resultR = Math.max(
          -1,
          Math.min(
            targetR,
            resultR
          )
        );
      }
    }

    const riskCash =
      equity *
      (RISK_PERCENT /
        100);

    const pnl =
      riskCash *
      resultR;

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

    const monthKey =
      dayKey.slice(0, 7);

    monthlyR.set(
      monthKey,
      (monthlyR.get(
        monthKey
      ) || 0) +
        resultR
    );

    if (
      resultR > 0.01
    ) {
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

    lastExitTime =
      exitTime;

    trades.push({
      module:
        signal.module,
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
      targetR,
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

  const months =
    [...monthlyR.values()];

  const positiveMonths =
    months.filter(
      (value) =>
        value > 0
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
            profitFactor.toFixed(
              2
            )
          ),
    expectancyR:
      Number(
        expectancyR.toFixed(
          3
        )
      ),
    netR:
      Number(
        totalR.toFixed(2)
      ),
    returnPercent:
      Number(
        (
          ((equity -
            100000) /
            100000) *
          100
        ).toFixed(2)
      ),
    maximumDrawdownPercent:
      Number(
        maximumDrawdown.toFixed(
          2
        )
      ),
    maximumConsecutiveLosses,
    positiveMonths,
    totalMonths:
      months.length,
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
      trades.slice(-10),
  };
}

function evaluateTargets(
  signals: SetupSignal[],
  m5: Candle[],
  splitTime: number
) {
  const result:
    Record<string, unknown> = {};

  for (
    const target
    of TARGETS
  ) {
    const key =
      `target_${String(
        target
      ).replace(".", "_")}R`;

    result[key] = {
      all: simulate(
        signals,
        m5,
        target
      ),
      training70: simulate(
        signals.filter(
          (signal) =>
            signal.entryTime <
            splitTime
        ),
        m5,
        target
      ),
      outOfSample30:
        simulate(
          signals.filter(
            (signal) =>
              signal.entryTime >=
              splitTime
          ),
          m5,
          target
        ),
    };
  }

  return result;
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

    const atrH1 =
      atrSeries(h1);

    const atrM15 =
      atrSeries(m15);

    const atrM5 =
      atrSeries(m5);

    const pivotsH1 =
      confirmedPivots(h1);

    const pivotsM15 =
      confirmedPivots(m15);

    const pivotsM5 =
      confirmedPivots(m5);

    const h1Zones =
      buildOrderBlocks(
        h1,
        H1_MS,
        "H1_OB",
        atrH1,
        pivotsH1,
        h1,
        ema20H1,
        ema50H1
      );

    const m15Zones =
      buildOrderBlocks(
        m15,
        M15_MS,
        "M15_OB_H1_BIAS",
        atrM15,
        pivotsM15,
        h1,
        ema20H1,
        ema50H1
      );

    const h1Signals =
      createSignalsFromZones(
        h1Zones,
        h1,
        m15,
        m5,
        ema20H1,
        ema50H1,
        atrM15,
        atrM5,
        pivotsM5
      );

    const m15Signals =
      createSignalsFromZones(
        m15Zones,
        h1,
        m15,
        m5,
        ema20H1,
        ema50H1,
        atrM15,
        atrM5,
        pivotsM5
      );

    const splitIndex =
      Math.floor(
        m5.length * 0.7
      );

    const splitTime =
      m5[splitIndex].time;

    const combinedSignals = [
      ...h1Signals,
      ...m15Signals,
    ];

    const periodMonths =
      (m5[m5.length - 1].time -
        m5[0].time) /
      (30.4375 *
        24 *
        H1_MS);

    return NextResponse.json(
      {
        strategy:
          "ORDER_BLOCK_SWEEP_CHOCH_V1",
        symbol: "XAUUSD",
        source: "FTMO-MT5",
        frozenRules: {
          orderBlock:
            "Derniere bougie opposee avant impulsion et BOS",
          impulse:
            "Corps >= 0.9 ATR et cloture au-dela d'un swing confirme",
          return:
            "Premier retour dans la zone uniquement",
          sweep:
            "Depassement d'un extreme M5 sur 10 bougies puis cloture a l'interieur",
          choch:
            "Cloture au-dela d'un swing M5 confirme avec corps >= 0.5 ATR",
          stop:
            "Derriere le sweep et l'Order Block avec marge ATR",
          targetsTested:
            TARGETS,
          riskPercent:
            RISK_PERCENT,
          maximumTradesPerDay:
            MAX_TRADES_PER_DAY,
          spread:
            SPREAD,
          slippage:
            SLIPPAGE,
          ambiguousBar:
            "STOP_FIRST",
          overnightTrades:
            false,
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
        zonesDetected: {
          h1:
            h1Zones.length,
          m15:
            m15Zones.length,
        },
        signalsDetected: {
          h1:
            h1Signals.length,
          m15:
            m15Signals.length,
          combined:
            combinedSignals.length,
          combinedPerMonth:
            Number(
              (
                combinedSignals.length /
                periodMonths
              ).toFixed(2)
            ),
        },
        results: {
          h1Ob:
            evaluateTargets(
              h1Signals,
              m5,
              splitTime
            ),
          m15ObWithH1Bias:
            evaluateTargets(
              m15Signals,
              m5,
              splitTime
            ),
          combined:
            evaluateTargets(
              combinedSignals,
              m5,
              splitTime
            ),
        },
        acceptanceCriteria: {
          minimumTrades:
            100,
          minimumProfitFactor:
            1.25,
          minimumExpectancyR:
            0.1,
          maximumDrawdownPercent:
            5,
          outOfSampleMustBePositive:
            true,
        },
        warning:
          "Backtest experimental. Aucun resultat ne garantit les performances futures.",
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
      "Erreur OB Sweep CHOCH:",
      error
    );

    return NextResponse.json(
      {
        error:
          "Backtest OB Sweep CHOCH impossible.",
      },
      { status: 500 }
    );
  }
}
