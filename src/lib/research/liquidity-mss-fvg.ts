import {
  Candle,
  H1_MS,
  M5_MS,
  M15_MS,
  NumberSeries,
  ResearchMarketData,
  atrSeries,
  dayStart,
  firstIndexAtOrAfter,
  lastClosedIndex,
} from "./market-data";

import {
  Direction,
  ResearchSignal,
} from "./simulator";

type Bias =
  | "BULLISH"
  | "BEARISH"
  | "NEUTRAL";

type PoiKind =
  | "PREVIOUS_DAY_HIGH"
  | "PREVIOUS_DAY_LOW"
  | "SUPPLY"
  | "DEMAND"
  | "EQUAL_HIGH"
  | "EQUAL_LOW"
  | "SWING_HIGH"
  | "SWING_LOW";

type Pivot = {
  kind: "HIGH" | "LOW";
  index: number;
  price: number;
  confirmationTime: number;
};

type PivotSeries = {
  high: NumberSeries;
  low: NumberSeries;
  pivots: Pivot[];
};

type Poi = {
  id: string;
  kind: PoiKind;
  direction: Direction;
  low: number;
  high: number;
  level: number;
  createdTime: number;
  priority: number;
};

type AttemptRejection =
  | "NO_LOCKED_SWING"
  | "POI_INVALIDATED_BEFORE_MSS"
  | "NO_MSS"
  | "NO_FVG"
  | "POI_INVALIDATED_BEFORE_ENTRY"
  | "STOP_TOUCHED_BEFORE_ENTRY"
  | "TARGET_TOUCHED_BEFORE_ENTRY"
  | "NO_FVG_RETEST"
  | "INVALID_STOP_SIDE"
  | "INVALID_RISK"
  | "NO_TARGET"
  | "RR_TOO_LOW"
  | "QUALITY_TOO_LOW"
  | "AMBIGUOUS_ENTRY_CANDLE";

type AcceptanceType =
  | "NORMAL_RR_2_PLUS"
  | "EXCELLENT_RR_1_5_PLUS";

type QualityChecks = {
  cleanH1Structure: boolean;
  majorPoi: boolean;
  cleanSweep: boolean;
  clearMss: boolean;
  cleanFvg: boolean;
};

type AttemptResult = {
  signal: LiquiditySignal | null;
  rejection: AttemptRejection | null;
  reachedMss: boolean;
  reachedFvg: boolean;
  reachedRetest: boolean;
  acceptanceType: AcceptanceType | null;
};

type TargetSelection = {
  poi: Poi;
  price: number;
  targetR: number;
};

type TargetSearchResult = {
  target: TargetSelection | null;
  hadActiveCandidates: boolean;
};

export type LiquiditySignal =
  ResearchSignal & {
    poiId: string;
    poiKind: PoiKind;
    poiLevel: number;
    sweepTime: number;
    mssTime: number;
    fvgTime: number;
    fvgLow: number;
    fvgHigh: number;
    fvgEntryMode:
      | "PROXIMAL_EDGE"
      | "MIDPOINT_50";
    targetLiquidity: number;
    targetPoiId: string;
    acceptanceType: AcceptanceType;
    qualityChecks: QualityChecks;
  };

export type LiquidityDetectionResult = {
  signals: LiquiditySignal[];
  statistics: {
    pois: number;
    sweeps: number;
    mss: number;
    fvg: number;
    fvgRetests: number;
    entries: number;
    acceptedNormalRr: number;
    acceptedExcellentRr: number;
    noLockedSwing: number;
    invalidatedBeforeMss: number;
    noMss: number;
    noFvg: number;
    invalidatedBeforeEntry: number;
    stopTouchedBeforeEntry: number;
    targetTouchedBeforeEntry: number;
    noFvgRetest: number;
    invalidStopSide: number;
    invalidRisk: number;
    noTarget: number;
    rejectedRr: number;
    qualityRejected: number;
    ambiguousEntryCandle: number;
  };
};

const EQUAL_TOLERANCE = 0.4;

const H1_PIVOT_LEFT = 3;
const H1_PIVOT_RIGHT = 3;

const M5_PIVOT_LEFT = 2;
const M5_PIVOT_RIGHT = 2;

const IMPULSE_BODY_ATR = 0.9;

const BASE_MSS_BODY_ATR = 0.5;
const EXCELLENT_MSS_BODY_ATR = 0.75;

const CLEAN_FVG_MINIMUM_ATR = 0.1;
const SMALL_FVG_MAXIMUM_ATR = 0.25;

const MSS_MAXIMUM_BARS = 12;
const FVG_MAXIMUM_BARS = 4;
const FVG_RETEST_MAXIMUM_BARS = 12;

const POI_EXPIRY_DAYS = 60;

const NORMAL_MINIMUM_RR = 2;
const EXCELLENT_MINIMUM_RR = 1.5;

const SPREAD = 0.45;
const SLIPPAGE = 0.05;
const STOP_ATR_BUFFER = 0.1;

const DECISIVE_CLOSE_BUFFER_ATR = 0.1;
const ACCEPTANCE_BUFFER_ATR = 0.05;
const LINE_ACCEPTANCE_ATR = 0.15;
const ACCEPTANCE_CANDLES = 3;

