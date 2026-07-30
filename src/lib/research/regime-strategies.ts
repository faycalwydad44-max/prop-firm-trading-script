import {
  Candle,
  H1_MS,
  M5_MS,
  M15_MS,
  NumberSeries,
  ResearchMarketData,
  adxSeries,
  atrSeries,
  choppinessSeries,
  dayStart,
  emaSeries,
  firstIndexAtOrAfter,
  lastClosedIndex,
  minuteOfDay,
} from "./market-data";

import {
  Direction,
  ResearchSignal,
} from "./simulator";

export type RegimeCandidate = {
  id: string;
  trendAdxMinimum: number;
  trendChoppinessMaximum: number;
  rangeAdxMaximum: number;
  rangeChoppinessMinimum: number;
  impulseAtrMinimum: number;
  confirmationAtrMinimum: number;
  trendTargetR: number;
  rangeTargetR: number;
};

export type ResearchIndicators = {
  ema20H1: NumberSeries;
  ema50H1: NumberSeries;
  ema20M15: NumberSeries;
  ema50M15: NumberSeries;
  atrM15: NumberSeries;
  atrM5: NumberSeries;
  adxM15: NumberSeries;
  choppinessM15: NumberSeries;
};

type Bias =
  | "BULLISH"
  | "BEARISH"
  | "NEUTRAL";

const MINUTE_MS = 60 * 1000;

const SPREAD = 0.45;
const SLIPPAGE = 0.05;

const SESSION_START_MINUTE =
  6 * 60;

const SESSION_END_MINUTE =
  20 * 60;

const TREND_BREAKOUT_LOOKBACK = 8;
const RANGE_LOOKBACK = 20;
const SWEEP_LOOKBACK_M5 = 10;

export const REGIME_CANDIDATES: RegimeCandidate[] = [
  {
    id: "BALANCED_A",
    trendAdxMinimum: 18,
    trendChoppinessMaximum: 58,
    rangeAdxMaximum: 18,
    rangeChoppinessMinimum: 55,
    impulseAtrMinimum: 0.65,
    confirmationAtrMinimum: 0.35,
    trendTargetR: 1.5,
    rangeTargetR: 1.2,
  },
  {
    id: "BALANCED_B",
    trendAdxMinimum: 20,
    trendChoppinessMaximum: 56,
    rangeAdxMaximum: 17,
    rangeChoppinessMinimum: 57,
    impulseAtrMinimum: 0.7,
    confirmationAtrMinimum: 0.4,
    trendTargetR: 1.5,
    rangeTargetR: 1,
  },
  {
    id: "SELECTIVE_A",
    trendAdxMinimum: 22,
    trendChoppinessMaximum: 55,
    rangeAdxMaximum: 16,
    rangeChoppinessMinimum: 60,
    impulseAtrMinimum: 0.8,
    confirmationAtrMinimum: 0.45,
    trendTargetR: 1.8,
    rangeTargetR: 1,
  },
  {
    id: "SELECTIVE_B",
    trendAdxMinimum: 24,
    trendChoppinessMaximum: 52,
    rangeAdxMaximum: 15,
    rangeChoppinessMinimum: 61.8,
    impulseAtrMinimum: 0.9,
    confirmationAtrMinimum: 0.5,
    trendTargetR: 2,
    rangeTargetR: 1,
  },
  {
    id: "FREQUENT_A",
    trendAdxMinimum: 16,
    trendChoppinessMaximum: 61.8,
    rangeAdxMaximum: 20,
    rangeChoppinessMinimum: 52,
    impulseAtrMinimum: 0.55,
    confirmationAtrMinimum: 0.3,
    trendTargetR: 1.3,
    rangeTargetR: 1,
  },
  {
    id: "FREQUENT_B",
    trendAdxMinimum: 17,
    trendChoppinessMaximum: 60,
    rangeAdxMaximum: 19,
    rangeChoppinessMinimum: 54,
    impulseAtrMinimum: 0.6,
    confirmationAtrMinimum: 0.35,
    trendTargetR: 1.5,
    rangeTargetR: 1.2,
  },
];

export function buildResearchIndicators(
  data: ResearchMarketData
): ResearchIndicators {
  return {
    ema20H1: emaSeries(
      data.h1.map(
        (candle) => candle.close
      ),
      20
    ),
    ema50H1: emaSeries(
      data.h1.map(
        (candle) => candle.close
      ),
      50
    ),
    ema20M15: emaSeries(
      data.m15.map(
        (candle) => candle.close
      ),
      20
    ),
    ema50M15: emaSeries(
      data.m15.map(
        (candle) => candle.close
      ),
      50
    ),
    atrM15: atrSeries(
      data.m15,
      14
    ),
    atrM5: atrSeries(
      data.m5,
      14
    ),
    adxM15: adxSeries(
      data.m15,
      14
    ),
    choppinessM15:
      choppinessSeries(
        data.m15,
        14
      ),
  };
}

