import { pool } from "@/db";

export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type NumberSeries = Array<number | null>;

export type ResearchMarketData = {
  h1: Candle[];
  m15: Candle[];
  m5: Candle[];
};

export const M5_MS = 5 * 60 * 1000;
export const M15_MS = 15 * 60 * 1000;
export const H1_MS = 60 * 60 * 1000;

function toCandles(
  rows: Array<Record<string, unknown>>
): Candle[] {
  return rows
    .map((row) => ({
      time: new Date(String(row.open_time)).getTime(),
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
    }))
    .filter(
      (candle) =>
        Number.isFinite(candle.time) &&
        Number.isFinite(candle.open) &&
        Number.isFinite(candle.high) &&
        Number.isFinite(candle.low) &&
        Number.isFinite(candle.close) &&
        candle.open > 0 &&
        candle.high >= Math.max(candle.open, candle.close) &&
        candle.low <= Math.min(candle.open, candle.close)
    );
}

export async function loadXauusdResearchData(): Promise<ResearchMarketData> {
  const [h1Result, m15Result, m5Result] = await Promise.all([
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

  return {
    h1: toCandles(h1Result.rows).slice(0, -1),
    m15: toCandles(m15Result.rows).slice(0, -1),
    m5: toCandles(m5Result.rows).slice(0, -1),
  };
}

export function emaSeries(
  values: number[],
  period: number
): NumberSeries {
  const output: NumberSeries = new Array(values.length).fill(null);

  if (period < 2 || values.length < period) {
    return output;
  }

  let value =
    values
      .slice(0, period)
      .reduce((sum, item) => sum + item, 0) / period;

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

export function trueRangeSeries(candles: Candle[]): number[] {
  const output = new Array<number>(candles.length).fill(0);

  for (let index = 0; index < candles.length; index++) {
    const candle = candles[index];

    if (index === 0) {
      output[index] = candle.high - candle.low;
      continue;
    }

    const previousClose = candles[index - 1].close;

    output[index] = Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previousClose),
      Math.abs(candle.low - previousClose)
    );
  }

  return output;
}

export function atrSeries(
  candles: Candle[],
  period = 14
): NumberSeries {
  const output: NumberSeries =
    new Array(candles.length).fill(null);

  if (candles.length <= period) {
    return output;
  }

  const ranges = trueRangeSeries(candles);

  let value =
    ranges
      .slice(1, period + 1)
      .reduce((sum, item) => sum + item, 0) / period;

  output[period] = value;

  for (
    let index = period + 1;
    index < candles.length;
    index++
  ) {
    value =
      (value * (period - 1) + ranges[index]) /
      period;

    output[index] = value;
  }

  return output;
}

export function adxSeries(
  candles: Candle[],
  period = 14
): NumberSeries {
  const output: NumberSeries =
    new Array(candles.length).fill(null);

  const trueRanges =
    new Array<number>(candles.length).fill(0);

  const plusDm =
    new Array<number>(candles.length).fill(0);

  const minusDm =
    new Array<number>(candles.length).fill(0);

  const dx: NumberSeries =
    new Array(candles.length).fill(null);

  let smoothTr = 0;
  let smoothPlus = 0;
  let smoothMinus = 0;

  for (let index = 1; index < candles.length; index++) {
    const current = candles[index];
    const previous = candles[index - 1];

    const upMove = current.high - previous.high;
    const downMove = previous.low - current.low;

    plusDm[index] =
      upMove > downMove && upMove > 0 ? upMove : 0;

    minusDm[index] =
      downMove > upMove && downMove > 0 ? downMove : 0;

    trueRanges[index] = Math.max(
      current.high - current.low,
      Math.abs(current.high - previous.close),
      Math.abs(current.low - previous.close)
    );

    if (index === period) {
      smoothTr = trueRanges
        .slice(1, period + 1)
        .reduce((sum, item) => sum + item, 0);

      smoothPlus = plusDm
        .slice(1, period + 1)
        .reduce((sum, item) => sum + item, 0);

      smoothMinus = minusDm
        .slice(1, period + 1)
        .reduce((sum, item) => sum + item, 0);
    } else if (index > period) {
      smoothTr =
        smoothTr -
        smoothTr / period +
        trueRanges[index];

      smoothPlus =
        smoothPlus -
        smoothPlus / period +
        plusDm[index];

      smoothMinus =
        smoothMinus -
        smoothMinus / period +
        minusDm[index];
    }

    if (index >= period && smoothTr > 0) {
      const plusDi = (100 * smoothPlus) / smoothTr;
      const minusDi = (100 * smoothMinus) / smoothTr;
      const total = plusDi + minusDi;

      dx[index] =
        total > 0
          ? (100 * Math.abs(plusDi - minusDi)) / total
          : 0;
    }
  }

  const firstAdxIndex = period * 2 - 1;

  if (firstAdxIndex >= candles.length) {
    return output;
  }

  const initialValues = dx
    .slice(period, firstAdxIndex + 1)
    .filter((value): value is number => value !== null);

  if (initialValues.length === 0) {
    return output;
  }

  let currentAdx =
    initialValues.reduce((sum, value) => sum + value, 0) /
    initialValues.length;

  output[firstAdxIndex] = currentAdx;

  for (
    let index = firstAdxIndex + 1;
    index < candles.length;
    index++
  ) {
    if (dx[index] === null) {
      continue;
    }

    currentAdx =
      (currentAdx * (period - 1) +
        (dx[index] as number)) /
      period;

    output[index] = currentAdx;
  }

  return output;
}

export function choppinessSeries(
  candles: Candle[],
  period = 14
): NumberSeries {
  const output: NumberSeries =
    new Array(candles.length).fill(null);

  const ranges = trueRangeSeries(candles);

  for (
    let index = period - 1;
    index < candles.length;
    index++
  ) {
    const start = index - period + 1;
    const window = candles.slice(start, index + 1);

    const trueRangeSum = ranges
      .slice(start, index + 1)
      .reduce((sum, value) => sum + value, 0);

    const highest = Math.max(
      ...window.map((candle) => candle.high)
    );

    const lowest = Math.min(
      ...window.map((candle) => candle.low)
    );

    const priceRange = highest - lowest;

    if (priceRange > 0 && trueRangeSum > 0) {
      output[index] =
        (100 * Math.log10(trueRangeSum / priceRange)) /
        Math.log10(period);
    }
  }

  return output;
}

export function lastClosedIndex(
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

export function firstIndexAtOrAfter(
  candles: Candle[],
  timestamp: number
) {
  let low = 0;
  let high = candles.length;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);

    if (candles[middle].time < timestamp) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return low;
}

export function minuteOfDay(timestamp: number) {
  const date = new Date(timestamp);

  return (
    date.getUTCHours() * 60 +
    date.getUTCMinutes()
  );
}

export function dayStart(timestamp: number) {
  const date = new Date(timestamp);

  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate()
  );
}