const londonFormatter =
  new Intl.DateTimeFormat(
    "en-GB",
    {
      timeZone: "Europe/London",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }
  );

const newYorkFormatter =
  new Intl.DateTimeFormat(
    "en-US",
    {
      timeZone: "America/New_York",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }
  );

function localMinutes(
  timestamp: number,
  formatter: Intl.DateTimeFormat
) {
  const parts =
    formatter.formatToParts(
      new Date(timestamp)
    );

  const hour = Number(
    parts.find(
      (part) =>
        part.type === "hour"
    )?.value || 0
  );

  const minute = Number(
    parts.find(
      (part) =>
        part.type === "minute"
    )?.value || 0
  );

  return hour * 60 + minute;
}

function insideTradingSession(
  timestamp: number
) {
  const london =
    localMinutes(
      timestamp,
      londonFormatter
    );

  const newYork =
    localMinutes(
      timestamp,
      newYorkFormatter
    );

  return (
    (
      london >= 8 * 60 &&
      london <= 12 * 60
    ) ||
    (
      newYork >=
        8 * 60 + 30 &&
      newYork <= 12 * 60
    )
  );
}

function sameUtcDay(
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

function confirmedPivots(
  candles: Candle[],
  duration: number,
  left: number,
  right: number
): PivotSeries {
  const high: NumberSeries =
    new Array(
      candles.length
    ).fill(null);

  const low: NumberSeries =
    new Array(
      candles.length
    ).fill(null);

  const pivots: Pivot[] = [];

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
          candles[
            pivotIndex
          ].high
        ) {
          isHigh = false;
        }

        if (
          candles[index].low <=
          candles[
            pivotIndex
          ].low
        ) {
          isLow = false;
        }
      }

      const confirmationTime =
        candles[
          confirmedAt
        ].time +
        duration;

      if (isHigh) {
        latestHigh =
          candles[
            pivotIndex
          ].high;

        pivots.push({
          kind: "HIGH",
          index: pivotIndex,
          price: latestHigh,
          confirmationTime,
        });
      }

      if (isLow) {
        latestLow =
          candles[
            pivotIndex
          ].low;

        pivots.push({
          kind: "LOW",
          index: pivotIndex,
          price: latestLow,
          confirmationTime,
        });
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
    pivots,
  };
}

function buildStructureBias(
  h1: Candle[],
  pivots: PivotSeries
) {
  const bias: Bias[] =
    new Array(
      h1.length
    ).fill("NEUTRAL");

  let current: Bias =
    "NEUTRAL";

  for (
    let index = 1;
    index < h1.length;
    index++
  ) {
    const previousHigh =
      pivots.high[index - 1];

    const previousLow =
      pivots.low[index - 1];

    if (
      previousHigh !== null &&
      h1[index].close >
        previousHigh
    ) {
      current = "BULLISH";
    } else if (
      previousLow !== null &&
      h1[index].close <
        previousLow
    ) {
      current = "BEARISH";
    }

    bias[index] = current;
  }

  return bias;
}

function biasAt(
  timestamp: number,
  h1: Candle[],
  structureBias: Bias[]
) {
  const index =
    lastClosedIndex(
      h1,
      H1_MS,
      timestamp
    );

  return index >= 0
    ? structureBias[index]
    : "NEUTRAL";
}

function cleanH1StructureAt(
  timestamp: number,
  expected: Bias,
  h1: Candle[],
  structureBias: Bias[]
) {
  const index =
    lastClosedIndex(
      h1,
      H1_MS,
      timestamp
    );

  if (
    index < 3 ||
    expected === "NEUTRAL"
  ) {
    return false;
  }

  return (
    structureBias[index] ===
      expected &&
    structureBias[
      index - 1
    ] === expected &&
    structureBias[
      index - 2
    ] === expected &&
    structureBias[
      index - 3
    ] === expected
  );
}

function poiPriority(
  kind: PoiKind
) {
  if (
    kind ===
      "PREVIOUS_DAY_HIGH" ||
    kind ===
      "PREVIOUS_DAY_LOW"
  ) {
    return 1;
  }

  if (
    kind === "SUPPLY" ||
    kind === "DEMAND"
  ) {
    return 2;
  }

  if (
    kind === "EQUAL_HIGH" ||
    kind === "EQUAL_LOW"
  ) {
    return 3;
  }

  return 4;
}

function isMajorPoi(
  poi: Poi
) {
  return poi.priority <= 3;
}

function buildDailyPois(
  h1: Candle[]
) {
  const map =
    new Map<
      number,
      Candle[]
    >();

  for (
    const candle
    of h1
  ) {
    const day =
      dayStart(
        candle.time
      );

    const current =
      map.get(day) || [];

    current.push(candle);
    map.set(day, current);
  }

  const days = [
    ...map.keys(),
  ].sort(
    (left, right) =>
      left - right
  );

  const pois: Poi[] = [];

  for (
    let index = 1;
    index < days.length;
    index++
  ) {
    const previousDay =
      days[index - 1];

    const currentDay =
      days[index];

    const candles =
      map.get(
        previousDay
      ) || [];

    if (
      candles.length === 0
    ) {
      continue;
    }

    const high = Math.max(
      ...candles.map(
        (candle) =>
          candle.high
      )
    );

    const low = Math.min(
      ...candles.map(
        (candle) =>
          candle.low
      )
    );

    pois.push({
      id:
        `PDH:${previousDay}`,
      kind:
        "PREVIOUS_DAY_HIGH",
      direction: "SELL",
      low: high,
      high,
      level: high,
      createdTime:
        currentDay,
      priority: 1,
    });

    pois.push({
      id:
        `PDL:${previousDay}`,
      kind:
        "PREVIOUS_DAY_LOW",
      direction: "BUY",
      low,
      high: low,
      level: low,
      createdTime:
        currentDay,
      priority: 1,
    });
  }

  return pois;
}

