import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { trades } from "@/db/schema";
import { desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const allTrades = await db
      .select()
      .from(trades)
      .orderBy(desc(trades.openedAt))
      .limit(50);
    return NextResponse.json(allTrades);
  } catch {
    return NextResponse.json([]);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const rr = Math.abs(body.takeProfit - body.entryPrice) / Math.abs(body.entryPrice - body.stopLoss);

    const [trade] = await db
      .insert(trades)
      .values({
        challengeId: body.challengeId || null,
        instrument: body.instrument,
        direction: body.direction,
        entryPrice: body.entryPrice,
        stopLoss: body.stopLoss,
        takeProfit: body.takeProfit,
        lotSize: body.lotSize,
        strategy: body.strategy || null,
        notes: body.notes || null,
        riskRewardRatio: Math.round(rr * 10) / 10,
        status: "open",
      })
      .returning();

    return NextResponse.json(trade);
  } catch (error) {
    console.error("Error creating trade:", error);
    return NextResponse.json({ error: "Failed to create trade" }, { status: 500 });
  }
}