function h1BiasAt(
  timestamp: number,
  h1: Candle[],
  ema20H1: NumberSeries,
  ema50H1: NumberSeries
): Bias {
  const index = lastClosedIndex(
    h1,
    H1_MS,
    timestamp
  );

  if (
    index < 3 ||
    ema20H1[index] === null ||
    ema50H1[index] === null ||
    ema20H1[index - 3] === null
  ) {
    return "NEUTRAL";
  }

  const close = h1[index].close;
  const fast =
    ema20H1[index] as number;

  const slow =
    ema50H1[index] as number;

  const previousFast =
    ema20H1[index - 3] as number;

  if (
    close > slow &&
    fast > slow &&
    fast >= previousFast
  ) {
    return "BULLISH";
  }

  if (
    close < slow &&
    fast < slow &&
    fast <= previousFast
  ) {
    return "BEARISH";
  }

  return "NEUTRAL";
}

function isInsideSession(
  timestamp: number
) {
  const minutes =
    minuteOfDay(timestamp);

  return (
    minutes >=
      SESSION_START_MINUTE &&
    minutes <=
      SESSION_END_MINUTE
  );
}

function sameDay(
  first: number,
  second: number
) {
  return (
    dayStart(first) ===
    dayStart(second)
  );
}

function validRisk(
  entry: number,
  stopLoss: number,
  volatility: number
) {
  const risk = Math.abs(
    entry - stopLoss
  );

  return (
    risk >= SPREAD * 1.5 &&
    risk <= volatility * 2.8
  );
}