function buildSwingPois(
  pivots: PivotSeries
) {
  return pivots.pivots.map(
    (pivot): Poi => {
      const kind: PoiKind =
        pivot.kind ===
          "HIGH"
          ? "SWING_HIGH"
          : "SWING_LOW";

      return {
        id:
          `${kind}:${pivot.index}`,
        kind,
        direction:
          pivot.kind ===
          "HIGH"
            ? "SELL"
            : "BUY",
        low: pivot.price,
        high: pivot.price,
        level: pivot.price,
        createdTime:
          pivot.confirmationTime,
        priority:
          poiPriority(kind),
      };
    }
  );
}

function buildEqualPois(
  pivots: PivotSeries
) {
  const output: Poi[] =
    [];

  for (
    const kind
    of [
      "HIGH",
      "LOW",
    ] as const
  ) {
    const items =
      pivots.pivots.filter(
        (pivot) =>
          pivot.kind === kind
      );

    for (
      let index = 1;
      index < items.length;
      index++
    ) {
      const current =
        items[index];

      const previous =
        items
          .slice(
            Math.max(
              0,
              index - 8
            ),
            index
          )
          .filter(
            (candidate) =>
              current.index -
                candidate.index >=
              3
          )
          .sort(
            (left, right) =>
              Math.abs(
                left.price -
                  current.price
              ) -
              Math.abs(
                right.price -
                  current.price
              )
          )[0];

      if (
        !previous ||
        Math.abs(
          previous.price -
            current.price
        ) >
          EQUAL_TOLERANCE
      ) {
        continue;
      }

      const level =
        (
          previous.price +
          current.price
        ) / 2;

      const poiKind:
        PoiKind =
          kind === "HIGH"
            ? "EQUAL_HIGH"
            : "EQUAL_LOW";

      output.push({
        id:
          `${poiKind}:${previous.index}:${current.index}`,
        kind: poiKind,
        direction:
          kind === "HIGH"
            ? "SELL"
            : "BUY",
        low: level,
        high: level,
        level,
        createdTime:
          current
            .confirmationTime,
        priority: 3,
      });
    }
  }

  return output;
}

function findOppositeCandle(
  candles: Candle[],
  impulseIndex: number,
  direction: Direction
) {
  for (
    let index =
      impulseIndex - 1;
    index >=
      Math.max(
        0,
        impulseIndex - 6
      );
    index--
  ) {
    const candle =
      candles[index];

    const opposite =
      direction === "BUY"
        ? candle.close <
          candle.open
        : candle.close >
          candle.open;

    if (opposite) {
      return candle;
    }
  }

  return null;
}

function buildSupplyDemandPois(
  h1: Candle[],
  pivots: PivotSeries,
  atrH1: NumberSeries
) {
  const output: Poi[] =
    [];

  const usedBos =
    new Set<string>();

  for (
    let index = 20;
    index < h1.length;
    index++
  ) {
    const volatility =
      atrH1[index];

    const previousHigh =
      pivots.high[
        index - 1
      ];

    const previousLow =
      pivots.low[
        index - 1
      ];

    if (
      volatility === null
    ) {
      continue;
    }

    const candle =
      h1[index];

    const body = Math.abs(
      candle.close -
        candle.open
    );

    if (
      body <
      volatility *
        IMPULSE_BODY_ATR
    ) {
      continue;
    }

    const bullishBos =
      previousHigh !== null &&
      candle.close >
        previousHigh &&
      candle.close >
        candle.open;

    const bearishBos =
      previousLow !== null &&
      candle.close <
        previousLow &&
      candle.close <
        candle.open;

    if (
      !bullishBos &&
      !bearishBos
    ) {
      continue;
    }

    const direction:
      Direction =
        bullishBos
          ? "BUY"
          : "SELL";

    const bosLevel =
      bullishBos
        ? previousHigh
        : previousLow;

    const key =
      `${direction}:${bosLevel}`;

    if (
      usedBos.has(key)
    ) {
      continue;
    }

    const source =
      findOppositeCandle(
        h1,
        index,
        direction
      );

    if (!source) {
      continue;
    }

    usedBos.add(key);

    const kind: PoiKind =
      direction === "BUY"
        ? "DEMAND"
        : "SUPPLY";

    const low =
      direction === "BUY"
        ? source.low
        : source.open;

    const high =
      direction === "BUY"
        ? source.open
        : source.high;

    if (
      high <= low ||
      high - low >
        volatility * 1.8
    ) {
      continue;
    }

    output.push({
      id:
        `${kind}:${source.time}`,
      kind,
      direction,
      low,
      high,
      level:
        direction === "BUY"
          ? low
          : high,
      createdTime:
        candle.time +
        H1_MS,
      priority: 2,
    });
  }

  return output;
}

