import { NextResponse } from "next/server";
import { pool } from "@/db";

export const dynamic = "force-dynamic";

type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type Sweep = {
  direction: "BUY" | "SELL";
  candle: Candle;
  liquidityLevel: number;
};

function parseCandles(rows: Record<string, unknown>[]): Candle[] {
  return rows
    .map((row) => ({
      time: new Date(String(row.open_time)).getTime(),
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
      volume: Number(row.tick_volume),
    }))
    .reverse();
}

function ema(values: number[], period: number): number | null {
  if (values.length < period) return null;

  let value =
    values.slice(0, period).reduce((sum, item) => sum + item, 0) /
    period;

  const multiplier = 2 / (period + 1);

  for (let index = period; index < values.length; index++) {
    value = values[index] * multiplier + value * (1 - multiplier);
  }

  return value;
}

function atr(candles: Candle[], period: number): number | null {
  if (candles.length <= period) return null;

  const ranges: number[] = [];

  for (let index = 1; index < candles.length; index++) {
    const candle = candles[index];
    const previousClose = candles[index - 1].close;

    ranges.push(
      Math.max(
        candle.high - candle.low,
        Math.abs(candle.high - previousClose),
        Math.abs(candle.low - previousClose)
      )
    );
  }

  const recent = ranges.slice(-period);

  return recent.reduce((sum, value) => sum + value, 0) / recent.length;
}

function roundPrice(value: number) {
  return Math.round(value * 100) / 100;
}

function wait(reason: string, details: Record<string, unknown> = {}) {
  return NextResponse.json({
    status: "WAIT",
    reason,
    details,
    generatedAt: new Date().toISOString(),
    warning: "Aucun signal ne garantit un gain.",
  });
}

export async function GET() {
  try {
    const [h1Result, m15Result, m5Result, priceResult] =
      await Promise.all([
        pool.query(
          `SELECT open_time, open, high, low, close, tick_volume
           FROM market_candles
           WHERE symbol = 'XAUUSD' AND timeframe = 'H1'
           ORDER BY open_time DESC
           LIMIT 260`
        ),
        pool.query(
          `SELECT open_time, open, high, low, close, tick_volume
           FROM market_candles
           WHERE symbol = 'XAUUSD' AND timeframe = 'M15'
           ORDER BY open_time DESC
           LIMIT 120`
        ),
        pool.query(
          `SELECT open_time, open, high, low, close, tick_volume
           FROM market_candles
           WHERE symbol = 'XAUUSD' AND timeframe = 'M5'
           ORDER BY open_time DESC
           LIMIT 180`
        ),
        pool.query(
          `SELECT bid, ask, source, received_at
           FROM market_prices
           WHERE symbol = 'XAUUSD'
           LIMIT 1`
        ),
      ]);

    const h1 = parseCandles(h1Result.rows);
    const m15 = parseCandles(m15Result.rows);
    const m5 = parseCandles(m5Result.rows);
    const priceRow = priceResult.rows[0];

    if (
      h1.length < 205 ||
      m15.length < 50 ||
      m5.length < 50 ||
      !priceRow
    ) {
      return wait("Historique MT5 insuffisant.", {
        h1: h1.length,
        m15: m15.length,
        m5: m5.length,
      });
    }

    const bid = Number(priceRow.bid);
    const ask = Number(priceRow.ask);
    const priceReceivedAt = new Date(priceRow.received_at);
    const priceAgeSeconds =
      (Date.now() - priceReceivedAt.getTime()) / 1000;

    if (
      !Number.isFinite(bid) ||
      !Number.isFinite(ask) ||
      bid <= 0 ||
      ask <= 0 ||
      priceAgeSeconds > 120
    ) {
      return wait("Le prix FTMO-MT5 est absent ou en retard.", {
        priceAgeSeconds: Math.round(priceAgeSeconds),
      });
    }

    // La dernière bougie de chaque série est encore en formation.
    const h1Closed = h1.slice(0, -1);
    const m15Closed = m15.slice(0, -1);
    const m5Closed = m5.slice(0, -1);

    const h1Closes = h1Closed.map((candle) => candle.close);
    const ema50 = ema(h1Closes, 50);
    const ema200 = ema(h1Closes, 200);
    const previousEma50 = ema(h1Closes.slice(0, -1), 50);

    if (ema50 === null || ema200 === null || previousEma50 === null) {
      return wait("Impossible de calculer la tendance H1.");
    }

    const lastH1 = h1Closed[h1Closed.length - 1];

    const bullishTrend =
      lastH1.close > ema50 &&
      ema50 > ema200 &&
      ema50 > previousEma50;

    const bearishTrend =
      lastH1.close < ema50 &&
      ema50 < ema200 &&
      ema50 < previousEma50;

    const trend = bullishTrend
      ? "BULLISH"
      : bearishTrend
        ? "BEARISH"
        : "NEUTRAL";

    if (trend === "NEUTRAL") {
      return wait("La tendance H1 n'est pas suffisamment claire.", {
        closeH1: roundPrice(lastH1.close),
        ema50: roundPrice(ema50),
        ema200: roundPrice(ema200),
      });
    }

    // Fenêtres larges calculées selon l'heure des bougies du serveur FTMO.
    const latestServerTime = new Date(m5[m5.length - 1].time);
    const serverMinutes =
      latestServerTime.getUTCHours() * 60 +
      latestServerTime.getUTCMinutes();

    const londonSession =
      serverMinutes >= 8 * 60 && serverMinutes <= 13 * 60;

    const newYorkSession =
      serverMinutes >= 14 * 60 + 30 &&
      serverMinutes <= 19 * 60 + 30;

    if (!londonSession && !newYorkSession) {
      return wait
