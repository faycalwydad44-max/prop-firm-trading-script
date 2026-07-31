import { NextResponse } from "next/server";

import {
  Candle,
  loadXauusdResearchData,
} from "@/lib/research/market-data";

import {
  createLiquidityMssFvgSignals,
} from "@/lib/research/liquidity-mss-fvg";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function serializeCandle(
  candle: Candle | undefined
) {
  if (!candle) {
    return null;
  }

  return {
    time: new Date(candle.time).toISOString(),
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
  };
}

function candleContext(
  candles: Candle[],
  timestamp: number
) {
  const index = candles.findIndex(
    (candle) => candle.time === timestamp
  );

  if (index < 0) {
    return {
      index: -1,
      previous: null,
      current: null,
      next: null,
    };
  }

  return {
    index,
    previous: serializeCandle(
      candles[index - 1]
    ),
    current: serializeCandle(
      candles[index]
    ),
    next: serializeCandle(
      candles[index + 1]
    ),
  };
}

export async function GET() {
  try {
    const data =
      await loadXauusdResearchData();

    const detection =
      createLiquidityMssFvgSignals(
        data
      );

    const setups =
      detection.signals.map(
        (signal, index) => ({
          number: index + 1,
          direction: signal.direction,
          poi: {
            id: signal.poiId,
            kind: signal.poiKind,
            level: signal.poiLevel,
          },
          sweepTime: new Date(
            signal.sweepTime
          ).toISOString(),
          mssTime: new Date(
            signal.mssTime
          ).toISOString(),
          fvgTime: new Date(
            signal.fvgTime
          ).toISOString(),
          entryTime: new Date(
            signal.entryTime
          ).toISOString(),
          entry: signal.entry,
          stopLoss: signal.stopLoss,
          targetLiquidity:
            signal.targetLiquidity,
          targetR: Number(
            signal.targetR.toFixed(2)
          ),
          fvg: {
            low: signal.fvgLow,
            high: signal.fvgHigh,
            midpoint:
              Number(
                (
                  (signal.fvgLow +
                    signal.fvgHigh) /
                  2
                ).toFixed(2)
              ),
          },
          candles: {
            sweepM15:
              candleContext(
                data.m15,
                signal.sweepTime
              ),
            mssM5:
              candleContext(
                data.m5,
                signal.mssTime
              ),
            fvgM5:
              candleContext(
                data.m5,
                signal.fvgTime
              ),
            entryM5:
              candleContext(
                data.m5,
                signal.entryTime
              ),
          },
        })
      );

    return NextResponse.json(
      {
        audit:
          "LIQUIDITY_MSS_FVG_VISUAL_AUDIT",
        warning:
          "Ces setups servent uniquement a verifier la traduction des regles. Ne pas les trader.",
        statistics:
          detection.statistics,
        setupCount:
          setups.length,
        setups,
        checksRequired: [
          "Le POI existait-il avant le sweep ?",
          "Le sweep M15 a-t-il cloture de nouveau dans la zone ?",
          "Le MSS M5 casse-t-il un vrai swing confirme ?",
          "Le FVG apparait-il apres le MSS ?",
          "Le retour a 50% du FVG est-il entre sans utiliser de donnees futures ?",
          "La prochaine liquidite offre-t-elle reellement au moins 2R ?",
        ],
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (error) {
    console.error(
      "Erreur audit liquidite:",
      error
    );

    return NextResponse.json(
      {
        error:
          "Audit des setups impossible.",
      },
      {
        status: 500,
      }
    );
  }
}
