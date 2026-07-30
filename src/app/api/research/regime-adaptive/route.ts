import { NextResponse } from "next/server";

import {
  loadXauusdResearchData,
} from "@/lib/research/market-data";

import {
  REGIME_CANDIDATES,
  buildResearchIndicators,
  createRegimeAdaptiveSignals,
} from "@/lib/research/regime-strategies";

import {
  SimulationResult,
  ThreeWayEvaluation,
  evaluateThreeWay,
} from "@/lib/research/simulator";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type StreamName =
  | "TREND"
  | "RANGE"
  | "COMBINED";

type ResearchReport = {
  candidateId: string;
  stream: StreamName;
  evaluation: ThreeWayEvaluation;
  developmentPassed: boolean;
  developmentScore: number;
};

function profitFactor(
  result: SimulationResult
) {
  return result.profitFactor ?? 0;
}

function summarize(
  result: SimulationResult
) {
  return {
    totalTrades: result.totalTrades,
    wins: result.wins,
    losses: result.losses,
    winRate: result.winRate,
    profitFactor: result.profitFactor,
    expectancyR: result.expectancyR,
    netR: result.netR,
    returnPercent: result.returnPercent,
    maximumDrawdownPercent:
      result.maximumClosedTradeDrawdownPercent,
    maximumConsecutiveLosses:
      result.maximumConsecutiveLosses,
    positiveMonthsPercent:
      result.positiveActiveMonthsPercent,
  };
}

function passesDevelopment(
  evaluation: ThreeWayEvaluation
) {
  const training = evaluation.training50;
  const validation = evaluation.validation25;

  return (
    training.totalTrades >= 30 &&
    validation.totalTrades >= 15 &&
    training.netR > 0 &&
    validation.netR > 0 &&
    profitFactor(training) >= 1.1 &&
    profitFactor(validation) >= 1.15 &&
    training.expectancyR > 0 &&
    validation.expectancyR >= 0.05 &&
    training.maximumClosedTradeDrawdownPercent < 5 &&
    validation.maximumClosedTradeDrawdownPercent < 5
  );
}

function developmentScore(
  evaluation: ThreeWayEvaluation
) {
  const training = evaluation.training50;
  const validation = evaluation.validation25;

  const stableProfitFactor = Math.min(
    profitFactor(training),
    profitFactor(validation)
  );

  const stableExpectancy = Math.min(
    training.expectancyR,
    validation.expectancyR
  );

  const tradeScore = Math.min(
    validation.totalTrades,
    50
  ) / 50;

  return (
    stableProfitFactor * 2 +
    stableExpectancy * 4 +
    tradeScore
  );
}

function passesFinalTest(
  evaluation: ThreeWayEvaluation
) {
  const all = evaluation.all;
  const final = evaluation.final25;

  return (
    all.totalTrades >= 100 &&
    profitFactor(all) >= 1.2 &&
    all.expectancyR >= 0.1 &&
    all.netR > 0 &&
    all.maximumClosedTradeDrawdownPercent < 5 &&
    final.totalTrades >= 20 &&
    profitFactor(final) >= 1.15 &&
    final.expectancyR >= 0.05 &&
    final.netR > 0 &&
    final.maximumClosedTradeDrawdownPercent < 5 &&
    final.positiveActiveMonthsPercent >= 50
  );
}

