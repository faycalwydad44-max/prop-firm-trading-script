import { NextResponse } from "next/server";

import {
  Candle,
  H1_MS,
  M5_MS,
  M15_MS,
  NumberSeries,
  atrSeries,
  emaSeries,
  firstIndexAtOrAfter,
  lastClosedIndex,
  loadXauusdResearchData,
} from "@/lib/research/market-data";

import {
  DEFAULT_SIMULATION_CONFIG,
  Direction,
  ResearchSignal,
  ThreeWayEvaluation,
  evaluateThreeWay,
} from "@/lib/research/simulator";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Bias =
  | "BULLISH"
  | "BEARISH"
  | "NEUTRAL";

type SessionName =
  | "LONDON"
  | "NEW_YORK";

const SPREAD = 0.45;
const SLIPPAGE = 0.05;
const TARGET_R = 2.5;
const RISK_PERCENT = 0.1;

const BREAKOUT_LOOKBACK = 20;
const BREAKOUT_BODY_ATR = 0.8;

const PULLBACK_MAXIMUM_BARS = 6;
const PULLBACK_ABOVE_ATR = 0.15;
const PULLBACK_BELOW_ATR = 0.35;

const CONFIRMATION_MAXIMUM_BARS = 8;
const CONFIRMATION_BODY_ATR = 0.6;

const STOP_BUFFER_ATR = 0.15;

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
      timeZone:
        "America/New_York",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }
  );

