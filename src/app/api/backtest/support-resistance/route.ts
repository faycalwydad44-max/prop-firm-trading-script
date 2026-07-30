import { NextResponse } from "next/server";

import {
  Candle,
  M5_MS,
  M15_MS,
  NumberSeries,
  atrSeries,
  firstIndexAtOrAfter,
  loadXauusdResearchData,
  minuteOfDay,
} from "@/lib/research/market-data";

import {
  Direction,
  ResearchSignal,
  ThreeWayEvaluation,
  evaluateThreeWay,
} from "@/lib/research/simulator";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type ZoneKind =
  | "SUPPORT"
  | "RESISTANCE";

type Zone = {
  id: number;
  kind: ZoneKind;
  center: number;
  low: number;
  high: number;
  reactions: number;
  createdTime: number;
  lastPivotTime: number;
  active: boolean;
};

type PendingBreakout = {
  zone: Zone;
  direction: Direction;
  breakoutIndex: number;
  expiryIndex: number;
};

type BaseSignal = {
  strategy:
    | "BREAKOUT_RETEST"
    | "ZONE_REJECTION";
  direction: Direction;
  entryTime: number;
  entry: number;
  stopLoss: number;
};

type DetectionResult = {
  breakoutRetest: BaseSignal[];
  zoneRejection: BaseSignal[];
};

const SPREAD = 0.45;
const SLIPPAGE = 0.05;

const SESSION_START_MINUTE =
  6 * 60;

const SESSION_END_MINUTE =
  20 * 60;

const TARGETS = [1.5, 2];

const PIVOT_LEFT = 2;
const PIVOT_RIGHT = 2;

const MINIMUM_REACTIONS = 2;
const MINIMUM_PIVOT_DISTANCE = 8;

const ZONE_HALF_WIDTH_ATR = 0.2;
const ZONE_MERGE_DISTANCE_ATR = 0.35;
const ZONE_EXPIRY_BARS = 480;

const BREAKOUT_BODY_ATR = 0.5;
const BREAKOUT_BUFFER_ATR = 0.1;
const RETEST_EXPIRY_BARS = 6;

const CONFIRMATION_BODY_ATR = 0.35;
const M5_CONFIRMATION_BARS = 8;
const LOCAL_STRUCTURE_LOOKBACK = 10;

function insideSession(
  timestamp: number
) {
  const minutes =
    minuteOfDay(timestamp);

  return (
    minutes >= SESSION_START_MINUTE &&
    minutes <= SESSION_END_MINUTE
  );
}

function sameDay(
  first: number,
  second: number
) {
  return (
    new Date(first)
      .toISOString()
      .slice(0, 10) ===
    new Date(second)
      .toISOString()
      .slice(0, 10)
  );
}

function isConfirmedPivotHigh(
  candles: Candle[],
  index: number
) {
  const pivot = candles[index];

  for (
    let itemIndex =
      index - PIVOT_LEFT;
    itemIndex <=
    index + PIVOT_RIGHT;
    itemIndex++
  ) {
    if (
      itemIndex !== index &&
      candles[itemIndex].high >=
        pivot.high
    ) {
      return false;
    }
  }

  return true;
}

function isConfirmedPivotLow(
  candles: Candle[],
  index: number
) {
  const pivot = candles[index];

  for (
    let itemIndex =
      index - PIVOT_LEFT;
    itemIndex <=
    index + PIVOT_RIGHT;
    itemIndex++
  ) {
    if (
      itemIndex !== index &&
      candles[itemIndex].low <=
        pivot.low
    ) {
      return false;
    }
  }

  return true;
}

