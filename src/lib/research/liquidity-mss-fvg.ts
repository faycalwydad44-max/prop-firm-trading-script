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

export type LiquiditySignal = ResearchSignal & {
  poiId: string;
  poiKind: PoiKind;
  poiLevel: number;
  sweepTime: number;
  mssTime: number;
  fvgTime: number;
  fvgLow: number;
  fvgHigh: number;
  targetLiquidity: number;
};

export type LiquidityDetectionResult = {
  signals: LiquiditySignal[];
  statistics: {
    pois: number;
    sweeps: number;
    mss: number;
    fvg: number;
    entries: number;
    rejectedNoTarget: number;
  };
};

const EQUAL_TOLERANCE = 0.4;

const H1_PIVOT_LEFT = 3;
const H1_PIVOT_RIGHT = 3;

const M5_PIVOT_LEFT = 2;
const M5_PIVOT_RIGHT = 2;

const IMPULSE_BODY_ATR = 0.9;
const MSS_BODY_ATR = 0.5;

const MSS_MAXIMUM_BARS = 12;
const FVG_MAXIMUM_BARS = 6;
const FVG_RETEST_MAXIMUM_BARS = 12;

const POI_EXPIRY_DAYS = 60;
const MINIMUM_TARGET_R = 2;

const SPREAD = 0.45;
const SLIPPAGE = 0.05;
const STOP_ATR_BUFFER = 0.1;

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
  const parts = formatter.formatToParts(
    new Date(timestamp)
  );

  const hour = Number(
    parts.find(
      (part) => part.type === "hour"
    )?.value || 0
  );

  const minute = Number(
    parts.find(
      (part) => part.type === "minute"
    )?.value || 0
  );

  return hour * 60 + minute;
}

