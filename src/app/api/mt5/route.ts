import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/db";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const expectedSecret = process.env.MT5_WEBHOOK_SECRET;
    const authorization = request.headers.get("authorization");

    if (!expectedSecret || authorization !== `Bearer ${expectedSecret}`) {
      return NextResponse.json({ error: "Non autorise" }, { status: 401 });
    }

    const body = await request.json();
    const symbol = String(body.symbol || "").toUpperCase();
    const bid = Number(body.bid);
    const ask = Number(body.ask);

    if (
      symbol !== "XAUUSD" ||
      !Number.isFinite(bid) ||
      !Number.isFinite(ask) ||
      bid <= 0 ||
      ask <= 0
    ) {
      return NextResponse.json(
        { error: "Donnees invalides" },
        { status: 400 }
      );
    }

    await pool.query(
      `INSERT INTO market_prices
        (symbol, bid, ask, source, received_at)
       VALUES ($1, $2, $3, 'FTMO-MT5', NOW())
       ON CONFLICT (symbol)
       DO UPDATE SET
         bid = EXCLUDED.bid,
         ask = EXCLUDED.ask,
         source = EXCLUDED.source,
         received_at = NOW()`,
      [symbol, bid, ask]
    );

    return NextResponse.json({
      success: true,
      symbol,
      receivedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Erreur MT5:", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

export async function GET() {
  try {
    const result = await pool.query(
      `SELECT symbol, bid, ask, source, received_at
       FROM market_prices
       WHERE symbol = 'XAUUSD'
       LIMIT 1`
    );

    return NextResponse.json(result.rows[0] || null, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(null, {
      headers: { "Cache-Control": "no-store" },
    });
  }
}