function addPivotToZones(
  zones: Zone[],
  kind: ZoneKind,
  price: number,
  pivotTime: number,
  confirmationTime: number,
  volatility: number,
  nextZoneId: {
    value: number;
  }
) {
  const mergeDistance =
    volatility *
    ZONE_MERGE_DISTANCE_ATR;

  const existing = zones
    .filter(
      (zone) =>
        zone.active &&
        zone.kind === kind
    )
    .sort(
      (left, right) =>
        Math.abs(
          left.center - price
        ) -
        Math.abs(
          right.center - price
        )
    )
    .find(
      (zone) =>
        Math.abs(
          zone.center - price
        ) <= mergeDistance
    );

  if (existing) {
    const barsBetween =
      Math.round(
        (pivotTime -
          existing.lastPivotTime) /
          M15_MS
      );

    if (
      barsBetween >=
      MINIMUM_PIVOT_DISTANCE
    ) {
      existing.center =
        (existing.center *
          existing.reactions +
          price) /
        (existing.reactions + 1);

      existing.reactions++;

      const halfWidth =
        volatility *
        ZONE_HALF_WIDTH_ATR;

      existing.low =
        existing.center -
        halfWidth;

      existing.high =
        existing.center +
        halfWidth;

      existing.lastPivotTime =
        pivotTime;

      if (
        existing.reactions ===
        MINIMUM_REACTIONS
      ) {
        existing.createdTime =
          confirmationTime;
      }
    }

    return;
  }

  const halfWidth =
    volatility *
    ZONE_HALF_WIDTH_ATR;

  zones.push({
    id: nextZoneId.value++,
    kind,
    center: price,
    low: price - halfWidth,
    high: price + halfWidth,
    reactions: 1,
    createdTime:
      Number.POSITIVE_INFINITY,
    lastPivotTime: pivotTime,
    active: true,
  });
}

function validRisk(
  entry: number,
  stopLoss: number,
  volatility: number
) {
  const risk =
    Math.abs(
      entry - stopLoss
    );

  return (
    risk >= SPREAD * 1.5 &&
    risk <= volatility * 3
  );
}

function findConfirmation(
  direction: Direction,
  referenceHigh: number,
  referenceLow: number,
  afterTime: number,
  m5: Candle[],
  atrM5: NumberSeries,
  strategy:
    | "BREAKOUT_RETEST"
    | "ZONE_REJECTION"
) {
  const start =
    firstIndexAtOrAfter(
      m5,
      afterTime
    );

  const end = Math.min(
    m5.length,
    start +
      M5_CONFIRMATION_BARS
  );

  for (
    let index = start;
    index < end;
    index++
  ) {
    const candle = m5[index];
    const entryTime =
      candle.time + M5_MS;

    if (
      !sameDay(
        afterTime,
        entryTime
      ) ||
      !insideSession(
        entryTime
      )
    ) {
      break;
    }

    const volatility =
      atrM5[index];

    if (volatility === null) {
      continue;
    }

    const body =
      Math.abs(
        candle.close -
          candle.open
      );

    if (
      body <
      volatility *
        CONFIRMATION_BODY_ATR
    ) {
      continue;
    }

    const bullish =
      direction === "BUY" &&
      candle.close >
        referenceHigh &&
      candle.close >
        candle.open;

    const bearish =
      direction === "SELL" &&
      candle.close <
        referenceLow &&
      candle.close <
        candle.open;

    if (
      bullish ||
      bearish
    ) {
      return {
        strategy,
        candle,
        entryTime,
      };
    }
  }

  return null;
}

