import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { propFirmChallenges } from "@/db/schema";
import { desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const challenges = await db
      .select()
      .from(propFirmChallenges)
      .orderBy(desc(propFirmChallenges.createdAt));
    return NextResponse.json(challenges);
  } catch {
    return NextResponse.json([]);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const [challenge] = await db
      .insert(propFirmChallenges)
      .values({
        firmName: body.firmName,
        accountSize: body.accountSize,
        phase: body.phase || 1,
        profitTarget: body.profitTarget,
        maxDailyLoss: body.maxDailyLoss,
        maxTotalLoss: body.maxTotalLoss,
        currentBalance: body.accountSize,
        currentPnl: 0,
        status: "active",
      })
      .returning();

    return NextResponse.json(challenge);
  } catch (error) {
    console.error("Error creating challenge:", error);
    return NextResponse.json({ error: "Failed to create challenge" }, { status: 500 });
  }
}