function buildPois(
  data: ResearchMarketData,
  pivots: PivotSeries,
  atrH1: NumberSeries
) {
  const all = [
    ...buildDailyPois(
      data.h1
    ),
    ...buildSupplyDemandPois(
      data.h1,
      pivots,
      atrH1
    ),
    ...buildEqualPois(
      pivots
    ),
    ...buildSwingPois(
      pivots
    ),
  ];

  const unique =
    new Map<
      string,
      Poi
    >();

  for (
    const poi of all
  ) {
    unique.set(
      poi.id,
      poi
    );
  }

  return [
    ...unique.values(),
  ].sort(
    (left, right) =>
      left.createdTime -
      right.createdTime
  );
}

function isZonePoi(
  poi: Poi
) {
  return (
    poi.kind ===
      "SUPPLY" ||
    poi.kind ===
      "DEMAND"
  );
}

function invalidatedByClose(
  poi: Poi,
  candle: Candle,
  volatility: number
) {
  return (
    poi.direction === "BUY"
      ? candle.close <
        poi.low -
          volatility *
            DECISIVE_CLOSE_BUFFER_ATR
      : candle.close >
        poi.high +
          volatility *
            DECISIVE_CLOSE_BUFFER_ATR
  );
}

function acceptedInsidePoi(
  poi: Poi,
  candle: Candle,
  volatility: number
) {
  if (isZonePoi(poi)) {
    return (
      candle.close >=
        poi.low -
          volatility *
            ACCEPTANCE_BUFFER_ATR &&
      candle.close <=
        poi.high +
          volatility *
            ACCEPTANCE_BUFFER_ATR
    );
  }

  return (
    Math.abs(
      candle.close -
        poi.level
    ) <=
    volatility *
      LINE_ACCEPTANCE_ATR
  );
}

function poiInvalidatedAtIndex(
  poi: Poi,
  candles: Candle[],
  atrValues: NumberSeries,
  index: number
) {
  const volatility =
    atrValues[index];

  if (
    volatility === null
  ) {
    return false;
  }

  if (
    invalidatedByClose(
      poi,
      candles[index],
      volatility
    )
  ) {
    return true;
  }

  let consecutive = 0;

  for (
    let itemIndex = index;
    itemIndex >=
      Math.max(
        0,
        index -
          ACCEPTANCE_CANDLES +
          1
      );
    itemIndex--
  ) {
    const itemAtr =
      atrValues[
        itemIndex
      ];

    if (
      itemAtr !== null &&
      acceptedInsidePoi(
        poi,
        candles[
          itemIndex
        ],
        itemAtr
      )
    ) {
      consecutive++;
    } else {
      break;
    }
  }

  return (
    consecutive >=
    ACCEPTANCE_CANDLES
  );
}

function poiInvalidatedBetween(
  poi: Poi,
  data:
    ResearchMarketData,
  atrM15: NumberSeries,
  fromM15Index: number,
  timestamp: number
) {
  const endIndex =
    lastClosedIndex(
      data.m15,
      M15_MS,
      timestamp
    );

  for (
    let index =
      Math.max(
        0,
        fromM15Index + 1
      );
    index <= endIndex;
    index++
  ) {
    if (
      poiInvalidatedAtIndex(
        poi,
        data.m15,
        atrM15,
        index
      )
    ) {
      return true;
    }
  }

  return false;
}

function isSweep(
  poi: Poi,
  candle: Candle,
  volatility: number
) {
  if (
    poi.direction === "BUY"
  ) {
    if (isZonePoi(poi)) {
      return (
        candle.low <
          poi.low &&
        candle.close >=
          poi.low &&
        candle.close <=
          poi.high +
          volatility * 0.1
      );
    }

    return (
      candle.low <
        poi.level &&
      candle.close >
        poi.level
    );
  }

  if (isZonePoi(poi)) {
    return (
      candle.high >
        poi.high &&
      candle.close <=
        poi.high &&
      candle.close >=
        poi.low -
          volatility * 0.1
    );
  }

  return (
    candle.high >
      poi.level &&
    candle.close <
      poi.level
  );
}

function cleanSweep(
  poi: Poi,
  candle: Candle,
  volatility: number
) {
  const boundary =
    poi.direction === "BUY"
      ? poi.low
      : poi.high;

  const penetration =
    poi.direction === "BUY"
      ? boundary -
        candle.low
      : candle.high -
        boundary;

  const returnedInside =
    poi.direction === "BUY"
      ? candle.close >=
        boundary +
          volatility * 0.05
      : candle.close <=
        boundary -
          volatility * 0.05;

  return (
    penetration >=
      volatility * 0.05 &&
    penetration <=
      volatility * 0.8 &&
    returnedInside
  );
}

function targetPrice(
  poi: Poi
) {
  if (
    poi.kind === "SUPPLY"
  ) {
    return poi.low;
  }

  if (
    poi.kind === "DEMAND"
  ) {
    return poi.high;
  }

  return poi.level;
}

