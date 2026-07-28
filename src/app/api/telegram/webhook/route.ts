import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/db";

export const dynamic = "force-dynamic";

type TelegramUpdate = {
  message?: {
    text?: string;
    chat: {
      id: number;
      type: string;
    };
    from?: {
      username?: string;
      first_name?: string;
    };
  };
};

async function sendTelegramMessage(
  chatId: string,
  text: string
) {
  const token = process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN manquant");
  }

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
    throw new Error("Telegram sendMessage a echoue");
  }
}

export async function POST(request: NextRequest) {
  try {
    const expectedSecret =
      process.env.TELEGRAM_WEBHOOK_SECRET;

    const receivedSecret = request.headers.get(
      "x-telegram-bot-api-secret-token"
    );

    if (
      !expectedSecret ||
      receivedSecret !== expectedSecret
    ) {
      return NextResponse.json(
        { error: "Non autorise" },
        { status: 401 }
      );
    }

    const update =
      (await request.json()) as TelegramUpdate;

    const message = update.message;

    if (!message || message.chat.type !== "private") {
      return NextResponse.json({ ok: true });
    }

    const chatId = String(message.chat.id);
    const text = String(message.text || "")
      .trim()
      .toLowerCase();

    if (text === "/stop") {
      await pool.query(
        `UPDATE telegram_subscribers
         SET active = FALSE, updated_at = NOW()
         WHERE chat_id = $1`,
        [chatId]
      );

      await sendTelegramMessage(
        chatId,
        "Les alertes PropTrader sont desactivees. Envoyez /start pour les reactiver."
      );

      return NextResponse.json({ ok: true });
    }

    await pool.query(
      `INSERT INTO telegram_subscribers (
         chat_id,
         username,
         first_name,
         active,
         updated_at
       )
       VALUES ($1, $2, $3, TRUE, NOW())
       ON CONFLICT (chat_id)
       DO UPDATE SET
         username = EXCLUDED.username,
         first_name = EXCLUDED.first_name,
         active = TRUE,
         updated_at = NOW()`,
      [
        chatId,
        message.from?.username || null,
        message.from?.first_name || null,
      ]
    );

    await sendTelegramMessage(
      chatId,
      [
        "PropTrader est connecte.",
        "",
        "Vous recevrez une alerte uniquement lorsqu'un setup XAUUSD reel sera valide.",
        "",
        "L'alerte expliquera :",
        "- la tendance H1",
        "- le sweep M15",
        "- la confirmation FVG M5",
        "- l'entree, le stop et l'objectif",
        "",
        "Execution manuelle sur FTMO Demo uniquement.",
        "Envoyez /stop pour desactiver les alertes.",
      ].join("\n")
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Erreur webhook Telegram:", error);

    return NextResponse.json(
      { error: "Erreur Telegram" },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;

    if (!token || !secret) {
      return NextResponse.json(
        { error: "Configuration Telegram incomplete" },
        { status: 500 }
      );
    }

    const response = await fetch(
      `https://api.telegram.org/bot${token}/setWebhook`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: "https://prop-firm-trading-script.vercel.app/api/telegram/webhook",
          secret_token: secret,
          allowed_updates: ["message"],
          drop_pending_updates: false,
        }),
      }
    );

    const result = await response.json();

    return NextResponse.json({
      configured: response.ok,
      telegram: result,
    });
  } catch (error) {
    console.error("Erreur configuration webhook:", error);

    return NextResponse.json(
      { error: "Configuration impossible" },
      { status: 500 }
    );
  }
}
