import { NextResponse } from "next/server";

import {
  loadXauusdResearchData,
} from "@/lib/research/market-data";

import {
  createLiquidityMssFvgSignals,
} from "@/lib/research/liquidity-mss-fvg";

import {
  DEFAULT_SIMULATION_CONFIG,
  SimulationResult,
  evaluateThreeWay,
} from "@/lib/research/simulator";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function summarize(
  result: SimulationResult
) {
  return {
    totalTrades:
      result.totalTrades,
    wins:
      result.wins,
    losses:
      result.losses,
    breakeven:
      result.breakeven,
    winRate:
      result.winRate,
    profitFactor:
      result.profitFactor,
    expectancyR:
      result.expectancyR,
    netR:
      result.netR,
    returnPercent:
      result.returnPercent,
    maximumDrawdownPercent:
      result
        .maximumClosedTradeDrawdownPercent,
    maximumConsecutiveLosses:
      result
        .maximumConsecutiveLosses,
    positiveMonthsPercent:
      result
        .positiveActiveMonthsPercent,
    skippedOverlap:
      result.skippedOverlap,
    skippedDailyLimit:
      result.skippedDailyLimit,
    recentTrades:
      result.recentTrades,
  };
}

function passesValidation(
  evaluation:
    ReturnType<
      typeof evaluateThreeWay
    >
) {
  const all =
    evaluation.all;

  const training =
    evaluation.training50;

  const validation =
    evaluation.validation25;

  const final =
    evaluation.final25;

  return (
    all.totalTrades >= 100 &&
    (all.profitFactor ?? 0) >=
      1.25 &&
    all.expectancyR >=
      0.1 &&
    all.netR > 0 &&
    all.maximumClosedTradeDrawdownPercent <
      5 &&
    training.netR > 0 &&
    validation.totalTrades >=
      20 &&
    validation.netR > 0 &&
    (validation.profitFactor ??
      0) >= 1.15 &&
    validation.expectancyR >
      0.05 &&
    final.totalTrades >= 20 &&
    final.netR > 0 &&
    (final.profitFactor ??
      0) >= 1.15 &&
    final.expectancyR > 0.05 &&
    final
      .positiveActiveMonthsPercent >=
      50
  );
}

export async function GET() {
  try {
    const data =
      await loadXauusdResearchData();

    if (
      data.h1.length <
        1000 ||
      data.m15.length <
        3000 ||
      data.m5.length <
        10000
    ) {
      return NextResponse.json(
        {
          error:
            "Historique FTMO insuffisant.",
          counts: {
            h1:
              data.h1.length,
            m15:
              data.m15.length,
            m5:
              data.m5.length,
          },
        },
        {
          status: 400,
        }
      );
    }

    const detection =
      createLiquidityMssFvgSignals(
        data
      );

    const evaluation =
      evaluateThreeWay(
        detection.signals,
        data.m5,
        {
          ...DEFAULT_SIMULATION_CONFIG,
          startingEquity:
            100000,
          riskPercent:
            0.1,
          spread:
            0.45,
          maximumTradesPerDay:
            2,
          maximumHoldingBars:
            72,
          forcedExitMinute:
            21 * 60,
        }
      );

    const passed =
      passesValidation(
        evaluation
      );

    const firstTime =
      data.m5[0].time;

    const lastTime =
      data.m5[
        data.m5.length - 1
      ].time;

    const approximateMonths =
      (lastTime -
        firstTime) /
      (
        30.4375 *
        24 *
        60 *
        60 *
        1000
      );

    return NextResponse.json(
      {
        strategy:
          "H1_STRUCTURE_POI_M15_SWEEP_M5_MSS_FVG_V1",
        symbol:
          "XAUUSD",
        source:
          "FTMO-MT5",
        timeData:
          "UTC_NORMALIZED",
        status:
          passed
            ? "CANDIDATE_FOR_SHORT_DEMO"
            : "DO_NOT_TRADE",
        rules: {
          trend:
            "Structure H1 avec BOS sur pivots confirmes 3/3",
          poiPriority: [
            "Previous day high/low",
            "Supply/Demand H1",
            "Equal highs/lows tolerance 0.40 USD",
            "Important H1 swings",
          ],
          sweep:
            "M15 depasse le niveau et cloture a nouveau dans la zone",
          mss:
            "Cloture M5 au-dela du dernier swing confirme 2/2, corps >= 0.5 ATR",
          fvg:
            "Desiquilibre M5 de trois bougies apres MSS",
          entry:
            "Premier retour au milieu 50% du FVG sous 12 bougies M5",
          stop:
            "Derriere le sweep avec marge 0.10 ATR M5",
          target:
            "Prochaine liquidite opposee avec minimum 2R",
          sessions:
            "Londres et New York avec DST automatique",
          news:
            "Filtre +/- 30 minutes non inclus faute de calendrier historique",
          riskPercent:
            0.1,
          maximumTradesPerDay:
            2,
          maximumHolding:
            "6 heures reelles, sortie forcee 21:00 UTC",
          spread:
            0.45,
          slippage:
            0.05,
          ambiguousBar:
            "STOP_FIRST",
        },
        period: {
          from:
            new Date(
              firstTime
            ).toISOString(),
          to:
            new Date(
              lastTime
            ).toISOString(),
          approximateMonths:
            Number(
              approximateMonths.toFixed(
                1
              )
            ),
          splitTimes:
            evaluation.splitTimes,
        },
        detection:
          detection.statistics,
        frequency: {
          signals:
            detection
              .signals
              .length,
          signalsPerMonth:
            Number(
              (
                detection
                  .signals
                  .length /
                approximateMonths
              ).toFixed(2)
            ),
        },
        results: {
          all:
            summarize(
              evaluation.all
            ),
          training50:
            summarize(
              evaluation
                .training50
            ),
          validation25:
            summarize(
              evaluation
                .validation25
            ),
          final25:
            summarize(
              evaluation
                .final25
            ),
        },
        validationChecks: {
          allTradesMinimum:
            evaluation.all
              .totalTrades >=
            100,
          allProfitFactor:
            (
              evaluation.all
                .profitFactor ??
              0
            ) >= 1.25,
          allExpectancy:
            evaluation.all
              .expectancyR >=
            0.1,
          validationTrades:
            evaluation
              .validation25
              .totalTrades >=
            20,
          validationPositive:
            evaluation
              .validation25
              .netR > 0,
          validationProfitFactor:
            (
              evaluation
                .validation25
                .profitFactor ??
              0
            ) >= 1.15,
          finalTrades:
            evaluation
              .final25
              .totalTrades >=
            20,
          finalPositive:
            evaluation
              .final25
              .netR > 0,
          finalProfitFactor:
            (
              evaluation
                .final25
                .profitFactor ??
              0
            ) >= 1.15,
          finalExpectancy:
            evaluation
              .final25
              .expectancyR >
            0.05,
          finalDecision:
            passed
              ? "SHORT_DEMO_TEST_ALLOWED"
              : "DO_NOT_TRADE",
        },
        limitation:
          "Le calendrier economique historique USD n'est pas encore integre. Tout signal proche d'une news forte devra etre exclu manuellement.",
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
      "Erreur backtest Liquidity MSS FVG:",
      error
    );

    return NextResponse.json(
      {
        error:
          "Backtest Liquidity MSS FVG impossible.",
      },
      {
        status: 500,
      }
    );
  }
}