export async function GET() {
  try {
    const data =
      await loadXauusdResearchData();

    if (
      data.h1.length < 1000 ||
      data.m15.length < 3000 ||
      data.m5.length < 10000
    ) {
      return NextResponse.json(
        {
          error:
            "Historique FTMO insuffisant.",
          counts: {
            h1: data.h1.length,
            m15: data.m15.length,
            m5: data.m5.length,
          },
        },
        { status: 400 }
      );
    }

    const indicators =
      buildResearchIndicators(data);

    const reports: ResearchReport[] = [];

    for (
      const candidate
      of REGIME_CANDIDATES
    ) {
      const signals =
        createRegimeAdaptiveSignals(
          data,
          indicators,
          candidate
        );

      const streams = [
        {
          name: "TREND" as const,
          signals: signals.trend,
        },
        {
          name: "RANGE" as const,
          signals: signals.range,
        },
        {
          name: "COMBINED" as const,
          signals: signals.combined,
        },
      ];

      for (const stream of streams) {
        const evaluation =
          evaluateThreeWay(
            stream.signals,
            data.m5
          );

        reports.push({
          candidateId: candidate.id,
          stream: stream.name,
          evaluation,
          developmentPassed:
            passesDevelopment(
              evaluation
            ),
          developmentScore:
            developmentScore(
              evaluation
            ),
        });
      }
    }

    // Le dernier quart des données n'est pas
    // utilisé pour sélectionner la variante.
    const eligible = reports
      .filter(
        (report) =>
          report.developmentPassed
      )
      .sort(
        (left, right) =>
          right.developmentScore -
          left.developmentScore
      );

    const selected =
      eligible[0] ?? null;

    const finalPassed =
      selected !== null &&
      passesFinalTest(
        selected.evaluation
      );

    const rankedDevelopment =
      reports
        .map((report) => ({
          candidateId:
            report.candidateId,
          stream: report.stream,
          developmentPassed:
            report.developmentPassed,
          developmentScore:
            Number(
              report.developmentScore.toFixed(
                3
              )
            ),
          training50:
            summarize(
              report.evaluation
                .training50
            ),
          validation25:
            summarize(
              report.evaluation
                .validation25
            ),
        }))
        .sort(
          (left, right) =>
            right.developmentScore -
            left.developmentScore
        );

    const selectedResult =
      selected
        ? {
            candidateId:
              selected.candidateId,
            stream:
              selected.stream,
            selectedWithoutFinalData:
              true,
            training50:
              summarize(
                selected.evaluation
                  .training50
              ),
            validation25:
              summarize(
                selected.evaluation
                  .validation25
              ),
            final25:
              summarize(
                selected.evaluation
                  .final25
              ),
            all:
              summarize(
                selected.evaluation
                  .all
              ),
            finalTestPassed:
              finalPassed,
          }
        : null;

    const firstTime =
      data.m5[0].time;

    const lastTime =
      data.m5[
        data.m5.length - 1
      ].time;

    const approximateMonths =
      (lastTime - firstTime) /
      (
        30.4375 *
        24 *
        60 *
        60 *
        1000
      );

    return NextResponse.json(
      {
        research:
          "XAUUSD_REGIME_ADAPTIVE_V1",
        source: "FTMO-MT5",
        status:
          finalPassed
            ? "CANDIDATE_FOR_SHORT_DEMO_TEST"
            : "DO_NOT_TRADE",
        method: {
          training: "50%",
          validation: "25%",
          finalUntouchedTest:
            "25%",
          candidatesTested:
            REGIME_CANDIDATES.length,
          streamsPerCandidate: 3,
          totalFixedHypotheses:
            reports.length,
          finalDataUsedForSelection:
            false,
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
          candles: {
            h1: data.h1.length,
            m15:
              data.m15.length,
            m5: data.m5.length,
          },
        },
        selected:
          selectedResult,
        developmentRanking:
          rankedDevelopment,
        acceptanceCriteria: {
          allTradesMinimum: 100,
          allProfitFactorMinimum:
            1.2,
          allExpectancyMinimumR:
            0.1,
          finalTradesMinimum: 20,
          finalProfitFactorMinimum:
            1.15,
          finalExpectancyMinimumR:
            0.05,
          maximumDrawdownPercent:
            5,
          finalPositiveMonthsMinimum:
            "50%",
        },
        decision:
          finalPassed
            ? "La variante peut passer a un court test FTMO Demo a 0,10% de risque."
            : "Aucune variante ne doit etre ajoutee au Dashboard ou a Telegram.",
        warning:
          "Recherche historique experimentale. Aucun resultat ne garantit les performances futures.",
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
      "Erreur recherche adaptative:",
      error
    );

    return NextResponse.json(
      {
        error:
          "Recherche adaptative impossible.",
      },
      { status: 500 }
    );
  }
}
