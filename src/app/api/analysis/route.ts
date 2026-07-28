import { NextResponse } from "next/server";
import { generateSignals } from "@/lib/trading-engine";
import { checkPropFirmRules } from "@/lib/trading-engine";

export const dynamic = "force-dynamic";

export async function GET() {
  const signals = generateSignals();
  
  // Simulate a live market overview
  const marketOverview = signals.map((s) => ({
    instrument: s.instrument,
    price: s.entryZone,
    direction: s.direction,
    strategy: s.strategy,
    confidence: s.confidence,
    timeframe: s.timeframe,
    analysis: s.analysis,
    riskRewardRatio: s.riskRewardRatio,
    stopLoss: s.stopLoss,
    takeProfit1: s.takeProfit1,
    takeProfit2: s.takeProfit2,
    takeProfit3: s.takeProfit3,
    riskPips: s.riskPips,
  }));

  // Example prop firm check for demo
  const propCheck = checkPropFirmRules({
    currentBalance: 102500,
    startBalance: 100000,
    maxDailyLossPercent: 5,
    maxTotalLossPercent: 10,
    profitTargetPercent: 8,
    todayPnl: -150,
  });

  return NextResponse.json({
    marketOverview,
    propFirmStatus: propCheck,
    generatedAt: new Date().toISOString(),
  });
}