function insideTradingSession(
  timestamp: number
) {
  const london = localMinutes(
    timestamp,
    londonFormatter
  );

  const newYork = localMinutes(
    timestamp,
    newYorkFormatter
  );

  const londonSession =
    london >= 8 * 60 &&
    london <= 12 * 60;

  const newYorkSession =
    newYork >= 8 * 60 + 30 &&
    newYork <= 12 * 60;

  return (
    londonSession ||
    newYorkSession
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
    new Array(candles.length).fill(null);

  const low: NumberSeries =
    new Array(candles.length).fill(null);

  const pivots: Pivot[] = [];

  let latestHigh: number | null =
    null;

  let latestLow: number | null =
    null;

  for (
    let confirmedAt = 0;
    confirmedAt < candles.length;
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
        if (index === pivotIndex) {
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

      const confirmationTime =
        candles[confirmedAt].time +
        duration;

      if (isHigh) {
        latestHigh =
          candles[pivotIndex].high;

        pivots.push({
          kind: "HIGH",
          index: pivotIndex,
          price: latestHigh,
          confirmationTime,
        });
      }

      if (isLow) {
        latestLow =
          candles[pivotIndex].low;

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
    new Array(h1.length).fill(
      "NEUTRAL"
    );

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
  const index = lastClosedIndex(
    h1,
    H1_MS,
    timestamp
  );

  return index >= 0
    ? structureBias[index]
    : "NEUTRAL";
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

function buildDailyPois(
  h1: Candle[]
) {
  const map =
    new Map<number, Candle[]>();

  for (const candle of h1) {
    const day =
      dayStart(candle.time);

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
      map.get(previousDay) || [];

    if (candles.length === 0) {
      continue;
    }

    const high = Math.max(
      ...candles.map(
        (candle) => candle.high
      )
    );

    const low = Math.min(
      ...candles.map(
        (candle) => candle.low
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
      createdTime: currentDay,
      priority:
        poiPriority(
          "PREVIOUS_DAY_HIGH"
        ),
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
      createdTime: currentDay,
      priority:
        poiPriority(
          "PREVIOUS_DAY_LOW"
        ),
    });
  }

  return pois;
}

function buildSwingPois(
  pivots: PivotSeries
) {
  return pivots.pivots.map(
    (pivot): Poi => {
      const high =
        pivot.kind === "HIGH"
          ? pivot.price
          : pivot.price;

      const low = high;

      const kind: PoiKind =
        pivot.kind === "HIGH"
          ? "SWING_HIGH"
          : "SWING_LOW";

      return {
        id:
          `${kind}:${pivot.index}`,
        kind,
        direction:
          pivot.kind === "HIGH"
            ? "SELL"
            : "BUY",
        low,
        high,
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
  const output: Poi[] = [];

  const groups = {
    HIGH: pivots.pivots.filter(
      (pivot) =>
        pivot.kind === "HIGH"
    ),
    LOW: pivots.pivots.filter(
      (pivot) =>
        pivot.kind === "LOW"
    ),
  };

  for (
    const kind
    of ["HIGH", "LOW"] as const
  ) {
    const items = groups[kind];

    for (
      let index = 1;
      index < items.length;
      index++
    ) {
      const current = items[index];

      const previousCandidates =
        items.slice(
          Math.max(0, index - 8),
          index
        );

      const previous =
        previousCandidates
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
        (previous.price +
          current.price) /
        2;

      const poiKind: PoiKind =
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
          current.confirmationTime,
        priority:
          poiPriority(poiKind),
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
  const output: Poi[] = [];
  const bosKeys =
    new Set<string>();

  for (
    let index = 20;
    index < h1.length;
    index++
  ) {
    const volatility =
      atrH1[index];

    const previousHigh =
      pivots.high[index - 1];

    const previousLow =
      pivots.low[index - 1];

    if (
      volatility === null ||
      (
        previousHigh === null &&
        previousLow === null
      )
    ) {
      continue;
    }

    const candle = h1[index];

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

    const bosKey =
      `${direction}:${bosLevel}`;

    if (bosKeys.has(bosKey)) {
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

    bosKeys.add(bosKey);

    const kind: PoiKind =
      direction === "BUY"
        ? "DEMAND"
        : "SUPPLY";

    const low =
      direction === "BUY"
        ? source.low
        : Math.min(
            source.open,
            source.high
          );

    const high =
      direction === "BUY"
        ? Math.max(
            source.open,
            source.low
          )
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
        candle.time + H1_MS,
      priority:
        poiPriority(kind),
    });
  }

  return output;
}

function buildPois(
  data: ResearchMarketData,
  h1Pivots: PivotSeries,
  atrH1: NumberSeries
) {
  const combined = [
    ...buildDailyPois(
      data.h1
    ),
    ...buildSupplyDemandPois(
      data.h1,
      h1Pivots,
      atrH1
    ),
    ...buildEqualPois(
      h1Pivots
    ),
    ...buildSwingPois(
      h1Pivots
    ),
  ];

  const unique =
    new Map<string, Poi>();

  for (const poi of combined) {
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
    poi.kind === "SUPPLY" ||
    poi.kind === "DEMAND"
  );
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
        candle.low < poi.low &&
        candle.close >=
          poi.low &&
        candle.close <=
          poi.high +
            volatility * 0.1
      );
    }

    return (
      candle.low < poi.level &&
      candle.close >
        poi.level
    );
  }

  if (isZonePoi(poi)) {
    return (
      candle.high > poi.high &&
      candle.close <=
        poi.high &&
      candle.close >=
        poi.low -
          volatility * 0.1
    );
  }

  return (
    candle.high > poi.level &&
    candle.close <
      poi.level
  );
}

function poiTargetPrice(
  poi: Poi,
  direction: Direction
) {
  if (direction === "BUY") {
    return isZonePoi(poi)
      ? poi.low
      : poi.level;
  }

  return isZonePoi(poi)
    ? poi.high
    : poi.level;
}

function nearestTarget(
  direction: Direction,
  entry: number,
  entryTime: number,
  pois: Poi[]
) {
  const prices = pois
    .filter(
      (poi) =>
        poi.createdTime <=
          entryTime &&
        poi.direction !==
          direction
    )
    .map(
      (poi) =>
        poiTargetPrice(
          poi,
          direction
        )
    )
    .filter(
      (price) =>
        direction === "BUY"
          ? price > entry
          : price < entry
    );

  if (prices.length === 0) {
    return null;
  }

  return direction === "BUY"
    ? Math.min(...prices)
    : Math.max(...prices);
}

function findSweepExtremeIndex(
  m5: Candle[],
  sweep: Candle,
  direction: Direction
) {
  const start =
    firstIndexAtOrAfter(
      m5,
      sweep.time
    );

  const end =
    firstIndexAtOrAfter(
      m5,
      sweep.time +
        M15_MS
    );

  if (start >= end) {
    return start;
  }

  let result = start;

  for (
    let index = start + 1;
    index < end;
    index++
  ) {
    if (
      direction === "BUY" &&
      m5[index].low <
        m5[result].low
    ) {
      result = index;
    }

    if (
      direction === "SELL" &&
      m5[index].high >
        m5[result].high
    ) {
      result = index;
    }
  }

  return result;
}

function createSignalAfterSweep(
  poi: Poi,
  sweep: Candle,
  data: ResearchMarketData,
  m5Pivots: PivotSeries,
  atrM5: NumberSeries,
  atrM15Value: number,
  pois: Poi[]
): LiquiditySignal | null {
  const direction =
    poi.direction;

  const sweepClose =
    sweep.time + M15_MS;

  const sweepExtremeIndex =
    findSweepExtremeIndex(
      data.m5,
      sweep,
      direction
    );

  const sweepExtreme =
    data.m5[
      sweepExtremeIndex
    ];

  const mssStart =
    firstIndexAtOrAfter(
      data.m5,
      sweepClose
    );

  const mssEnd =
    Math.min(
      data.m5.length,
      mssStart +
        MSS_MAXIMUM_BARS
    );

  let mssIndex = -1;

  for (
    let index = mssStart;
    index < mssEnd;
    index++
  ) {
    const candle =
      data.m5[index];

    const volatility =
      atrM5[index];

    const swingLevel =
      direction === "BUY"
        ? m5Pivots.high[
            index - 1
          ]
        : m5Pivots.low[
            index - 1
          ];

    if (
      volatility === null ||
      swingLevel === null
    ) {
      continue;
    }

    const body = Math.abs(
      candle.close -
        candle.open
    );

    const bullishMss =
      direction === "BUY" &&
      candle.close >
        swingLevel &&
      candle.close >
        candle.open &&
      body >=
        volatility *
          MSS_BODY_ATR;

    const bearishMss =
      direction === "SELL" &&
      candle.close <
        swingLevel &&
      candle.close <
        candle.open &&
      body >=
        volatility *
          MSS_BODY_ATR;

    if (
      bullishMss ||
      bearishMss
    ) {
      mssIndex = index;
      break;
    }
  }

  if (mssIndex < 0) {
    return null;
  }

  const fvgEnd =
    Math.min(
      data.m5.length,
      mssIndex +
        FVG_MAXIMUM_BARS +
        1
    );

  let fvgIndex = -1;
  let fvgLow = 0;
  let fvgHigh = 0;

  for (
    let index =
      Math.max(2, mssIndex);
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
      fvgLow = first.high;
      fvgHigh = third.low;
      break;
    }

    if (bearishFvg) {
      fvgIndex = index;
      fvgLow = third.high;
      fvgHigh = first.low;
      break;
    }
  }

  if (fvgIndex < 0) {
    return null;
  }

  const midpoint =
    (fvgLow + fvgHigh) /
    2;

  const retestEnd =
    Math.min(
      data.m5.length,
      fvgIndex +
        FVG_RETEST_MAXIMUM_BARS +
        1
    );

  const sweepAtr =
    atrM5[
      sweepExtremeIndex
    ];

  if (sweepAtr === null) {
    return null;
  }

  for (
    let index =
      fvgIndex + 1;
    index < retestEnd;
    index++
  ) {
    const candle =
      data.m5[index];

    const entryTime =
      candle.time;

    if (
      !sameUtcDay(
        sweepClose,
        entryTime
      ) ||
      !insideTradingSession(
        entryTime
      )
    ) {
      break;
    }

    const touched =
      direction === "BUY"
        ? candle.low <=
          midpoint
        : candle.high >=
          midpoint;

    if (!touched) {
      continue;
    }

    const entry =
      direction === "BUY"
        ? midpoint +
          SPREAD +
          SLIPPAGE
        : midpoint -
          SLIPPAGE;

    const stopLoss =
      direction === "BUY"
        ? sweepExtreme.low -
          sweepAtr *
            STOP_ATR_BUFFER
        : sweepExtreme.high +
          sweepAtr *
            STOP_ATR_BUFFER +
          SPREAD;

    const risk = Math.abs(
      entry - stopLoss
    );

    if (
      risk <=
        SPREAD * 1.5 ||
      risk >
        atrM15Value * 3
    ) {
      return null;
    }

    const target =
      nearestTarget(
        direction,
        entry,
        entryTime,
        pois
      );

    if (target === null) {
      return null;
    }

    const targetR =
      Math.abs(
        target - entry
      ) / risk;

    if (
      targetR <
      MINIMUM_TARGET_R
    ) {
      return null;
    }

    return {
      strategy:
        `LIQUIDITY_MSS_FVG:${poi.kind}`,
      direction,
      entryTime,
      entry,
      stopLoss,
      targetR,
      poiId: poi.id,
      poiKind: poi.kind,
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
      targetLiquidity:
        target,
    };
  }

  return null;
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

  let sweeps = 0;
  let mss = 0;
  let fvg = 0;
  let rejectedNoTarget = 0;

  for (
    let index = 20;
    index <
      data.m15.length;
    index++
  ) {
    const candle =
      data.m15[index];

    const closeTime =
      candle.time + M15_MS;

    if (
      !insideTradingSession(
        closeTime
      )
    ) {
      continue;
    }

    const volatility =
      atrM15[index];

    if (volatility === null) {
      continue;
    }

    const bias =
      biasAt(
        closeTime,
        data.h1,
        structureBias
      );

    if (bias === "NEUTRAL") {
      continue;
    }

    for (const poi of pois) {
      if (
        poi.createdTime >=
          closeTime ||
        usedPois.has(
          poi.id
        ) ||
        invalidPois.has(
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

      const expectedDirection:
        Direction =
          bias === "BULLISH"
            ? "BUY"
            : "SELL";

      if (
        poi.direction !==
        expectedDirection
      ) {
        continue;
      }

      const invalidated =
        poi.direction === "BUY"
          ? candle.close <
            poi.low -
              volatility * 0.1
          : candle.close >
            poi.high +
              volatility * 0.1;

      if (invalidated) {
        invalidPois.add(
          poi.id
        );

        continue;
      }
    }

    const expectedDirection:
      Direction =
        bias === "BULLISH"
          ? "BUY"
          : "SELL";

    const candidates =
      pois
        .filter(
          (poi) =>
            poi.createdTime <
              closeTime &&
            poi.direction ===
              expectedDirection &&
            !usedPois.has(
              poi.id
            ) &&
            !invalidPois.has(
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

    sweeps++;

    const signal =
      createSignalAfterSweep(
        poi,
        candle,
        data,
        m5Pivots,
        atrM5,
        volatility,
        pois
      );

    if (!signal) {
      continue;
    }

    mss++;
    fvg++;

    if (
      signal.targetR <
      MINIMUM_TARGET_R
    ) {
      rejectedNoTarget++;
      continue;
    }

    signals.push(signal);
    usedPois.add(
      poi.id
    );
  }

  return {
    signals,
    statistics: {
      pois: pois.length,
      sweeps,
      mss,
      fvg,
      entries:
        signals.length,
      rejectedNoTarget,
    },
  };
}
