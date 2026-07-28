"use client";

import { useState, useEffect } from "react";

interface SessionStats {
  startTime: Date;
  tradesCount: number;
  wins: number;
  losses: number;
  pnl: number;
}

export default function TradingSession() {
  const [session, setSession] = useState<SessionStats | null>(null);
  const [elapsed, setElapsed] = useState("00:00:00");
  const [killZone, setKillZone] = useState<string | null>(null);

  // Detect kill zones
  useEffect(() => {
    function checkKillZone() {
      const now = new Date();
      const utcHour = now.getUTCHours();

      if (utcHour >= 7 && utcHour < 10) {
        setKillZone("🇬🇧 London Kill Zone (07:00–10:00 UTC)");
      } else if (utcHour >= 12 && utcHour < 15) {
        setKillZone("🇺🇸 New York Kill Zone (12:00–15:00 UTC)");
      } else if (utcHour >= 9 && utcHour < 12) {
        setKillZone("🇬🇧🇺🇸 London/NY Overlap (09:00–12:00 UTC)");
      } else if (utcHour >= 0 && utcHour < 3) {
        setKillZone("🇯🇵 Asian Kill Zone (00:00–03:00 UTC)");
      } else {
        setKillZone(null);
      }
    }

    checkKillZone();
    const interval = setInterval(checkKillZone, 60000);
    return () => clearInterval(interval);
  }, []);

  // Session timer
  useEffect(() => {
    if (!session) return;
    const interval = setInterval(() => {
      const diff = Date.now() - session.startTime.getTime();
      const hours = Math.floor(diff / 3600000);
      const mins = Math.floor((diff % 3600000) / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      setElapsed(
        `${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`
      );
    }, 1000);
    return () => clearInterval(interval);
  }, [session]);

  function startSession() {
    setSession({
      startTime: new Date(),
      tradesCount: 0,
      wins: 0,
      losses: 0,
      pnl: 0,
    });
  }

  function endSession() {
    setSession(null);
    setElapsed("00:00:00");
  }

  return (
    <div className="bg-dark-800 border border-dark-600 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-gold-400">⏱ Session de Trading</h3>
        {!session ? (
          <button
            onClick={startSession}
            className="px-3 py-1.5 bg-profit/20 text-profit text-xs font-bold rounded-lg hover:bg-profit/30 transition"
          >
            ▶ Démarrer
          </button>
        ) : (
          <button
            onClick={endSession}
            className="px-3 py-1.5 bg-loss/20 text-loss text-xs font-bold rounded-lg hover:bg-loss/30 transition"
          >
            ⏹ Terminer
          </button>
        )}
      </div>

      {session ? (
        <div className="space-y-3">
          <div className="text-center">
            <p className="text-3xl font-mono font-bold text-white">{elapsed}</p>
            <p className="text-xs text-slate-500 mt-1">
              Démarrée à {session.startTime.toLocaleTimeString("fr-FR")}
            </p>
          </div>

          <div className="grid grid-cols-4 gap-2 text-center text-xs">
            <div className="bg-dark-700 rounded-lg p-2">
              <p className="text-slate-500">Trades</p>
              <p className="text-white font-bold">{session.tradesCount}</p>
            </div>
            <div className="bg-dark-700 rounded-lg p-2">
              <p className="text-slate-500">Wins</p>
              <p className="text-profit font-bold">{session.wins}</p>
            </div>
            <div className="bg-dark-700 rounded-lg p-2">
              <p className="text-slate-500">Losses</p>
              <p className="text-loss font-bold">{session.losses}</p>
            </div>
            <div className="bg-dark-700 rounded-lg p-2">
              <p className="text-slate-500">P&L</p>
              <p className={`font-bold ${session.pnl >= 0 ? "text-profit" : "text-loss"}`}>
                ${session.pnl}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <p className="text-xs text-slate-500 text-center py-2">
          Démarrez une session pour tracker votre trading
        </p>
      )}

      {/* Kill Zone indicator */}
      {killZone && (
        <div className="mt-3 bg-gold-400/10 border border-gold-400/20 rounded-lg px-3 py-2">
          <p className="text-xs text-gold-400 font-medium">{killZone}</p>
          <p className="text-xs text-slate-500 mt-0.5">
            Période optimale pour trader — Haute volatilité
          </p>
        </div>
      )}

      {!killZone && (
        <div className="mt-3 bg-dark-700 rounded-lg px-3 py-2">
          <p className="text-xs text-slate-500">
            ⏳ Hors Kill Zone — Attendez une session majeure
          </p>
        </div>
      )}
    </div>
  );
}
