import { NextResponse } from "next/server";
import { pool } from "@/db";
import {
  checkPropFirmRules,
  generateSignals,
} from "@/lib/trading-engine";

export const dynamic = "force-dynamic";

function roundPrice(value: number) {
  return Math.round(value * 100) / 100;
}

export async function GET() {
  const signals = generateSignals();

  let liveGold:
    | {
        price: number;
        source: string;
        receivedAt: string;
        isFresh: boolean;
      }
    | undefined;

  try {
    const result = await pool.query(
      `SELECT bid, ask, source, received_at
       FROM market_prices
       WHERE symbol = 'XAUUSD'
       LIMIT 1`
    );

    const row = result.rows[0];

    if (row) {
      const bid = Number(row.bid);
      const ask = Number(row.ask);
      const receivedAt = new Date(row.received_at);
      const age = Date.now() - receivedAt.getTime();

      if (
        Number.isFinite(bid) &&
        Number.isFinite(ask) &&
        bid > 0 &&
        ask > 0
      ) {
        liveGold = {
          price: roundPrice((bid + ask) / 2),
          source: String(row.source || "FTMO-MT5"),
          receivedAt: receivedAt.toISOString(),
          isFresh: age < 120000,
        };
      }
    }
  } catch (error) {
    console.error("Impossible de lire le prix MT5:", error);
  }

  const marketOverview = signals.map((signal) => {
    if (signal.instrument !== "XAUUSD" || !liveGold) {
      return {
        instrument: signal.instrument,
        price: signal.entryZone,
        direction: signal.direction,
        strategy: signal.strategy,
        confidence: signal.confidence,
        timeframe: signal.timeframe,
        analysis: signal.analysis,
        riskRewardRatio: signal.riskRewardRatio,
        stopLoss: signal.stopLoss,
        takeProfit1: signal.takeProfit1,
        takeProfit2: signal.takeProfit2,
        takeProfit3: signal.takeProfit3,
        riskPips: signal.riskPips,
        priceSource: "SIMULATION",
        priceIsLive: false,
      };
    }

    const offset = liveGold.price - signal.entryZone;
    const priceStatus = liveGold.isFresh
      ? "Prix reel recu en direct depuis FTMO-MT5."
      : "Dernier prix FTMO-MT5 recu. Le flux est actuellement en retard.";

    return {
      instrument: signal.instrument,
      price: liveGold.price,
      direction: signal.direction,
      strategy: signal.strategy,
      confidence: signal.confidence,
      timeframe: signal.timeframe,
      analysis:
        `${priceStatus} La direction et la strategie restent simulees. ` +
        signal.analysis,
      riskRewardRatio: signal.riskRewardRatio,
      stopLoss: roundPrice(signal.stopLoss + offset),
      takeProfit1: roundPrice(signal.takeProfit1 + offset),
      takeProfit2: roundPrice(signal.takeProfit2 + offset),
      takeProfit3: roundPrice(signal.takeProfit3 + offset),
      riskPips: signal.riskPips,
      priceSource: liveGold.source,
      priceIsLive: liveGold.isFresh,
      marketDataAt: liveGold.receivedAt,
    };
  });

  const propFirmStatus = checkPropFirmRules({
    currentBalance: 102500,
    startBalance: 100000,
    maxDailyLossPercent: 5,
    maxTotalLossPercent: 10,
    profitTargetPercent: 8,
    todayPnl: -150,
  });

  return NextResponse.json({
    marketOverview,
    propFirmStatus,
    generatedAt: new Date().toISOString(),
  });
}