function localMinutes(
  timestamp: number,
  formatter:
    Intl.DateTimeFormat
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

function sessionAt(
  timestamp: number
): SessionName | null {
  const londonMinutes =
    localMinutes(
      timestamp,
      londonFormatter
    );

  if (
    londonMinutes >= 8 * 60 &&
    londonMinutes <= 12 * 60
  ) {
    return "LONDON";
  }

  const newYorkMinutes =
    localMinutes(
      timestamp,
      newYorkFormatter
    );

  if (
    newYorkMinutes >=
      8 * 60 + 30 &&
    newYorkMinutes <= 12 * 60
  ) {
    return "NEW_YORK";
  }

  return null;
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

function trendAt(
  timestamp: number,
  h1: Candle[],
  ema50: NumberSeries,
  ema200: NumberSeries
): Bias {
  const index =
    lastClosedIndex(
      h1,
      H1_MS,
      timestamp
    );

  if (
    index < 3 ||
    ema50[index] === null ||
    ema200[index] === null ||
    ema50[index - 3] === null
  ) {
    return "NEUTRAL";
  }

  const close =
    h1[index].close;

  const fast =
    ema50[index] as number;

  const slow =
    ema200[index] as number;

  const previousFast =
    ema50[index - 3] as number;

  if (
    close > fast &&
    fast > slow &&
    fast > previousFast
  ) {
    return "BULLISH";
  }

  if (
    close < fast &&
    fast < slow &&
    fast < previousFast
  ) {
    return "BEARISH";
  }

  return "NEUTRAL";
}

function generateSignals(
  h1: Candle[],
  m15: Candle[],
  m5: Candle[],
  ema50: NumberSeries,
  ema200: NumberSeries,
  atr15: NumberSeries,
  atr5: NumberSeries
) {
  const london:
    ResearchSignal[] = [];

  const newYork:
    ResearchSignal[] = [];

  for (
    let breakoutIndex =
      BREAKOUT_LOOKBACK;
    breakoutIndex <
      m15.length - 1;
    breakoutIndex++
  ) {
    const breakout =
      m15[breakoutIndex];

    const breakoutClose =
      breakout.time +
      M15_MS;

    const trend =
      trendAt(
        breakoutClose,
        h1,
        ema50,
        ema200
      );

    const volatility15 =
      atr15[breakoutIndex];

    if (
      trend === "NEUTRAL" ||
      volatility15 === null
    ) {
      continue;
    }

    const previous =
      m15.slice(
        breakoutIndex -
          BREAKOUT_LOOKBACK,
        breakoutIndex
      );

    const previousHigh =
      Math.max(
        ...previous.map(
          (candle) =>
            candle.high
        )
      );

    const previousLow =
      Math.min(
        ...previous.map(
          (candle) =>
            candle.low
        )
      );

    const body =
      Math.abs(
        breakout.close -
          breakout.open
      );

    const bullishBreakout =
      trend === "BULLISH" &&
      breakout.close >
        previousHigh &&
      breakout.close >
        breakout.open &&
      body >=
        volatility15 *
          BREAKOUT_BODY_ATR;

    const bearishBreakout =
      trend === "BEARISH" &&
      breakout.close <
        previousLow &&
      breakout.close <
        breakout.open &&
      body >=
        volatility15 *
          BREAKOUT_BODY_ATR;

    if (
      !bullishBreakout &&
      !bearishBreakout
    ) {
      continue;
    }

    const direction:
      Direction =
        bullishBreakout
          ? "BUY"
          : "SELL";

    const breakoutLevel =
      direction === "BUY"
        ? previousHigh
        : previousLow;

    const pullbackEnd =
      Math.min(
        m15.length,
        breakoutIndex +
          PULLBACK_MAXIMUM_BARS +
          1
      );

    let signalCreated =
      false;

    for (
      let pullbackIndex =
        breakoutIndex + 1;
      pullbackIndex <
        pullbackEnd;
      pullbackIndex++
    ) {
      const pullback =
        m15[pullbackIndex];

      const pullbackClose =
        pullback.time +
        M15_MS;

      if (
        !sameUtcDay(
          breakoutClose,
          pullbackClose
        )
      ) {
        break;
      }

      const buyPullback =
        direction === "BUY" &&
        pullback.low <=
          breakoutLevel +
            volatility15 *
              PULLBACK_ABOVE_ATR &&
        pullback.low >=
          breakoutLevel -
            volatility15 *
              PULLBACK_BELOW_ATR &&
        pullback.close >
          breakoutLevel;

      const sellPullback =
        direction === "SELL" &&
        pullback.high >=
          breakoutLevel -
            volatility15 *
              PULLBACK_ABOVE_ATR &&
        pullback.high <=
          breakoutLevel +
            volatility15 *
              PULLBACK_BELOW_ATR &&
        pullback.close <
          breakoutLevel;

      if (
        !buyPullback &&
        !sellPullback
      ) {
        continue;
      }

      const m5Start =
        firstIndexAtOrAfter(
          m5,
          pullbackClose
        );

      const m5End =
        Math.min(
          m5.length,
          m5Start +
            CONFIRMATION_MAXIMUM_BARS
        );

      for (
        let m5Index =
          m5Start;
        m5Index < m5End;
        m5Index++
      ) {
        const confirmation =
          m5[m5Index];

        const entryTime =
          confirmation.time +
          M5_MS;

        if (
          !sameUtcDay(
            pullbackClose,
            entryTime
          )
        ) {
          break;
        }

        const session =
          sessionAt(entryTime);

        if (!session) {
          continue;
        }

        if (
          trendAt(
            entryTime,
            h1,
            ema50,
            ema200
          ) !== trend
        ) {
          break;
        }

        const volatility5 =
          atr5[m5Index];

        if (
          volatility5 === null
        ) {
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
            volatility5 *
              CONFIRMATION_BODY_ATR;

        const sellConfirmation =
          direction === "SELL" &&
          confirmation.close <
            pullback.low &&
          confirmation.close <
            confirmation.open &&
          confirmationBody >=
            volatility5 *
              CONFIRMATION_BODY_ATR;

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
              volatility15 *
                STOP_BUFFER_ATR
            : pullback.high +
              volatility15 *
                STOP_BUFFER_ATR +
              SPREAD;

        const risk =
          Math.abs(
            entry - stopLoss
          );

        if (
          risk <=
            SPREAD * 1.5 ||
          risk >
            volatility15 * 2.5
        ) {
          continue;
        }

        const signal:
          ResearchSignal = {
            strategy:
              `CONTINUATION_AUDIT:${session}`,
            direction,
            entryTime,
            entry,
            stopLoss,
            targetR:
              TARGET_R,
          };

        if (
          session === "LONDON"
        ) {
          london.push(signal);
        } else {
          newYork.push(signal);
        }

        signalCreated =
          true;

        break;
      }

      if (signalCreated) {
        breakoutIndex =
          pullbackIndex;

        break;
      }
    }
  }

  return {
    london,
    newYork,
    combined: [
      ...london,
      ...newYork,
    ].sort(
      (left, right) =>
        left.entryTime -
        right.entryTime
    ),
  };
}

function passes(
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
    all.expectancyR >=
      0.1 &&
    all.maximumClosedTradeDrawdownPercent <
      5 &&
    training.netR > 0 &&
    validation.totalTrades >=
      15 &&
    validation.netR > 0 &&
    (validation.profitFactor ??
      0) >= 1.15 &&
    final.totalTrades >= 15 &&
    final.netR > 0 &&
    (final.profitFactor ??
      0) >= 1.15
  );
}

function report(
  signals: ResearchSignal[],
  m5: Candle[]
) {
  const evaluation =
    evaluateThreeWay(
      signals,
      m5,
      {
        ...DEFAULT_SIMULATION_CONFIG,
        riskPercent:
          RISK_PERCENT,
        spread: SPREAD,
        maximumTradesPerDay:
          2,
        maximumHoldingBars:
          72,
        forcedExitMinute:
          21 * 60,
      }
    );

  return {
    signalCount:
      signals.length,
    passed:
      passes(
        evaluation
      ),
    evaluation,
  };
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
        },
        {
          status: 400,
        }
      );
    }

    const closes =
      data.h1.map(
        (candle) =>
          candle.close
      );

    const ema50 =
      emaSeries(
        closes,
        50
      );

    const ema200 =
      emaSeries(
        closes,
        200
      );

    const atr15 =
      atrSeries(
        data.m15,
        14
      );

    const atr5 =
      atrSeries(
        data.m5,
        14
      );

    const signals =
      generateSignals(
        data.h1,
        data.m15,
        data.m5,
        ema50,
        ema200,
        atr15,
        atr5
      );

    const london =
      report(
        signals.london,
        data.m5
      );

    const newYork =
      report(
        signals.newYork,
        data.m5
      );

    const combined =
      report(
        signals.combined,
        data.m5
      );

    const passedModules = [
      london.passed
        ? "LONDON"
        : null,
      newYork.passed
        ? "NEW_YORK"
        : null,
      combined.passed
        ? "COMBINED"
        : null,
    ].filter(Boolean);

    return NextResponse.json(
      {
        audit:
          "CONTINUATION_UTC_FIXED_V1",
        symbol: "XAUUSD",
        source:
          "FTMO-MT5",
        timeData:
          "UTC_NORMALIZED",
        status:
          passedModules.length >
          0
            ? "CANDIDATE_FOR_SHORT_DEMO"
            : "DO_NOT_TRADE",
        rules: {
          h1Trend:
            "Close, EMA50/200 et pente EMA50",
          breakout:
            "Cassure des 20 bougies M15 precedentes avec corps >= 0.8 ATR",
          pullback:
            "Retour au niveau sous 6 bougies M15",
          confirmation:
            "Cassure M5 du pullback avec corps >= 0.6 ATR",
          londonSession:
            "08:00-12:00 Europe/London",
          newYorkSession:
            "08:30-12:00 America/New_York",
          targetR:
            TARGET_R,
          riskPercent:
            RISK_PERCENT,
          maximumHolding:
            "6 heures reelles",
          overnight:
            false,
          spread:
            SPREAD,
          slippage:
            SLIPPAGE,
        },
        results: {
          london,
          newYork,
          combined,
        },
        passedModules,
        decision:
          passedModules.length >
          0
            ? "Le module valide peut passer a un court test FTMO Demo."
            : "Ne pas ajouter ce module au Dashboard ou a Telegram.",
        warning:
          "Audit historique. Aucun resultat ne garantit les performances futures.",
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
      "Erreur audit continuation:",
      error
    );

    return NextResponse.json(
      {
        error:
          "Audit continuation impossible.",
      },
      {
        status: 500,
      }
    );
  }
}