function findQualifiedTarget(
  direction: Direction,
  entry: number,
  risk: number,
  entryTime: number,
  pois: Poi[],
  unavailablePoiIds:
    ReadonlySet<string>,
  data:
    ResearchMarketData,
  atrM15: NumberSeries,
  sweepM15Index: number
): TargetSearchResult {
  const candidates =
    pois
      .filter(
        (poi) => {
          if (
            poi.createdTime >
              entryTime ||
            poi.direction ===
              direction ||
            unavailablePoiIds.has(
              poi.id
            )
          ) {
            return false;
          }

          if (
            entryTime -
              poi.createdTime >
            POI_EXPIRY_DAYS *
              24 *
              H1_MS
          ) {
            return false;
          }

          const startIndex =
            Math.max(
              sweepM15Index,
              firstIndexAtOrAfter(
                data.m15,
                poi.createdTime
              ) - 1
            );

          return (
            !poiInvalidatedBetween(
              poi,
              data,
              atrM15,
              startIndex,
              entryTime
            )
          );
        }
      )
      .map(
        (poi) => {
          const price =
            targetPrice(poi);

          return {
            poi,
            price,
            targetR:
              Math.abs(
                price - entry
              ) / risk,
          };
        }
      )
      .filter(
        ({ price }) =>
          direction === "BUY"
            ? price > entry
            : price < entry
      )
      .sort(
        (left, right) =>
          direction === "BUY"
            ? left.price -
              right.price
            : right.price -
              left.price
      );

  if (
    candidates.length === 0
  ) {
    return {
      target: null,
      hadActiveCandidates:
        false,
    };
  }

  const target =
    candidates.find(
      (candidate) =>
        candidate.targetR >=
        EXCELLENT_MINIMUM_RR
    ) || null;

  return {
    target,
    hadActiveCandidates:
      true,
  };
}

function updateExtreme(
  direction: Direction,
  current: number,
  candle: Candle
) {
  return (
    direction === "BUY"
      ? Math.min(
          current,
          candle.low
        )
      : Math.max(
          current,
          candle.high
        )
  );
}

function stopWasTouched(
  direction: Direction,
  candle: Candle,
  stopLoss: number
) {
  return (
    direction === "BUY"
      ? candle.low <=
        stopLoss
      : candle.high +
          SPREAD >=
        stopLoss
  );
}

function targetWasTouched(
  direction: Direction,
  candle: Candle,
  target: number
) {
  return (
    direction === "BUY"
      ? candle.high >=
        target
      : candle.low +
          SPREAD <=
        target
  );
}

function rejected(
  rejection:
    AttemptRejection,
  reachedMss = false,
  reachedFvg = false,
  reachedRetest = false
): AttemptResult {
  return {
    signal: null,
    rejection,
    reachedMss,
    reachedFvg,
    reachedRetest,
    acceptanceType: null,
  };
}

