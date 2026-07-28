import { NextResponse } from "next/server";
import { pool } from "@/db";

export const dynamic = "force-dynamic";

type Row = Record<string, unknown>;

type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

function toCandles(rows: Row[]): Candle[] {
  return rows
    .map((row) => ({
      time: new Date(String(row.open_time)).getTime(),
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
    }))
    .reverse();
}

function ema(values: number[], period: number): number {
  let result =
    values.slice(0, period).reduce((sum, value) => sum + value, 0) /
    period;

  const multiplier = 2 / (period + 1);

  for (let index = period; index < values.length; index++) {
    result =
      values[index] * multiplier +
      result * (1 - multiplier);
  }

  return result;
}

function atr(candles: Candle[], period = 14): number {
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

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function wait(reason: string, details: Row = {}) {
  return NextResponse.json({
    status: "WAIT",
    reason,
    details,
    execution: "MANUAL_ONLY",
    generatedAt: new Date().toISOString(),
  });
}

export async function GET() {
  try {
    const [h1Result, m15Result, m5Result, priceResult] =
      await Promise.all([
        pool.query(
          `SELECT open_time, open, high, low, close
           FROM market_candles
           WHERE symbol = 'XAUUSD' AND timeframe = 'H1'
           ORDER BY open_time DESC LIMIT 220`
        ),
        pool.query(
          `SELECT open_time, open, high, low, close
           FROM market_candles
           WHERE symbol = 'XAUUSD' AND timeframe = 'M15'
           ORDER BY open_time DESC LIMIT 80`
        ),
        pool.query(
          `SELECT open_time, open, high, low, close
           FROM market_candles
           WHERE symbol = 'XAUUSD' AND timeframe = 'M5'
           ORDER BY open_time DESC LIMIT 100`
        ),
        pool.query(
          `SELECT bid, ask, received_at
           FROM market_prices
           WHERE symbol = 'XAUUSD'
           LIMIT 1`
        ),
      ]);

    const h1 = toCandles(h1Result.rows).slice(0, -1);
    const m15 = toCandles(m15Result.rows).slice(0, -1);
    const m5 = toCandles(m5Result.rows).slice(0, -1);
    const price = priceResult.rows[0];

    if (h1.length < 200 || m15.length < 30 || m5.length < 30 || !price) {
      return wait("Historique MT5 insuffisant.");
    }

    const bid = Number(price.bid);
    const ask = Number(price.ask);
    const priceAge =
      Date.now() - new Date(price.received_at).getTime();

    if (!bid || !ask || priceAge > 120000) {
      return wait("Flux FTMO-MT5 absent ou en retard.");
    }

    const closes = h1.map((candle) => candle.close);
    const ema50 = ema(closes, 50);
    const ema200 = ema(closes, 200);
    const lastH1 = h1[h1.length - 1];

    const trend =
      lastH1.close > ema50 && ema50 > ema200
        ? "BULLISH"
        : lastH1.close < ema50 && ema50 < ema200
          ? "BEARISH"
          : "NEUTRAL";

    if (trend === "NEUTRAL") {
      return wait("Tendance H1 neutre.", {
        close: round(lastH1.close),
        ema50: round(ema50),
        ema200: round(ema200),
      });
    }

    const latestTime = new Date(m5[m5.length - 1].time);
    const minutes =
      latestTime.getUTCHours() * 60 + latestTime.getUTCMinutes();

    const london = minutes >= 9 * 60 && minutes <= 13 * 60;
    const newYork = minutes >= 14 * 60 + 30 && minutes <= 19 * 60 + 30;

    if (!london && !newYork) {
      return wait("Hors session Londres ou New York.", {
        trend,
        serverTime: latestTime.toISOString(),
      });
    }

    let sweep:
      | {
          direction: "BUY" | "SELL";
          candle: Candle;
          level: number;
        }
      | undefined;

    for (let index = Math.max(20, m15.length - 5); index < m15.length; index++) {
      const candle = m15[index];
      const previous = m15.slice(index - 20, index);
      const previousLow = Math.min(...previous.map((item) => item.low));
      const previousHigh = Math.max(...previous.map((item) => item.high));

      if (
        trend === "BULLISH" &&
        candle.low < previousLow &&
        candle.close > previousLow
      ) {
        sweep = { direction: "BUY", candle, level: previousLow };
      }

      if (
        trend === "BEARISH" &&
        candle.high > previousHigh &&
        candle.close < previousHigh
      ) {
        sweep = { direction: "SELL", candle, level: previousHigh };
      }
    }

    if (!sweep) {
      return wait("Aucun sweep M15 confirmé.", {
        trend,
        session: london ? "LONDON" : "NEW_YORK",
      });
    }

    const volatilityM5 = atr(m5);
    const volatilityM15 = atr(m15);
    const afterSweep = m5.filter(
      (candle) => candle.time >= sweep.candle.time
    );

    let confirmation: Candle | undefined;

    for (let index = 2; index < afterSweep.length; index++) {
      const first = afterSweep[index - 2];
      const current = afterSweep[index];
      const body = Math.abs(current.close - current.open);
      const displacement = body >= volatilityM5 * 0.8;

      const buyConfirmation =
        sweep.direction === "BUY" &&
        current.low > first.high &&
        current.close > sweep.candle.high &&
        displacement;

      const sellConfirmation =
        sweep.direction === "SELL" &&
        current.high < first.low &&
        current.close < sweep.candle.low &&
        displacement;

      if (buyConfirmation || sellConfirmation) {
        confirmation = current;
      }
    }

    if (!confirmation) {
      return wait("Sweep détecté, confirmation FVG M5 absente.", {
        trend,
        direction: sweep.direction,
        sweepLevel: round(sweep.level),
      });
    }

    const entry = sweep.direction === "BUY" ? ask : bid;
    const stopLoss =
      sweep.direction === "BUY"
        ? sweep.candle.low - volatilityM15 * 0.15
        : sweep.candle.high + volatilityM15 * 0.15;

    const risk = Math.abs(entry - stopLoss);

    if (risk <= 0 || risk > volatilityM15 * 2.5) {
      return wait("Entrée trop éloignée du sweep.");
    }

    const takeProfit =
      sweep.direction === "BUY"
        ? entry + risk * 2.5
        : entry - risk * 2.5;

    return NextResponse.json({
      status: "SETUP_VALID",
      symbol: "XAUUSD",
      direction: sweep.direction,
      entry: round(entry),
      stopLoss: round(stopLoss),
      takeProfit: round(takeProfit),
      riskReward: 2.5,
      suggestedRiskPercent: 0.25,
      trend,
      session: london ? "LONDON" : "NEW_YORK",
      sweepLevel: round(sweep.level),
      sweepTime: new Date(sweep.candle.time).toISOString(),
      confirmationTime: new Date(confirmation.time).toISOString(),
      priceSource: "FTMO-MT5",
      execution: "MANUAL_ONLY",
      warning: "Moteur expérimental à tester uniquement en démo.",
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Erreur setup:", error);

    return NextResponse.json(
      {
        status: "ERROR",
        reason: "Analyse MT5 impossible.",
      },
      { status: 500 }
    );
  }
}

// FIN DU FICHIER