function detectSignals(
  m15: Candle[],
  m5: Candle[],
  atrM15: NumberSeries,
  atrM5: NumberSeries
): DetectionResult {
  const zones: Zone[] = [];
  const pendingBreakouts:
    PendingBreakout[] = [];

  const breakoutRetest:
    BaseSignal[] = [];

  const zoneRejection:
    BaseSignal[] = [];

  const usedBreakoutZones =
    new Set<number>();

  const usedRejectionZones =
    new Set<number>();

  const nextZoneId = {
    value: 1,
  };

  for (
    let index = 20;
    index <
    m15.length;
    index++
  ) {
    const candle =
      m15[index];

    const closeTime =
      candle.time + M15_MS;

    const volatility =
      atrM15[index];

    if (volatility === null) {
      continue;
    }

    const confirmedPivotIndex =
      index - PIVOT_RIGHT;

    if (
      confirmedPivotIndex >=
      PIVOT_LEFT
    ) {
      const pivot =
        m15[
          confirmedPivotIndex
        ];

      const pivotAtr =
        atrM15[
          confirmedPivotIndex
        ];

      if (pivotAtr !== null) {
        if (
          isConfirmedPivotHigh(
            m15,
            confirmedPivotIndex
          )
        ) {
          addPivotToZones(
            zones,
            "RESISTANCE",
            pivot.high,
            pivot.time,
            closeTime,
            pivotAtr,
            nextZoneId
          );
        }

        if (
          isConfirmedPivotLow(
            m15,
            confirmedPivotIndex
          )
        ) {
          addPivotToZones(
            zones,
            "SUPPORT",
            pivot.low,
            pivot.time,
            closeTime,
            pivotAtr,
            nextZoneId
          );
        }
      }
    }

    for (
      const zone of zones
    ) {
      if (
        !zone.active ||
        zone.reactions <
          MINIMUM_REACTIONS ||
        zone.createdTime >=
          closeTime
      ) {
        continue;
      }

      const zoneAge =
        Math.round(
          (candle.time -
            zone.lastPivotTime) /
            M15_MS
        );

      if (
        zoneAge >
        ZONE_EXPIRY_BARS
      ) {
        zone.active = false;
        continue;
      }

      const body =
        Math.abs(
          candle.close -
            candle.open
        );

      const bullishBreakout =
        zone.kind ===
          "RESISTANCE" &&
        candle.close >
          zone.high +
            volatility *
              BREAKOUT_BUFFER_ATR &&
        body >=
          volatility *
            BREAKOUT_BODY_ATR;

      const bearishBreakout =
        zone.kind === "SUPPORT" &&
        candle.close <
          zone.low -
            volatility *
              BREAKOUT_BUFFER_ATR &&
        body >=
          volatility *
            BREAKOUT_BODY_ATR;

      if (
        bullishBreakout ||
        bearishBreakout
      ) {
        if (
          !usedBreakoutZones.has(
            zone.id
          )
        ) {
          pendingBreakouts.push({
            zone: {
              ...zone,
            },
            direction:
              bullishBreakout
                ? "BUY"
                : "SELL",
            breakoutIndex:
              index,
            expiryIndex:
              index +
              RETEST_EXPIRY_BARS,
          });
        }

        zone.active = false;
        continue;
      }

      if (
        usedRejectionZones.has(
          zone.id
        )
      ) {
        continue;
      }

      const supportSweep =
        zone.kind === "SUPPORT" &&
        candle.low < zone.low &&
        candle.close >
          zone.center;

      const resistanceSweep =
        zone.kind ===
          "RESISTANCE" &&
        candle.high >
          zone.high &&
        candle.close <
          zone.center;

      if (
        !supportSweep &&
        !resistanceSweep
      ) {
        continue;
      }

      const direction:
        Direction =
          supportSweep
            ? "BUY"
            : "SELL";

      const m5Start =
        firstIndexAtOrAfter(
          m5,
          closeTime
        );

      if (
        m5Start <
        LOCAL_STRUCTURE_LOOKBACK
      ) {
        continue;
      }

      const localStructure =
        m5.slice(
          m5Start -
            LOCAL_STRUCTURE_LOOKBACK,
          m5Start
        );

      const localHigh =
        Math.max(
          ...localStructure.map(
            (item) =>
              item.high
          )
        );

      const localLow =
        Math.min(
          ...localStructure.map(
            (item) =>
              item.low
          )
        );

      const confirmation =
        findConfirmation(
          direction,
          localHigh,
          localLow,
          closeTime,
          m5,
          atrM5,
          "ZONE_REJECTION"
        );

      if (!confirmation) {
        continue;
      }

      const entry =
        direction === "BUY"
          ? confirmation.candle
              .close +
            SPREAD +
            SLIPPAGE
          : confirmation.candle
              .close -
            SLIPPAGE;

      const stopBase =
        direction === "BUY"
          ? Math.min(
              zone.low,
              candle.low
            )
          : Math.max(
              zone.high,
              candle.high
            );

      const stopLoss =
        direction === "BUY"
          ? stopBase -
            volatility * 0.1
          : stopBase +
            volatility * 0.1 +
            SPREAD;

      if (
        !validRisk(
          entry,
          stopLoss,
          volatility
        )
      ) {
        continue;
      }

      zoneRejection.push({
        strategy:
          "ZONE_REJECTION",
        direction,
        entryTime:
          confirmation.entryTime,
        entry,
        stopLoss,
      });

      usedRejectionZones.add(
        zone.id
      );
    }

    for (
      const pending
      of pendingBreakouts
    ) {
      if (
        usedBreakoutZones.has(
          pending.zone.id
        ) ||
        index <=
          pending.breakoutIndex ||
        index >
          pending.expiryIndex
      ) {
        continue;
      }

      const zone =
        pending.zone;

      const buyRetest =
        pending.direction ===
          "BUY" &&
        candle.low <=
          zone.high +
            volatility * 0.2 &&
        candle.low >=
          zone.low -
            volatility * 0.35 &&
        candle.close >
          zone.high;

      const sellRetest =
        pending.direction ===
          "SELL" &&
        candle.high >=
          zone.low -
            volatility * 0.2 &&
        candle.high <=
          zone.high +
            volatility * 0.35 &&
        candle.close <
          zone.low;

      if (
        !buyRetest &&
        !sellRetest
      ) {
        continue;
      }

      const confirmation =
        findConfirmation(
          pending.direction,
          candle.high,
          candle.low,
          closeTime,
          m5,
          atrM5,
          "BREAKOUT_RETEST"
        );

      if (!confirmation) {
        continue;
      }

      const entry =
        pending.direction ===
        "BUY"
          ? confirmation.candle
              .close +
            SPREAD +
            SLIPPAGE
          : confirmation.candle
              .close -
            SLIPPAGE;

      const stopBase =
        pending.direction ===
        "BUY"
          ? Math.min(
              candle.low,
              zone.low
            )
          : Math.max(
              candle.high,
              zone.high
            );

      const stopLoss =
        pending.direction ===
        "BUY"
          ? stopBase -
            volatility * 0.1
          : stopBase +
            volatility * 0.1 +
            SPREAD;

      if (
        !validRisk(
          entry,
          stopLoss,
          volatility
        )
      ) {
        continue;
      }

      breakoutRetest.push({
        strategy:
          "BREAKOUT_RETEST",
        direction:
          pending.direction,
        entryTime:
          confirmation.entryTime,
        entry,
        stopLoss,
      });

      usedBreakoutZones.add(
        zone.id
      );
    }
  }

  return {
    breakoutRetest,
    zoneRejection,
  };
}