function createSignalAfterSweep(
  poi: Poi,
  sweep: Candle,
  sweepM15Index: number,
  data:
    ResearchMarketData,
  h1Bias:
    Bias[],
  m5Pivots:
    PivotSeries,
  atrM15:
    NumberSeries,
  atrM5:
    NumberSeries,
  atrM15Value: number,
  pois: Poi[],
  unavailablePoiIds:
    ReadonlySet<string>
): AttemptResult {
  const direction =
    poi.direction;

  const expectedBias:
    Bias =
      direction === "BUY"
        ? "BULLISH"
        : "BEARISH";

  const sweepClose =
    sweep.time +
    M15_MS;

  const sweepStart =
    firstIndexAtOrAfter(
      data.m5,
      sweep.time
    );

  const mssStart =
    firstIndexAtOrAfter(
      data.m5,
      sweepClose
    );

  if (
    mssStart <= 0 ||
    sweepStart >=
      data.m5.length
  ) {
    return rejected(
      "NO_LOCKED_SWING"
    );
  }

  const lockedSwing =
    direction === "BUY"
      ? m5Pivots.high[
          mssStart - 1
        ]
      : m5Pivots.low[
          mssStart - 1
        ];

  if (
    lockedSwing === null ||
    (
      direction === "BUY" &&
      lockedSwing <=
        sweep.close
    ) ||
    (
      direction === "SELL" &&
      lockedSwing >=
        sweep.close
    )
  ) {
    return rejected(
      "NO_LOCKED_SWING"
    );
  }

  let sweepExtreme =
    direction === "BUY"
      ? Number.POSITIVE_INFINITY
      : Number.NEGATIVE_INFINITY;

  for (
    let index =
      sweepStart;
    index < mssStart;
    index++
  ) {
    sweepExtreme =
      updateExtreme(
        direction,
        sweepExtreme,
        data.m5[index]
      );
  }

  const mssEnd =
    Math.min(
      data.m5.length,
      mssStart +
        MSS_MAXIMUM_BARS
    );

  let mssIndex = -1;
  let clearMss = false;

  for (
    let index = mssStart;
    index < mssEnd;
    index++
  ) {
    const candle =
      data.m5[index];

    const closeTime =
      candle.time +
      M5_MS;

    sweepExtreme =
      updateExtreme(
        direction,
        sweepExtreme,
        candle
      );

    if (
      poiInvalidatedBetween(
        poi,
        data,
        atrM15,
        sweepM15Index,
        closeTime
      )
    ) {
      return rejected(
        "POI_INVALIDATED_BEFORE_MSS"
      );
    }

    const volatility =
      atrM5[index];

    if (
      volatility === null
    ) {
      continue;
    }

    const body =
      Math.abs(
        candle.close -
          candle.open
      );

    const bullishMss =
      direction === "BUY" &&
      candle.close >
        lockedSwing &&
      candle.close >
        candle.open &&
      body >=
        volatility *
          BASE_MSS_BODY_ATR;

    const bearishMss =
      direction === "SELL" &&
      candle.close <
        lockedSwing &&
      candle.close <
        candle.open &&
      body >=
        volatility *
          BASE_MSS_BODY_ATR;

    if (
      bullishMss ||
      bearishMss
    ) {
      mssIndex = index;

      clearMss =
        body >=
        volatility *
          EXCELLENT_MSS_BODY_ATR;

      break;
    }
  }

  if (mssIndex < 0) {
    return rejected(
      "NO_MSS"
    );
  }

  const mssClose =
    data.m5[
      mssIndex
    ].time +
    M5_MS;

  const mssAtr =
    atrM5[mssIndex] ??
    atrM15Value;

  const frozenStop =
    direction === "BUY"
      ? sweepExtreme -
        mssAtr *
          STOP_ATR_BUFFER
      : sweepExtreme +
        mssAtr *
          STOP_ATR_BUFFER +
        SPREAD;

  const fvgEnd =
    Math.min(
      data.m5.length,
      mssIndex +
        FVG_MAXIMUM_BARS
    );

  let fvgIndex = -1;
  let fvgLow = 0;
  let fvgHigh = 0;

  for (
    let index =
      Math.max(
        2,
        mssIndex
      );
    index < fvgEnd;
    index++
  ) {
    const first =
      data.m5[index - 2];

    const third =
      data.m5[index];

    const bullishFvg =
      direction === "BUY" &&
      third.low >
        first.high;

    const bearishFvg =
      direction === "SELL" &&
      third.high <
        first.low;

    if (bullishFvg) {
      fvgIndex = index;
      fvgLow =
        first.high;
      fvgHigh =
        third.low;
      break;
    }

    if (bearishFvg) {
      fvgIndex = index;
      fvgLow =
        third.high;
      fvgHigh =
        first.low;
      break;
    }
  }

  if (fvgIndex < 0) {
    return rejected(
      "NO_FVG",
      true
    );
  }

  const fvgAtr =
    atrM5[fvgIndex] ??
    mssAtr;

  const fvgWidth =
    fvgHigh -
    fvgLow;

  const cleanFvg =
    fvgWidth >=
    fvgAtr *
      CLEAN_FVG_MINIMUM_ATR;

  const smallFvg =
    fvgWidth <=
    fvgAtr *
      SMALL_FVG_MAXIMUM_ATR;

  const rawEntry =
    smallFvg
      ? direction === "BUY"
        ? fvgHigh
        : fvgLow
      : (
          fvgLow +
          fvgHigh
        ) / 2;

  const fvgEntryMode:
    "PROXIMAL_EDGE" |
    "MIDPOINT_50" =
      smallFvg
        ? "PROXIMAL_EDGE"
        : "MIDPOINT_50";

  const provisionalEntry =
    direction === "BUY"
      ? rawEntry +
        SPREAD +
        SLIPPAGE
      : rawEntry -
        SLIPPAGE;

  if (
    direction === "BUY"
      ? frozenStop >=
        provisionalEntry
      : frozenStop <=
        provisionalEntry
  ) {
    return rejected(
      "INVALID_STOP_SIDE",
      true,
      true
    );
  }

  const initialRisk =
    Math.abs(
      provisionalEntry -
        frozenStop
    );

  if (
    initialRisk <=
      SPREAD * 1.5 ||
    initialRisk >
      atrM15Value * 3
  ) {
    return rejected(
      "INVALID_RISK",
      true,
      true
    );
  }

  const targetSearch =
    findQualifiedTarget(
      direction,
      provisionalEntry,
      initialRisk,
      data.m5[
        fvgIndex
      ].time +
        M5_MS,
      pois,
      unavailablePoiIds,
      data,
      atrM15,
      sweepM15Index
    );

  if (
    !targetSearch
      .hadActiveCandidates
  ) {
    return rejected(
      "NO_TARGET",
      true,
      true
    );
  }

  if (
    targetSearch.target ===
    null
  ) {
    return rejected(
      "RR_TOO_LOW",
      true,
      true
    );
  }

  const target =
    targetSearch.target;

  const qualityChecks:
    QualityChecks = {
      cleanH1Structure:
        cleanH1StructureAt(
          sweepClose,
          expectedBias,
          data.h1,
          h1Bias
        ),
      majorPoi:
        isMajorPoi(poi),
      cleanSweep:
        cleanSweep(
          poi,
          sweep,
          atrM15Value
        ),
      clearMss,
      cleanFvg,
    };

  const excellent =
    Object.values(
      qualityChecks
    ).every(Boolean);

  let acceptanceType:
    AcceptanceType;

  if (
    target.targetR >=
    NORMAL_MINIMUM_RR
  ) {
    acceptanceType =
      "NORMAL_RR_2_PLUS";
  } else if (
    target.targetR >=
      EXCELLENT_MINIMUM_RR &&
    excellent
  ) {
    acceptanceType =
      "EXCELLENT_RR_1_5_PLUS";
  } else {
    return rejected(
      "QUALITY_TOO_LOW",
      true,
      true
    );
  }

  const retestStart =
    fvgIndex + 1;

  const retestEnd =
    Math.min(
      data.m5.length,
      retestStart +
        FVG_RETEST_MAXIMUM_BARS
    );

  for (
    let index =
      retestStart;
    index < retestEnd;
    index++
  ) {
    const candle =
      data.m5[index];

    const candleClose =
      candle.time +
      M5_MS;

    if (
      !sameUtcDay(
        mssClose,
        candleClose
      ) ||
      !insideTradingSession(
        candle.time
      )
    ) {
      break;
    }

    if (
      poiInvalidatedBetween(
        poi,
        data,
        atrM15,
        sweepM15Index,
        candleClose
      )
    ) {
      return rejected(
        "POI_INVALIDATED_BEFORE_ENTRY",
        true,
        true
      );
    }

    const touched =
      direction === "BUY"
        ? candle.low <=
          rawEntry
        : candle.high >=
          rawEntry;

    const stopTouched =
      stopWasTouched(
        direction,
        candle,
        frozenStop
      );

    const targetTouched =
      targetWasTouched(
        direction,
        candle,
        target.price
      );

    if (!touched) {
      if (stopTouched) {
        return rejected(
          "STOP_TOUCHED_BEFORE_ENTRY",
          true,
          true
        );
      }

      if (targetTouched) {
        return rejected(
          "TARGET_TOUCHED_BEFORE_ENTRY",
          true,
          true
        );
      }

      continue;
    }

    if (
      stopTouched ||
      targetTouched
    ) {
      return rejected(
        "AMBIGUOUS_ENTRY_CANDLE",
        true,
        true,
        true
      );
    }

    const entry =
      provisionalEntry;

    const risk =
      Math.abs(
        entry -
          frozenStop
      );

    if (
      direction === "BUY"
        ? frozenStop >= entry
        : frozenStop <= entry
    ) {
      return rejected(
        "INVALID_STOP_SIDE",
        true,
        true,
        true
      );
    }

    if (
      risk <=
        SPREAD * 1.5 ||
      risk >
        atrM15Value * 3
    ) {
      return rejected(
        "INVALID_RISK",
        true,
        true,
        true
      );
    }

    const finalTargetR =
      Math.abs(
        target.price -
          entry
      ) / risk;

    if (
      finalTargetR <
      EXCELLENT_MINIMUM_RR
    ) {
      return rejected(
        "RR_TOO_LOW",
        true,
        true,
        true
      );
    }

    if (
      finalTargetR <
        NORMAL_MINIMUM_RR &&
      !excellent
    ) {
      return rejected(
        "QUALITY_TOO_LOW",
        true,
        true,
        true
      );
    }

    return {
      signal: {
        strategy:
          `LIQUIDITY_MSS_FVG_V4:${poi.kind}`,
        direction,
        entryTime:
          candle.time,
        entry,
        stopLoss:
          frozenStop,
        targetR:
          finalTargetR,
        poiId:
          poi.id,
        poiKind:
          poi.kind,
        poiLevel:
          poi.level,
        sweepTime:
          sweep.time,
        mssTime:
          data.m5[
            mssIndex
          ].time,
        fvgTime:
          data.m5[
            fvgIndex
          ].time,
        fvgLow,
        fvgHigh,
        fvgEntryMode,
        targetLiquidity:
          target.price,
        targetPoiId:
          target.poi.id,
        acceptanceType,
        qualityChecks,
      },
      rejection: null,
      reachedMss: true,
      reachedFvg: true,
      reachedRetest: true,
      acceptanceType,
    };
  }

  return rejected(
    "NO_FVG_RETEST",
    true,
    true
  );
}

