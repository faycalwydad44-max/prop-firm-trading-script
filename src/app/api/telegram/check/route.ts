import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/db";

export const dynamic = "force-dynamic";

type Setup = {
  status: "WAIT" | "SETUP_VALID" | "ERROR";
  reason?: string;
  symbol?: string;
  direction?: "BUY" | "SELL";
  entry?: number;
  stopLoss?: number;
  takeProfit?: number;
  riskReward?: number;
  suggestedRiskPercent?: number;
  trend?: string;
  session?: string;
  sweepLevel?: number;
  sweepTime?: string;
  confirmationTime?: string;
};

async function sendTelegram(
  token: string,
  chatId: string,
  text: string
) {
  const response = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
      }),
    }
  );

  if (!response.ok) {
    throw new Error("Envoi Telegram impossible");
  }
}

export async function POST(request: NextRequest) {
  const expectedSecret = process.env.MT5_WEBHOOK_SECRET;
  const authorization = request.headers.get("authorization");

  if (
    !expectedSecret ||
    authorization !== `Bearer ${expectedSecret}`
  ) {
    return NextResponse.json(
      { error: "Non autorise" },
      { status: 401 }
    );
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    return NextResponse.json(
      { error: "Token Telegram manquant" },
      { status: 500 }
    );
  }

  try {
    const setupUrl = new URL("/api/setup", request.url);

    const setupResponse = await fetch(setupUrl, {
      cache: "no-store",
    });

    if (!setupResponse.ok) {
      throw new Error("Moteur de setup indisponible");
    }

    const setup = (await setupResponse.json()) as Setup;

    if (setup.status !== "SETUP_VALID") {
      return NextResponse.json({
        checked: true,
        alertSent: false,
        status: setup.status,
        reason: setup.reason || "Aucun setup valide",
      });
    }

    if (
      !setup.direction ||
      !setup.entry ||
      !setup.stopLoss ||
      !setup.takeProfit ||
      !setup.sweepTime ||
      !setup.confirmationTime
    ) {
      throw new Error("Setup incomplet");
    }

    const setupKey = [
      setup.symbol || "XAUUSD",
      setup.direction,
      setup.sweepTime,
      setup.confirmationTime,
    ].join(":");

    const explanation = [
      `Tendance H1 : ${setup.trend}`,
      `Sweep de liquidite M15 : ${setup.sweepLevel}`,
      `Confirmation FVG M5 : ${setup.confirmationTime}`,
      `Session : ${setup.session}`,
    ].join(" | ");

    const message = [
      "PROPTRADER - SETUP XAUUSD VALIDE",
      "",
      `Direction : ${setup.direction}`,
      `Entree : ${setup.entry}`,
      `Stop Loss : ${setup.stopLoss}`,
      `Take Profit : ${setup.takeProfit}`,
      `R:R : 1:${setup.riskReward}`,
      `Risque conseille : ${setup.suggestedRiskPercent}%`,
      "",
      "Pourquoi ce setup ?",
      `- Tendance H1 : ${setup.trend}`,
      `- Sweep M15 au niveau : ${setup.sweepLevel}`,
      `- Confirmation FVG M5 detectee`,
      `- Session : ${setup.session}`,
      "",
      "Execution manuelle uniquement sur FTMO Demo.",
      "Verifiez toujours les niveaux dans MT5.",
      "",
      "https://prop-firm-trading-script.vercel.app",
    ].join("\n");

    const subscribers = await pool.query(
      `SELECT chat_id
       FROM telegram_subscribers
       WHERE active = TRUE`
    );

    let sent = 0;
    let duplicates = 0;
    let failed = 0;

    for (const subscriber of subscribers.rows) {
      const chatId = String(subscriber.chat_id);

      const reservation = await pool.query(
        `INSERT INTO telegram_alerts (
           setup_key,
           chat_id,
           direction,
           entry,
           stop_loss,
           take_profit,
           explanation
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (setup_key, chat_id)
         DO NOTHING
         RETURNING setup_key`,
        [
          setupKey,
          chatId,
          setup.direction,
          setup.entry,
          setup.stopLoss,
          setup.takeProfit,
          explanation,
        ]
      );

      if (reservation.rowCount === 0) {
        duplicates++;
        continue;
      }

      try {
        await sendTelegram(token, chatId, message);
        sent++;
      } catch (error) {
        failed++;

        await pool.query(
          `DELETE FROM telegram_alerts
           WHERE setup_key = $1 AND chat_id = $2`,
          [setupKey, chatId]
        );

        console.error("Alerte Telegram echouee:", error);
      }
    }

    return NextResponse.json({
      checked: true,
      status: setup.status,
      alertSent: sent > 0,
      sent,
      duplicates,
      failed,
    });
  } catch (error) {
    console.error("Erreur controle Telegram:", error);

    return NextResponse.json(
      {
        error: "Controle des alertes impossible",
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    service: "PropTrader Telegram alerts",
    status: "ready",
    trigger: "MT5 secured POST only",
  });
}
