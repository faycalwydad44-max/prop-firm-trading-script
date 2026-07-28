import { NextResponse } from "next/server";
import { pool } from "@/db";

export const dynamic = "force-dynamic";

type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

type Sweep = {
  direction: "BUY" | "SELL";
  candle: Candle;
  level: number;
};

function parseCandles(rows: Record<string, unknown>[]): Candle[] {
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

function ema(values: number[], period: number): number | null {
  if (values.length < period) return null;

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

  return (
    recent.reduce((sum, value) => sum + value, 0) /
    recent.length
  );
}

function roundPrice(value: number) {
  return Math.round(value * 100) / 100;
}

function wait(
  reason: string,
  details: Record<string, unknown> = {}
) {
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
          `SELECT open_time, open, high, low, close
           FROM market_candles
           WHERE symbol = 'XAUUSD'
             AND timeframe = 'H1'
           ORDER BY open_time DESC
           LIMIT 260`
        ),
        pool.query(
          `SELECT open_time, open, high, low, close
           FROM market_candles
           WHERE symbol = 'XAUUSD'
             AND timeframe = 'M15'
           ORDER BY open_time DESC
           LIMIT 120`
        ),
        pool.query(
          `SELECT open_time, open, high, low, close
           FROM market_candles
           WHERE symbol = 'XAUUSD'
             AND timeframe = 'M5'
           ORDER BY open_time DESC
           LIMIT 180`
        ),
        pool.query(
          `SELECT bid, ask, received_at
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
    const priceTime = new Date(priceRow.received_at);
    const priceAge =
      (Date.now() - priceTime.getTime()) / 1000;

    if (
      !Number.isFinite(bid) ||
      !Number.isFinite(ask) ||
      bid <= 0 ||
      ask <= 0 ||
      priceAge > 120
    ) {
      return wait("Le flux FTMO-MT5 est arrêté ou en retard.", {
        priceAgeSeconds: Math.round(priceAge),
      });
    }

    // La dernière bougie est encore en formation.
    const h1Closed = h1.slice(0, -1);
    const m15Closed = m15.slice(0, -1);
    const m5Closed = m5.slice(0, -1);

    const h1Closes = h1Closed.map(
      (candle) => candle.close
    );

    const ema50 = ema(h1Closes, 50);
    const ema200 = ema(h1Closes, 200);
    const previousEma50 = ema(
      h1Closes.slice(0, -1),
      50
    );

    if (
      ema50 === null ||
      ema200 === null ||
      previousEma50 === null
    ) {
      return wait("Calcul de la tendance H1 impossible.");
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
      return wait("Tendance H1 insuffisamment claire.", {
        close: roundPrice(lastH1.close),
        ema50: roundPrice(ema50),
        ema200: roundPrice(ema200),
      });
    }

    const latestCandle = m5[m5.length - 1];
    const latestTime = new Date(latestCandle.time);
    const serverMinutes =
      latestTime.getUTCHours() * 60 +
      latestTime.getUTCMinutes();

    const london =
      serverMinutes >= 8 * 60 &&
      serverMinutes <= 13 * 60;

    const newYork =
      serverMinutes >= 14 * 60 + 30 &&
      serverMinutes <= 19 * 60 + 30;

    if (!london && !newYork) {
      return wait("Hors des sessions Londres et New York.", {
        trend,
        serverTime: latestTime.toISOString(),
      });
    }

    let sweep: Sweep | null = null;

    const startIndex = Math.max(
      20,
      m15Closed.length - 5
    );

    for (
      let index = startIndex;
      index < m15Closed.length;
      index++
    ) {
      const candle = m15Closed[index];
      const previous = m15Closed.slice(
        index - 20,
        index
      );

      const previousLow = Math.min(
        ...previous.map((item) => item.low)
      );

      const previousHigh = Math.max(
        ...previous.map((item) => item.high)
      );

      if (
        trend === "BULLISH" &&
        candle.low < previousLow &&
        candle.close > previousLow
      ) {
        sweep = {
          direction: "BUY",
          candle,
          level: previousLow,
        };
      }

      if (
        trend === "BEARISH" &&
        candle.high > previousHigh &&
        candle.close < previousHigh
      ) {
        sweep = {
          direction: "SELL",
          candle,
          level: previousHigh,
        };
      }
    }

    if (!sweep) {
      return wait("Aucun sweep M15 confirmé.", {
        trend,
        session: london ? "LONDON" : "NEW_YORK",
      });
    }

    const confirmedSweep = sweep;
    const atrM5 = atr(m5Closed, 14);
    const atrM15 = atr(m15Closed, 14);

    if (atrM5 === null || atrM15 === null) {
      return wait("Calcul de la volatilité impossible.");
    }

    const afterSweep = m5Closed.filter(
      (candle) =>
        candle.time >= confirmedSweep.candle.time
    );

    let confirmation: Candle | null = null;
    let confirmationType = "";

    for (
      let index = 2;
      index < afterSweep.length;
      index++
    ) {
      const first = afterSweep[index - 2];
      const current = afterSweep[index];

      const body = Math.abs(
        current.close - current.open
      );

      const displacement = body >= atrM5 * 0.8;

      const bullishFvg =
        confirmedSweep.direction === "BUY" &&
        current.low > first.high &&
        current.close > confirmedSweep.candle.high &&
        displacement;

      const bearishFvg =
        confirmedSweep.direction === "SELL" &&
        current.high < first.low &&
        current.close < confirmedSweep.candle.low &&
        displacement;

      if (bullishFvg || bearishFvg) {
        confirmation = current;
        confirmationType = bullishFvg
          ? "BULLISH_FVG_M5"
          : "BEARISH_FVG_M5";
      }
    }

    if (!confirmation) {
      return wait(
        "Sweep présent, mais confirmation M5 absente.",
        {
          trend,
          direction: confirmedSweep.direction,
          sweepLevel: roundPrice(
            confirmedSweep.level
          ),
          sweepTime: new Date(
            confirmedSweep.candle.time
          ).toISOString(),
        }
      );
    }

    const entry =
      confirmedSweep.direction === "BUY"
        ? ask
        : bid;

    const stopLoss =
      confirmedSweep.direction === "BUY"
        ? confirmedSweep.candle.low -
          atrM15 * 0.15
        : confirmedSweep.candle.high +
          atrM15 * 0.15;

    const riskDistance = Math.abs(
      entry - stopLoss
    );

    if (
      riskDistance <= 0 ||
      riskDistance > atrM15 * 2.5
    ) {
      return wait("Entrée trop éloignée du sweep.", {
        entry: roundPrice(entry),
        stopLoss: roundPrice(stopLoss),
        atrM15: roundPrice(atrM15),
      });
    }

    const takeProfit =
      confirmedSweep.direction === "BUY"
        ? entry + riskDistance * 2.5
        : entry - riskDistance * 2.5;

    return NextResponse.json({
      status: "SETUP_VALID",
      symbol: "XAUUSD",
      direction: confirmedSweep.direction,
      entry: roundPrice(entry),
      stopLoss: roundPrice(stopLoss),
      takeProfit: roundPrice(takeProfit),
      riskReward: 2.5,
      suggestedRiskPercent: 0.25,
      trend: {
        timeframe: "H1",
        direction: trend,
        close: roundPrice(lastH1.close),
        ema50: roundPrice(ema50),
        ema200: roundPrice(ema200),
      },
      liquiditySweep: {
        timeframe: "M15",
        level: roundPrice(confirmedSweep.level),
        candleTime: new Date(
          confirmedSweep.candle.time
        ).toISOString(),
      },
      confirmation: {
        timeframe: "M5",
        type: confirmationType,
        candleTime: new Date(
          confirmation.time
        ).toISOString(),
      },
      session: london ? "LONDON" : "NEW_YORK",
      priceSource: "FTMO-MT5",
      execution: "MANUAL_ONLY",
      generatedAt: new Date().toISOString(),
      warning:
        "Moteur expérimental. Vérification manuelle et test en démo obligatoires.",
    });
  } catch (error) {
    console.error("Erreur moteur de setup:", error);

    return NextResponse.json(
      {
        status: "ERROR",
        reason: "Analyse MT5 impossible.",
      },
      { status: 500 }
    );
  }
}

    if (!londonSession && !newYorkSession) {
      return wait