function incrementRejection(
  statistics:
    LiquidityDetectionResult[
      "statistics"
    ],
  rejection:
    AttemptRejection | null
) {
  if (!rejection) {
    return;
  }

  const mapping:
    Record<
      AttemptRejection,
      keyof LiquidityDetectionResult[
        "statistics"
      ]
    > = {
      NO_LOCKED_SWING:
        "noLockedSwing",
      POI_INVALIDATED_BEFORE_MSS:
        "invalidatedBeforeMss",
      NO_MSS:
        "noMss",
      NO_FVG:
        "noFvg",
      POI_INVALIDATED_BEFORE_ENTRY:
        "invalidatedBeforeEntry",
      STOP_TOUCHED_BEFORE_ENTRY:
        "stopTouchedBeforeEntry",
      TARGET_TOUCHED_BEFORE_ENTRY:
        "targetTouchedBeforeEntry",
      NO_FVG_RETEST:
        "noFvgRetest",
      INVALID_STOP_SIDE:
        "invalidStopSide",
      INVALID_RISK:
        "invalidRisk",
      NO_TARGET:
        "noTarget",
      RR_TOO_LOW:
        "rejectedRr",
      QUALITY_TOO_LOW:
        "qualityRejected",
      AMBIGUOUS_ENTRY_CANDLE:
        "ambiguousEntryCandle",
    };

  const key =
    mapping[rejection];

  statistics[key]++;
}

