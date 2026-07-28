import { NextResponse } from "next/server";
import { db } from "@/db";
import { tradingSignals } from "@/db/schema";
import { generateSignals } from "@/lib/trading-engine";
import { desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const signals = await db
      .select()
      .from(tradingSignals)
      .orderBy(desc(tradingSignals.createdAt))
      .limit(20);
    return NextResponse.json(signals);
  } catch {
    return NextResponse.json([]);
  }
}

export async function POST() {
  try {
    const signals = generateSignals();

    const inserted = [];
    for (const signal of signals) {
      const [row] = await db
        .insert(tradingSignals)
        .values({
          instrument: signal.instrument,
          direction: signal.direction,
          entryZone: signal.entryZone,
          stopLoss: signal.stopLoss,
          takeProfit1: signal.takeProfit1,
          takeProfit2: signal.takeProfit2,
          takeProfit3: signal.takeProfit3,
          strategy: signal.strategy,
          confidence: signal.confidence,
          timeframe: signal.timeframe,
          analysis: signal.analysis,
          status: "pending",
        })
        .returning();
      inserted.push(row);
    }

    return NextResponse.json(inserted);
  } catch (error) {
    console.error("Error generating signals:", error);
    return NextResponse.json({ error: "Failed to generate signals" }, { status: 500 });
  }
}