function evaluateTarget(
  baseSignals: BaseSignal[],
  m5: Candle[],
  targetR: number
) {
  const signals:
    ResearchSignal[] =
      baseSignals.map(
        (signal) => ({
          strategy:
            `${signal.strategy}:${targetR}R`,
          direction:
            signal.direction,
          entryTime:
            signal.entryTime,
          entry:
            signal.entry,
          stopLoss:
            signal.stopLoss,
          targetR,
        })
      );

  return evaluateThreeWay(
    signals,
    m5
  );
}

function passesValidation(
  evaluation:
    ThreeWayEvaluation
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
    all.expectancyR >= 0.1 &&
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
    (final.profitFactor ?? 0) >=
      1.15 &&
    final.expectancyR > 0.05
  );
}

function summary(
  evaluation:
    ThreeWayEvaluation
) {
  return {
    splitTimes:
      evaluation.splitTimes,
    all: evaluation.all,
    training50:
      evaluation.training50,
    validation25:
      evaluation.validation25,
    final25:
      evaluation.final25,
    passed:
      passesValidation(
        evaluation
      ),
  };
}

export async function GET() {
  try {
    const data =
      await loadXauusdResearchData();

    if (
      data.m15.length < 3000 ||
      data.m5.length < 10000
    ) {
      return NextResponse.json(
        {
          error:
            "Historique FTMO insuffisant.",
        },
        { status: 400 }
      );
    }

    const atrM15 =
      atrSeries(
        data.m15,
        14
      );

    const atrM5 =
      atrSeries(
        data.m5,
        14
      );

    const detected =
      detectSignals(
        data.m15,
        data.m5,
        atrM15,
        atrM5
      );

    const combined = [
      ...detected
        .breakoutRetest,
      ...detected
        .zoneRejection,
    ].sort(
      (left, right) =>
        left.entryTime -
        right.entryTime
    );

    const evaluations:
      Record<
        string,
        unknown
      > = {};

    for (
      const target
      of TARGETS
    ) {
      const targetKey =
        `${String(
          target
        ).replace(
          ".",
          "_"
        )}R`;

      evaluations[
        `breakoutRetest_${targetKey}`
      ] = summary(
        evaluateTarget(
          detected
            .breakoutRetest,
          data.m5,
          target
        )
      );

      evaluations[
        `zoneRejection_${targetKey}`
      ] = summary(
        evaluateTarget(
          detected
            .zoneRejection,
          data.m5,
          target
        )
      );

      evaluations[
        `combined_${targetKey}`
      ] = summary(
        evaluateTarget(
          combined,
          data.m5,
          target
        )
      );
    }

    const approved =
      Object.entries(
        evaluations
      )
        .filter(
          ([, value]) =>
            (
              value as {
                passed: boolean;
              }
            ).passed
        )
        .map(
          ([name]) => name
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
        research:
          "SUPPORT_RESISTANCE_M15_V1",
        symbol: "XAUUSD",
        source: "FTMO-MT5",
        status:
          approved.length > 0
            ? "CANDIDATE_FOR_DEMO"
            : "DO_NOT_TRADE",
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
        frozenRules: {
          zones:
            "Pivots M15 confirmes 2/2, regroupes a 0.35 ATR",
          minimumReactions:
            MINIMUM_REACTIONS,
          minimumPivotDistanceBars:
            MINIMUM_PIVOT_DISTANCE,
          breakoutRetest:
            "Cloture M15 hors zone, premier retest, confirmation M5",
          zoneRejection:
            "Sweep M15 de la zone, retour interieur, CHOCH M5",
          targets:
            TARGETS,
          spread:
            SPREAD,
          slippage:
            SLIPPAGE,
          maximumTradesPerDay:
            2,
          ambiguousBar:
            "STOP_FIRST",
          finalQuarterUsedForSelection:
            false,
        },
        zones: {
          total:
            zonesCountEstimate(
              data.m15,
              atrM15
            ),
        },
        detectedSignals: {
          breakoutRetest:
            detected
              .breakoutRetest
              .length,
          zoneRejection:
            detected
              .zoneRejection
              .length,
          combined:
            combined.length,
          combinedPerMonth:
            Number(
              (
                combined.length /
                approximateMonths
              ).toFixed(2)
            ),
        },
        approved,
        evaluations,
        decision:
          approved.length > 0
            ? "Une variante peut passer a un court test FTMO Demo."
            : "Aucune variante ne doit etre ajoutee a Telegram.",
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
      "Erreur support resistance:",
      error
    );

    return NextResponse.json(
      {
        error:
          "Backtest support resistance impossible.",
      },
      { status: 500 }
    );
  }
}

