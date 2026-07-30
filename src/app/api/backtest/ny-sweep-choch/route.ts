import { NextResponse } from "next/server";

import {
  Candle,
  M5_MS,
  atrSeries,
  dayStart,
  firstIndexAtOrAfter,
  loadXauusdResearchData,
  minuteOfDay,
} from "@/lib/research/market-data";

import {
  DEFAULT_SIMULATION_CONFIG,
  Direction,
  ResearchSignal,
  evaluateThreeWay,
} from "@/lib/research/simulator";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Level = {
  name:
    | "PREVIOUS_DAY_HIGH"
    | "PREVIOUS_DAY_LOW"
    | "ASIA_HIGH"
    | "ASIA_LOW";
  direction: Direction;
  price: number;
};

type PivotState = {
  high: Array<number | null>;
  low: Array<number | null>;
};

const MINUTE_MS = 60 * 1000;

const SPREAD = 0.45;
const SLIPPAGE = 0.05;
const TARGET_R = 2;
const RISK_PERCENT = 0.1;

const ASIA_START_MINUTE = 2 * 60;
const ASIA_END_MINUTE = 10 * 60;

const SWEEP_LOOKBACK = 10;
const CHOCH_MAXIMUM_BARS = 12;
const CHOCH_BODY_ATR = 0.5;
const OBSTACLE_MINIMUM_R = 1.5;

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

function lastSunday(
  year: number,
  month: number
) {
  const lastDay = new Date(
    Date.UTC(year, month + 1, 0)
  );

  return Date.UTC(
    year,
    month,
    lastDay.getUTCDate() -
      lastDay.getUTCDay()
  );
}

function isUsDst(day: number) {
  const date = new Date(day);
  const year = date.getUTCFullYear();

  const start = nthSunday(
    year,
    2,
    2
  );

  const end = nthSunday(
    year,
    10,
    1
  );

  return day >= start && day < end;
}

function isEuropeDst(day: number) {
  const date = new Date(day);
  const year = date.getUTCFullYear();

  const start = lastSunday(
    year,
    2
  );

  const end = lastSunday(
    year,
    9
  );

  return day >= start && day < end;
}

function newYorkWindowOnFtmoClock(
  day: number
) {
  const ftmoOffset =
    isEuropeDst(day) ? 3 : 2;

  const newYorkOffset =
    isUsDst(day) ? -4 : -5;

  const difference =
    ftmoOffset - newYorkOffset;

  const startMinute =
    9 * 60 +
    30 +
    difference * 60;

  const start =
    day +
    startMinute *
      MINUTE_MS;

  const end =
    start +
    150 *
      MINUTE_MS;

  return {
    start,
    end,
    ftmoOffset,
    newYorkOffset,
  };
}