function createTrendSignals(
  data: ResearchMarketData,
  indicators: ResearchIndicators,
  candidate: RegimeCandidate
): ResearchSignal[] {
  const signals: ResearchSignal[] =
    [];

  let lastSignalTime = 0;

  for (
    let impulseIndex = 60;
    impulseIndex <
    data.m15.length;
    impulseIndex++
  ) {
    const impulse =
      data.m15[impulseIndex];

    const impulseCloseTime =
      impulse.time + M15_MS;

    if (
      !isInsideSession(
        impulseCloseTime
      ) ||
      impulseCloseTime -
        lastSignalTime <
        90 * MINUTE_MS
    ) {
      continue;
    }

    const atr =
      indicators.atrM15[
        impulseIndex
      ];

    const adx =
      indicators.adxM15[
        impulseIndex
      ];

    const chop =
      indicators.choppinessM15[
        impulseIndex
      ];

    const ema20 =
      indicators.ema20M15[
        impulseIndex
      ];

    const ema50 =
      indicators.ema50M15[
        impulseIndex
      ];

    if (
      atr === null ||
      adx === null ||
      chop === null ||
      ema20 === null ||
      ema50 === null ||
      adx <
        candidate.trendAdxMinimum ||
      chop >
        candidate
          .trendChoppinessMaximum
    ) {
      continue;
    }

    const bias = h1BiasAt(
      impulseCloseTime,
      data.h1,
      indicators.ema20H1,
      indicators.ema50H1
    );

    if (bias === "NEUTRAL") {
      continue;
    }

    const direction: Direction =
      bias === "BULLISH"
        ? "BUY"
        : "SELL";

    const aligned =
      direction === "BUY"
        ? ema20 > ema50
        : ema20 < ema50;

    if (!aligned) {
      continue;
    }

    const previous =
      data.m15.slice(
        impulseIndex -
          TREND_BREAKOUT_LOOKBACK,
        impulseIndex
      );

    const previousHigh = Math.max(
      ...previous.map(
        (candle) => candle.high
      )
    );

    const previousLow = Math.min(
      ...previous.map(
        (candle) => candle.low
      )
    );

    const body = Math.abs(
      impulse.close - impulse.open
    );

    const buyImpulse =
      direction === "BUY" &&
      impulse.close >
        previousHigh &&
      impulse.close >
        impulse.open &&
      body >=
        atr *
          candidate
            .impulseAtrMinimum;

    const sellImpulse =
      direction === "SELL" &&
      impulse.close <
        previousLow &&
      impulse.close <
        impulse.open &&
      body >=
        atr *
          candidate
            .impulseAtrMinimum;

    if (
      !buyImpulse &&
      !sellImpulse
    ) {
      continue;
    }

    const breakoutLevel =
      direction === "BUY"
        ? previousHigh
        : previousLow;

    const pullbackEnd = Math.min(
      data.m15.length,
      impulseIndex + 5
    );

    let created = false;

    for (
      let pullbackIndex =
        impulseIndex + 1;
      pullbackIndex <
        pullbackEnd;
      pullbackIndex++
    ) {
      const pullback =
        data.m15[pullbackIndex];

      const pullbackCloseTime =
        pullback.time +
        M15_MS;

      if (
        !sameDay(
          impulseCloseTime,
          pullbackCloseTime
        ) ||
        !isInsideSession(
          pullbackCloseTime
        )
      ) {
        break;
      }

      const pullbackFast =
        indicators.ema20M15[
          pullbackIndex
        ];

      const pullbackSlow =
        indicators.ema50M15[
          pullbackIndex
        ];

      const pullbackAtr =
        indicators.atrM15[
          pullbackIndex
        ];

      if (
        pullbackFast === null ||
        pullbackSlow === null ||
        pullbackAtr === null
      ) {
        continue;
      }

      const touchesFast =
        direction === "BUY"
          ? pullback.low <=
            pullbackFast +
              pullbackAtr * 0.2
          : pullback.high >=
            pullbackFast -
              pullbackAtr * 0.2;

      const touchesLevel =
        direction === "BUY"
          ? pullback.low <=
              breakoutLevel +
                pullbackAtr *
                  0.25 &&
            pullback.high >=
              breakoutLevel -
                pullbackAtr *
                  0.25
          : pullback.high >=
              breakoutLevel -
                pullbackAtr *
                  0.25 &&
            pullback.low <=
              breakoutLevel +
                pullbackAtr *
                  0.25;

      const holdsTrend =
        direction === "BUY"
          ? pullback.low >=
              pullbackSlow -
                pullbackAtr *
                  0.3 &&
            pullback.close >
              pullbackSlow
          : pullback.high <=
              pullbackSlow +
                pullbackAtr *
                  0.3 &&
            pullback.close <
              pullbackSlow;

      if (
        (!touchesFast &&
          !touchesLevel) ||
        !holdsTrend
      ) {
        continue;
      }

      const m5Start =
        firstIndexAtOrAfter(
          data.m5,
          pullbackCloseTime
        );

      const m5End = Math.min(
        data.m5.length,
        m5Start + 8
      );

      for (
        let m5Index = m5Start;
        m5Index < m5End;
        m5Index++
      ) {
        const confirmation =
          data.m5[m5Index];

        const entryTime =
          confirmation.time +
          M5_MS;

        if (
          !sameDay(
            pullbackCloseTime,
            entryTime
          ) ||
          !isInsideSession(
            entryTime
          )
        ) {
          break;
        }

        const atrM5 =
          indicators.atrM5[
            m5Index
          ];

        if (atrM5 === null) {
          continue;
        }

        const confirmationBody =
          Math.abs(
            confirmation.close -
              confirmation.open
          );

        const buyConfirmation =
          direction === "BUY" &&
          confirmation.close >
            pullback.high &&
          confirmation.close >
            confirmation.open &&
          confirmationBody >=
            atrM5 *
              candidate
                .confirmationAtrMinimum;

        const sellConfirmation =
          direction === "SELL" &&
          confirmation.close <
            pullback.low &&
          confirmation.close <
            confirmation.open &&
          confirmationBody >=
            atrM5 *
              candidate
                .confirmationAtrMinimum;

        if (
          !buyConfirmation &&
          !sellConfirmation
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

        const stopLoss =
          direction === "BUY"
            ? pullback.low -
              pullbackAtr * 0.2
            : pullback.high +
              pullbackAtr * 0.2 +
              SPREAD;

        if (
          !validRisk(
            entry,
            stopLoss,
            pullbackAtr
          )
        ) {
          continue;
        }

        signals.push({
          strategy:
            `${candidate.id}:TREND`,
          direction,
          entryTime,
          entry,
          stopLoss,
          targetR:
            candidate.trendTargetR,
        });

        lastSignalTime =
          entryTime;

        created = true;
        break;
      }

      if (created) {
        break;
      }
    }
  }

  return signals;
}

function createRangeSignals(
  data: ResearchMarketData,
  indicators: ResearchIndicators,
  candidate: RegimeCandidate
): ResearchSignal[] {
  const signals: ResearchSignal[] =
    [];

  let lastSignalTime = 0;

  for (
    let sweepIndex = 60;
    sweepIndex <
    data.m15.length;
    sweepIndex++
  ) {
    const sweep =
      data.m15[sweepIndex];

    const sweepCloseTime =
      sweep.time + M15_MS;

    if (
      !isInsideSession(
        sweepCloseTime
      ) ||
      sweepCloseTime -
        lastSignalTime <
        90 * MINUTE_MS
    ) {
      continue;
    }

    const atr =
      indicators.atrM15[
        sweepIndex
      ];

    const adx =
      indicators.adxM15[
        sweepIndex
      ];

    const chop =
      indicators.choppinessM15[
        sweepIndex
      ];

    if (
      atr === null ||
      adx === null ||
      chop === null ||
      adx >
        candidate.rangeAdxMaximum ||
      chop <
        candidate
          .rangeChoppinessMinimum
    ) {
      continue;
    }

    const previous =
      data.m15.slice(
        sweepIndex -
          RANGE_LOOKBACK,
        sweepIndex
      );

    const rangeHigh = Math.max(
      ...previous.map(
        (candle) => candle.high
      )
    );

    const rangeLow = Math.min(
      ...previous.map(
        (candle) => candle.low
      )
    );

    const rangeWidth =
      rangeHigh - rangeLow;

    if (
      rangeWidth <
        atr * 2 ||
      rangeWidth >
        atr * 8
    ) {
      continue;
    }

    const buySweep =
      sweep.low < rangeLow &&
      sweep.close > rangeLow;

    const sellSweep =
      sweep.high > rangeHigh &&
      sweep.close < rangeHigh;

    if (
      !buySweep &&
      !sellSweep
    ) {
      continue;
    }

    const direction: Direction =
      buySweep ? "BUY" : "SELL";

    const bias = h1BiasAt(
      sweepCloseTime,
      data.h1,
      indicators.ema20H1,
      indicators.ema50H1
    );

    if (
      (direction === "BUY" &&
        bias === "BEARISH") ||
      (direction === "SELL" &&
        bias === "BULLISH")
    ) {
      continue;
    }

    const m5Start =
      firstIndexAtOrAfter(
        data.m5,
        sweepCloseTime
      );

    const m5End = Math.min(
      data.m5.length,
      m5Start + 9
    );

    for (
      let m5Index = m5Start;
      m5Index < m5End;
      m5Index++
    ) {
      const confirmation =
        data.m5[m5Index];

      const entryTime =
        confirmation.time + M5_MS;

      if (
        !sameDay(
          sweepCloseTime,
          entryTime
        ) ||
        !isInsideSession(
          entryTime
        )
      ) {
        break;
      }

      const atrM5 =
        indicators.atrM5[
          m5Index
        ];

      if (
        atrM5 === null ||
        m5Index <
          SWEEP_LOOKBACK_M5
      ) {
        continue;
      }

      const localPrevious =
        data.m5.slice(
          m5Index -
            SWEEP_LOOKBACK_M5,
          m5Index
        );

      const localHigh = Math.max(
        ...localPrevious.map(
          (candle) => candle.high
        )
      );

      const localLow = Math.min(
        ...localPrevious.map(
          (candle) => candle.low
        )
      );

      const body = Math.abs(
        confirmation.close -
          confirmation.open
      );

      const buyConfirmation =
        direction === "BUY" &&
        confirmation.close >
          localHigh &&
        confirmation.close >
          confirmation.open &&
        body >=
          atrM5 *
            candidate
              .confirmationAtrMinimum;

      const sellConfirmation =
        direction === "SELL" &&
        confirmation.close <
          localLow &&
        confirmation.close <
          confirmation.open &&
        body >=
          atrM5 *
            candidate
              .confirmationAtrMinimum;

      if (
        !buyConfirmation &&
        !sellConfirmation
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

      const stopLoss =
        direction === "BUY"
          ? Math.min(
              sweep.low,
              confirmation.low
            ) -
            atr * 0.1
          : Math.max(
              sweep.high,
              confirmation.high
            ) +
            atr * 0.1 +
            SPREAD;

      if (
        !validRisk(
          entry,
          stopLoss,
          atr
        )
      ) {
        continue;
      }

      signals.push({
        strategy:
          `${candidate.id}:RANGE`,
        direction,
        entryTime,
        entry,
        stopLoss,
        targetR:
          candidate.rangeTargetR,
      });

      lastSignalTime =
        entryTime;

      break;
    }
  }

  return signals;
}

export function createRegimeAdaptiveSignals(
  data: ResearchMarketData,
  indicators: ResearchIndicators,
  candidate: RegimeCandidate
): {
  trend: ResearchSignal[];
  range: ResearchSignal[];
  combined: ResearchSignal[];
} {
  const trend =
    createTrendSignals(
      data,
      indicators,
      candidate
    );

  const range =
    createRangeSignals(
      data,
      indicators,
      candidate
    );

  return {
    trend,
    range,
    combined: [
      ...trend,
      ...range,
    ].sort(
      (left, right) =>
        left.entryTime -
        right.entryTime
    ),
  };
}
