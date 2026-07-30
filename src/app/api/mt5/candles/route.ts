import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/db";

export const dynamic = "force-dynamic";

const ALLOWED_TIMEFRAMES = new Set([
  "M5",
  "M15",
  "H1",
]);

type CandleInput = {
  timeframe?: unknown;
  openTime?: unknown;
  open?: unknown;
  high?: unknown;
  low?: unknown;
  close?: unknown;
  tickVolume?: unknown;
};

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

/*
 * FTMO MetaTrader utilise GMT+2 en hiver et GMT+3
 * pendant la période DST américaine.
 *
 * MT5 transmet ici une heure serveur encodée comme
 * un timestamp UTC. Il faut donc retirer l'offset FTMO.
 */
function ftmoUtcOffsetSeconds(
  serverTimestampSeconds: number
) {
  const serverDate = new Date(
    serverTimestampSeconds * 1000
  );

  const year = serverDate.getUTCFullYear();

  const dstStart = nthSunday(
    year,
    2,
    2
  );

  const dstEnd = nthSunday(
    year,
    10,
    1
  );

  const serverDay = Date.UTC(
    year,
    serverDate.getUTCMonth(),
    serverDate.getUTCDate()
  );

  const isDst =
    serverDay >= dstStart &&
    serverDay < dstEnd;

  return (isDst ? 3 : 2) * 60 * 60;
}

function normalizeFtmoTime(
  rawTime: unknown
) {
  if (typeof rawTime === "number") {
    const offset =
      ftmoUtcOffsetSeconds(rawTime);

    return new Date(
      (rawTime - offset) * 1000
    );
  }

  const parsed = new Date(
    String(rawTime)
  );

  if (Number.isNaN(parsed.getTime())) {
    return parsed;
  }

  const timestampSeconds = Math.floor(
    parsed.getTime() / 1000
  );

  const offset =
    ftmoUtcOffsetSeconds(
      timestampSeconds
    );

  return new Date(
    (timestampSeconds - offset) * 1000
  );
}

export async function POST(
  request: NextRequest
) {
  try {
    const expectedSecret =
      process.env.MT5_WEBHOOK_SECRET;

    const authorization =
      request.headers.get(
        "authorization"
      );

    if (
      !expectedSecret ||
      authorization !==
        `Bearer ${expectedSecret}`
    ) {
      return NextResponse.json(
        {
          error: "Non autorise",
        },
        {
          status: 401,
        }
      );
    }

    const body =
      await request.json();

    const symbol = String(
      body.symbol || ""
    ).toUpperCase();

    const candles =
      Array.isArray(body.candles)
        ? body.candles
        : [];

    if (
      symbol !== "XAUUSD" ||
      candles.length === 0 ||
      candles.length > 1500
    ) {
      return NextResponse.json(
        {
          error: "Requete invalide",
        },
        {
          status: 400,
        }
      );
    }

    const normalized = candles.map(
      (candle: CandleInput) => {
        const timeframe = String(
          candle.timeframe || ""
        ).toUpperCase();

        const open = Number(
          candle.open
        );

        const high = Number(
          candle.high
        );

        const low = Number(
          candle.low
        );

        const close = Number(
          candle.close
        );

        const tickVolume = Math.max(
          0,
          Number(
            candle.tickVolume
          ) || 0
        );

        const openTime =
          normalizeFtmoTime(
            candle.openTime
          );

        const valid =
          ALLOWED_TIMEFRAMES.has(
            timeframe
          ) &&
          Number.isFinite(open) &&
          Number.isFinite(high) &&
          Number.isFinite(low) &&
          Number.isFinite(close) &&
          open > 0 &&
          high >=
            Math.max(open, close) &&
          low <=
            Math.min(open, close) &&
          !Number.isNaN(
            openTime.getTime()
          );

        if (!valid) {
          throw new Error(
            "Bougie invalide"
          );
        }

        return {
          timeframe,
          open_time:
            openTime.toISOString(),
          open,
          high,
          low,
          close,
          tick_volume:
            tickVolume,
        };
      }
    );

    await pool.query(
      `INSERT INTO market_candles (
         symbol,
         timeframe,
         open_time,
         open,
         high,
         low,
         close,
         tick_volume,
         source,
         received_at
       )
       SELECT
         $2,
         candle.timeframe,
         candle.open_time,
         candle.open,
         candle.high,
         candle.low,
         candle.close,
         candle.tick_volume,
         'FTMO-MT5',
         NOW()
       FROM jsonb_to_recordset(
         $1::jsonb
       ) AS candle(
         timeframe VARCHAR(5),
         open_time TIMESTAMPTZ,
         open DOUBLE PRECISION,
         high DOUBLE PRECISION,
         low DOUBLE PRECISION,
         close DOUBLE PRECISION,
         tick_volume BIGINT
       )
       ON CONFLICT (
         symbol,
         timeframe,
         open_time
       )
       DO UPDATE SET
         open = EXCLUDED.open,
         high = EXCLUDED.high,
         low = EXCLUDED.low,
         close = EXCLUDED.close,
         tick_volume =
           EXCLUDED.tick_volume,
         source =
           EXCLUDED.source,
         received_at = NOW()`,
      [
        JSON.stringify(normalized),
        symbol,
      ]
    );

    return NextResponse.json({
      success: true,
      symbol,
      accepted:
        normalized.length,
      timeMode:
        "FTMO_SERVER_TO_UTC",
    });
  } catch (error) {
    console.error(
      "Erreur bougies MT5:",
      error
    );

    return NextResponse.json(
      {
        error:
          "Bougies invalides ou erreur serveur",
      },
      {
        status: 400,
      }
    );
  }
}

export async function GET() {
  try {
    const result =
      await pool.query(
        `SELECT
           timeframe,
           COUNT(*)::INTEGER
             AS candle_count,
           MAX(open_time)
             AS latest_candle,
           MAX(received_at)
             AS latest_reception
         FROM market_candles
         WHERE symbol = 'XAUUSD'
         GROUP BY timeframe
         ORDER BY timeframe`
      );

    return NextResponse.json(
      result.rows,
      {
        headers: {
          "Cache-Control":
            "no-store",
        },
      }
    );
  } catch {
    return NextResponse.json(
      [],
      {
        headers: {
          "Cache-Control":
            "no-store",
        },
      }
    );
  }
}