function zonesCountEstimate(
  candles: Candle[],
  atrValues: NumberSeries
) {
  const zones: Zone[] = [];
  const nextZoneId = {
    value: 1,
  };

  for (
    let index = 20;
    index <
    candles.length;
    index++
  ) {
    const pivotIndex =
      index -
      PIVOT_RIGHT;

    if (
      pivotIndex <
      PIVOT_LEFT
    ) {
      continue;
    }

    const volatility =
      atrValues[
        pivotIndex
      ];

    if (
      volatility === null
    ) {
      continue;
    }

    const pivot =
      candles[
        pivotIndex
      ];

    const confirmationTime =
      candles[index].time +
      M15_MS;

    if (
      isConfirmedPivotHigh(
        candles,
        pivotIndex
      )
    ) {
      addPivotToZones(
        zones,
        "RESISTANCE",
        pivot.high,
        pivot.time,
        confirmationTime,
        volatility,
        nextZoneId
      );
    }

    if (
      isConfirmedPivotLow(
        candles,
        pivotIndex
      )
    ) {
      addPivotToZones(
        zones,
        "SUPPORT",
        pivot.low,
        pivot.time,
        confirmationTime,
        volatility,
        nextZoneId
      );
    }
  }

  return zones.filter(
    (zone) =>
      zone.reactions >=
      MINIMUM_REACTIONS
  ).length;
}