export function createLiquidityMssFvgSignals(
  data: ResearchMarketData
): LiquidityDetectionResult {
  const h1Pivots =
    confirmedPivots(
      data.h1,
      H1_MS,
      H1_PIVOT_LEFT,
      H1_PIVOT_RIGHT
    );

  const m5Pivots =
    confirmedPivots(
      data.m5,
      M5_MS,
      M5_PIVOT_LEFT,
      M5_PIVOT_RIGHT
    );

  const atrH1 =
    atrSeries(
      data.h1,
      14
    );

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

  const structureBias =
    buildStructureBias(
      data.h1,
      h1Pivots
    );

  const pois =
    buildPois(
      data,
      h1Pivots,
      atrH1
    );

  const signals:
    LiquiditySignal[] = [];

  const usedPois =
    new Set<string>();

  const invalidPois =
    new Set<string>();

  const sweptPois =
    new Set<string>();

  const statistics:
    LiquidityDetectionResult[
      "statistics"
    ] = {
      pois: pois.length,
      sweeps: 0,
      mss: 0,
      fvg: 0,
      fvgRetests: 0,
      entries: 0,
      acceptedNormalRr: 0,
      acceptedExcellentRr: 0,
      noLockedSwing: 0,
      invalidatedBeforeMss: 0,
      noMss: 0,
      noFvg: 0,
      invalidatedBeforeEntry: 0,
      stopTouchedBeforeEntry: 0,
      targetTouchedBeforeEntry: 0,
      noFvgRetest: 0,
      invalidStopSide: 0,
      invalidRisk: 0,
      noTarget: 0,
      rejectedRr: 0,
      qualityRejected: 0,
      ambiguousEntryCandle: 0,
    };

  for (
    let index = 20;
    index <
      data.m15.length;
    index++
  ) {
    const candle =
      data.m15[index];

    const closeTime =
      candle.time +
      M15_MS;

    const volatility =
      atrM15[index];

    if (
      volatility === null
    ) {
      continue;
    }

    for (
      const poi of pois
    ) {
      if (
        poi.createdTime >=
          closeTime ||
        usedPois.has(
          poi.id
        ) ||
        invalidPois.has(
          poi.id
        ) ||
        sweptPois.has(
          poi.id
        )
      ) {
        continue;
      }

      const age =
        closeTime -
        poi.createdTime;

      if (
        age >
        POI_EXPIRY_DAYS *
          24 *
          H1_MS
      ) {
        invalidPois.add(
          poi.id
        );

        continue;
      }

      if (
        poiInvalidatedAtIndex(
          poi,
          data.m15,
          atrM15,
          index
        )
      ) {
        invalidPois.add(
          poi.id
        );
      }
    }

    if (
      !insideTradingSession(
        closeTime
      )
    ) {
      continue;
    }

    const currentBias =
      biasAt(
        closeTime,
        data.h1,
        structureBias
      );

    if (
      currentBias ===
      "NEUTRAL"
    ) {
      continue;
    }

    const direction:
      Direction =
        currentBias ===
        "BULLISH"
          ? "BUY"
          : "SELL";

    const candidates =
      pois
        .filter(
          (poi) =>
            poi.createdTime <
              closeTime &&
            poi.direction ===
              direction &&
            !usedPois.has(
              poi.id
            ) &&
            !invalidPois.has(
              poi.id
            ) &&
            !sweptPois.has(
              poi.id
            ) &&
            isSweep(
              poi,
              candle,
              volatility
            )
        )
        .sort(
          (left, right) =>
            left.priority -
              right.priority ||
            Math.abs(
              left.level -
                candle.close
            ) -
              Math.abs(
                right.level -
                  candle.close
              )
        );

    const poi =
      candidates[0];

    if (!poi) {
      continue;
    }

    statistics.sweeps++;

    const unavailablePoiIds =
      new Set<string>([
        ...invalidPois,
        ...usedPois,
        ...sweptPois,
      ]);

    unavailablePoiIds.add(
      poi.id
    );

    const attempt =
      createSignalAfterSweep(
        poi,
        candle,
        index,
        data,
        structureBias,
        m5Pivots,
        atrM15,
        atrM5,
        volatility,
        pois,
        unavailablePoiIds
      );

    sweptPois.add(
      poi.id
    );

    if (
      attempt.reachedMss
    ) {
      statistics.mss++;
    }

    if (
      attempt.reachedFvg
    ) {
      statistics.fvg++;
    }

    if (
      attempt.reachedRetest
    ) {
      statistics
        .fvgRetests++;
    }

    incrementRejection(
      statistics,
      attempt.rejection
    );

    if (
      !attempt.signal
    ) {
      continue;
    }

    statistics.entries++;

    if (
      attempt.acceptanceType ===
      "NORMAL_RR_2_PLUS"
    ) {
      statistics
        .acceptedNormalRr++;
    }

    if (
      attempt.acceptanceType ===
      "EXCELLENT_RR_1_5_PLUS"
    ) {
      statistics
        .acceptedExcellentRr++;
    }

    signals.push(
      attempt.signal
    );

    usedPois.add(
      poi.id
    );
  }

  return {
    signals,
    statistics,
  };
}
