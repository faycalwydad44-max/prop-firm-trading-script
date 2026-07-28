import { NextRequest, NextResponse } from "next/server";
import { calculatePositionSize } from "@/lib/trading-engine";
import type { Instrument, Direction, Strategy, Timeframe } from "@/lib/trading-engine";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const signal = {
      instrument: body.instrument as Instrument,
      direction: body.direction as Direction,
      entryZone: body.entryPrice,
      stopLoss: body.stopLoss,
      takeProfit1: body.takeProfit,
      takeProfit2: body.takeProfit,
      takeProfit3: body.takeProfit,
      strategy: "SMC" as Strategy,
      confidence: 80,
      timeframe: "H1" as Timeframe,
      analysis: "",
      riskRewardRatio: Math.abs(body.takeProfit - body.entryPrice) / Math.abs(body.entryPrice - body.stopLoss),
      pipValue: body.instrument === "XAUUSD" ? 0.1 : 1,
      riskPips: Math.abs(body.entryPrice - body.stopLoss) / (body.instrument === "XAUUSD" ? 0.1 : 1),
    };

    const result = calculatePositionSize(signal, {
      accountSize: body.accountSize,
      riskPerTrade: body.riskPercent,
      maxDailyLoss: body.maxDailyLoss || body.accountSize * 0.05,
      currentDailyPnl: body.currentDailyPnl || 0,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Calculator error:", error);
    return NextResponse.json({ error: "Calculation failed" }, { status: 500 });
  }
}