function confirmedPivots(
  candles: Candle[],
  left = 2,
  right = 2
): PivotState {
  const high:
    Array<number | null> =
      new Array(
        candles.length
      ).fill(null);

  const low:
    Array<number | null> =
      new Array(
        candles.length
      ).fill(null);

  let latestHigh:
    number | null = null;

  let latestLow:
    number | null = null;

  for (
    let confirmedAt = 0;
    confirmedAt <
      candles.length;
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
        if (
          index === pivotIndex
        ) {
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

function buildDailyMap(
  candles: Candle[]
) {
  const map =
    new Map<number, Candle[]>();

  for (const candle of candles) {
    const day =
      dayStart(candle.time);

    const current =
      map.get(day) || [];

    current.push(candle);
    map.set(day, current);
  }

  return map;
}

function uniqueLevels(
  levels: Level[]
) {
  const output: Level[] = [];

  for (const level of levels) {
    const duplicate =
      output.some(
        (existing) =>
          existing.direction ===
            level.direction &&
          Math.abs(
            existing.price -
              level.price
          ) <= 0.1
      );

    if (!duplicate) {
      output.push(level);
    }
  }

  return output;
}

function nearestObstacleR(
  direction: Direction,
  entry: number,
  risk: number,
  levels: Level[]
) {
  const obstacles =
    direction === "BUY"
      ? levels
          .map(
            (level) =>
              level.price
          )
          .filter(
            (price) =>
              price > entry
          )
      : levels
          .map(
            (level) =>
              level.price
          )
          .filter(
            (price) =>
              price < entry
          );

  if (
    obstacles.length === 0
  ) {
    return Number.POSITIVE_INFINITY;
  }

  const nearest =
    direction === "BUY"
      ? Math.min(...obstacles)
      : Math.max(...obstacles);

  return (
    Math.abs(nearest - entry) /
    risk
  );
}

function createSignals(
  m5: Candle[]
): ResearchSignal[] {
  const signals:
    ResearchSignal[] = [];

  const atrM5 =
    atrSeries(m5, 14);

  const pivots =
    confirmedPivots(m5);

  const dailyMap =
    buildDailyMap(m5);

  const days = [
    ...dailyMap.keys(),
  ].sort(
    (left, right) =>
      left - right
  );

  for (
    let dayIndex = 1;
    dayIndex < days.length;
    dayIndex++
  ) {
    const day =
      days[dayIndex];

    const previousDay =
      days[dayIndex - 1];

    const currentCandles =
      dailyMap.get(day) || [];

    const previousCandles =
      dailyMap.get(
        previousDay
      ) || [];

    if (
      currentCandles.length === 0 ||
      previousCandles.length === 0
    ) {
      continue;
    }

    const asia =
      currentCandles.filter(
        (candle) => {
          const minute =
            minuteOfDay(
              candle.time
            );

          return (
            minute >=
              ASIA_START_MINUTE &&
            minute <
              ASIA_END_MINUTE
          );
        }
      );

    if (asia.length < 24) {
      continue;
    }

    const previousHigh =
      Math.max(
        ...previousCandles.map(
          (candle) =>
            candle.high
        )
      );

    const previousLow =
      Math.min(
        ...previousCandles.map(
          (candle) =>
            candle.low
        )
      );

    const asiaHigh =
      Math.max(
        ...asia.map(
          (candle) =>
            candle.high
        )
      );

    const asiaLow =
      Math.min(
        ...asia.map(
          (candle) =>
            candle.low
        )
      );

    const levels =
      uniqueLevels([
        {
          name:
            "PREVIOUS_DAY_LOW",
          direction: "BUY",
          price: previousLow,
        },
        {
          name: "ASIA_LOW",
          direction: "BUY",
          price: asiaLow,
        },
        {
          name:
            "PREVIOUS_DAY_HIGH",
          direction: "SELL",
          price: previousHigh,
        },
        {
          name: "ASIA_HIGH",
          direction: "SELL",
          price: asiaHigh,
        },
      ]);

    const window =
      newYorkWindowOnFtmoClock(
        day
      );

    const start =
      firstIndexAtOrAfter(
        m5,
        window.start
      );

    const end =
      firstIndexAtOrAfter(
        m5,
        window.end
      );

    let signalCreated =
      false;

    for (
      let sweepIndex = start;
      sweepIndex < end &&
      !signalCreated;
      sweepIndex++
    ) {
      const sweep =
        m5[sweepIndex];

      const volatility =
        atrM5[sweepIndex];

      if (
        volatility === null ||
        sweepIndex <
          SWEEP_LOOKBACK
      ) {
        continue;
      }

      for (
        const level
        of levels
      ) {
        const buySweep =
          level.direction ===
            "BUY" &&
          sweep.low <
            level.price &&
          sweep.close >
            level.price;

        const sellSweep =
          level.direction ===
            "SELL" &&
          sweep.high >
            level.price &&
          sweep.close <
            level.price;

        if (
          !buySweep &&
          !sellSweep
        ) {
          continue;
        }

        const direction =
          level.direction;

        const chochLevel =
          direction === "BUY"
            ? pivots.high[
                sweepIndex
              ]
            : pivots.low[
                sweepIndex
              ];

        if (
          chochLevel === null
        ) {
          continue;
        }

        if (
          direction === "BUY" &&
          chochLevel <=
            sweep.close
        ) {
          continue;
        }

        if (
          direction ===
            "SELL" &&
          chochLevel >=
            sweep.close
        ) {
          continue;
        }

        const confirmationEnd =
          Math.min(
            end,
            sweepIndex +
              CHOCH_MAXIMUM_BARS +
              1
          );

        for (
          let confirmationIndex =
            sweepIndex + 1;
          confirmationIndex <
            confirmationEnd;
          confirmationIndex++
        ) {
          const confirmation =
            m5[
              confirmationIndex
            ];

          const confirmationAtr =
            atrM5[
              confirmationIndex
            ];

          if (
            confirmationAtr ===
            null
          ) {
            continue;
          }

          const body =
            Math.abs(
              confirmation.close -
                confirmation.open
            );

          const bullishChoch =
            direction === "BUY" &&
            confirmation.close >
              chochLevel &&
            confirmation.close >
              confirmation.open &&
            body >=
              confirmationAtr *
                CHOCH_BODY_ATR;

          const bearishChoch =
            direction ===
              "SELL" &&
            confirmation.close <
              chochLevel &&
            confirmation.close <
              confirmation.open &&
            body >=
              confirmationAtr *
                CHOCH_BODY_ATR;

          if (
            !bullishChoch &&
            !bearishChoch
          ) {
            continue;
          }

          const entry =
            direction === "BUY"
              ? confirmation.close +
                SPREAD +
                SLIPPAGE
              : confirmation.close -
                SLIPPAGE;

          const stopBase =
            direction === "BUY"
              ? Math.min(
                  sweep.low,
                  level.price
                )
              : Math.max(
                  sweep.high,
                  level.price
                );

          const stopLoss =
            direction === "BUY"
              ? stopBase -
                volatility *
                  0.1
              : stopBase +
                volatility *
                  0.1 +
                SPREAD;

          const risk =
            Math.abs(
              entry - stopLoss
            );

          if (
            risk <=
              SPREAD * 1.5 ||
            risk >
              volatility * 3
          ) {
            continue;
          }

          const obstacleR =
            nearestObstacleR(
              direction,
              entry,
              risk,
              levels
            );

          if (
            obstacleR <
            OBSTACLE_MINIMUM_R
          ) {
            continue;
          }

          signals.push({
            strategy:
              `NY_SWEEP_CHOCH:${level.name}`,
            direction,
            entryTime:
              confirmation.time +
              M5_MS,
            entry,
            stopLoss,
            targetR:
              TARGET_R,
          });

          signalCreated = true;
          break;
        }

        if (signalCreated) {
          break;
        }
      }
    }
  }

  return signals;
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
    final.expectancyR > 0.05
  );
}

export async function GET() {
  try {
    const data =
      await loadXauusdResearchData();

    if (
      data.m5.length <
      10000
    ) {
      return NextResponse.json(
        {
          error:
            "Historique FTMO insuffisant.",
        },
        { status: 400 }
      );
    }

    const signals =
      createSignals(data.m5);

    const evaluation =
      evaluateThreeWay(
        signals,
        data.m5,
        {
          ...DEFAULT_SIMULATION_CONFIG,
          riskPercent:
            RISK_PERCENT,
          maximumTradesPerDay:
            1,
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
          "NY_SWEEP_CHOCH_LEVELS_V1_FROZEN",
        symbol: "XAUUSD",
        source: "FTMO-MT5",
        status:
          passed
            ? "CANDIDATE_FOR_SHORT_DEMO"
            : "DO_NOT_TRADE",
        rules: {
          levels: [
            "Previous day high",
            "Previous day low",
            "Asia high",
            "Asia low",
          ],
          asiaWindow:
            "02:00-10:00 FTMO",
          newYorkWindow:
            "09:30-12:00 America/New_York",
          sweep:
            "Depassement du niveau puis cloture a nouveau a l'interieur",
          choch:
            "Cassure d'un pivot M5 confirme avec corps >= 0.5 ATR",
          entry:
            "Apres cloture CHOCH",
          stop:
            "Derriere le sweep avec marge ATR",
          targetR:
            TARGET_R,
          minimumObstacleDistanceR:
            OBSTACLE_MINIMUM_R,
          riskPercent:
            RISK_PERCENT,
          maximumTradesPerDay:
            1,
          spread:
            SPREAD,
          slippage:
            SLIPPAGE,
          newsFilter:
            "Non disponible dans le backtest, obligatoire en execution reelle",
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
        },
        detectedSignals:
          signals.length,
        signalsPerMonth:
          Number(
            (
              signals.length /
              approximateMonths
            ).toFixed(2)
          ),
        evaluation,
        validationChecks: {
          allTradesMinimum:
            evaluation.all
              .totalTrades >= 100,
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
          validationPositive:
            evaluation
              .validation25
              .netR > 0,
          finalTradesMinimum:
            evaluation.final25
              .totalTrades >= 20,
          finalProfitFactor:
            (
              evaluation.final25
                .profitFactor ??
              0
            ) >= 1.15,
          finalExpectancy:
            evaluation.final25
              .expectancyR >
            0.05,
          finalPositive:
            evaluation.final25
              .netR > 0,
          finalDecision:
            passed
              ? "SHORT_DEMO_TEST_ALLOWED"
              : "DO_NOT_TRADE",
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
      "Erreur NY Sweep CHOCH:",
      error
    );

    return NextResponse.json(
      {
        error:
          "Backtest NY Sweep CHOCH impossible.",
      },
      { status: 500 }
    );
  }
}
