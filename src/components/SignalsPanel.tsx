"use client";

import { useEffect, useState, useCallback } from "react";

interface Signal {
  id: string;
  instrument: string;
  direction: string;
  entryZone: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number | null;
  takeProfit3: number | null;
  strategy: string;
  confidence: number;
  timeframe: string;
  analysis: string | null;
  status: string;
  createdAt: string;
}

export default function SignalsPanel() {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [filter, setFilter] = useState<string>("all");
  const [autoGen, setAutoGen] = useState(false);
  const [autoCountdown, setAutoCountdown] = useState(120);

  const fetchSignals = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/signals");
      const data = await res.json();
      setSignals(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  const generateNewSignals = useCallback(async () => {
    setGenerating(true);
    try {
      const res = await fetch("/api/signals", { method: "POST" });
      if (res.ok) {
        await fetchSignals();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setGenerating(false);
    }
  }, [fetchSignals]);

  useEffect(() => {
    fetchSignals();
  }, [fetchSignals]);

  // Auto-generate signals
  useEffect(() => {
    if (!autoGen) return;
    const interval = setInterval(() => {
      setAutoCountdown((prev) => {
        if (prev <= 1) {
          generateNewSignals();
          return 120;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [autoGen, generateNewSignals]);

  const filtered = filter === "all" ? signals : signals.filter((s) => s.instrument === filter);

  // Group by high/medium/low confidence
  const highConf = filtered.filter((s) => s.confidence >= 80);
  const medConf = filtered.filter((s) => s.confidence >= 65 && s.confidence < 80);
  const lowConf = filtered.filter((s) => s.confidence < 65);

  return (
    <div className="space-y-6 animate-slide-up">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white">📡 Signaux de Trading</h2>
          <p className="text-slate-400 text-sm mt-1">
            Signaux générés par ICT / Smart Money — {signals.length} signaux en base
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Auto-gen toggle */}
          <button
            onClick={() => {
              setAutoGen(!autoGen);
              if (!autoGen) setAutoCountdown(120);
            }}
            className={`px-4 py-2.5 rounded-xl text-sm font-bold transition ${
              autoGen
                ? "bg-profit/20 text-profit border border-profit/30"
                : "bg-dark-700 text-slate-400 border border-dark-600"
            }`}
          >
            {autoGen ? `🟢 AUTO (${autoCountdown}s)` : "⏸ Auto OFF"}
          </button>
          <button
            onClick={generateNewSignals}
            disabled={generating}
            className="px-6 py-2.5 bg-gradient-to-r from-gold-400 to-gold-600 text-dark-900 font-bold rounded-xl hover:shadow-lg hover:shadow-gold-400/20 transition disabled:opacity-50"
          >
            {generating ? "⏳ Analyse..." : "🔮 Générer Signaux"}
          </button>
        </div>
      </div>

      {/* Auto-gen progress */}
      {autoGen && (
        <div className="h-1 bg-dark-700 rounded-full overflow-hidden -mt-3">
          <div
            className="h-full bg-gradient-to-r from-profit to-buy rounded-full transition-all duration-1000"
            style={{ width: `${(autoCountdown / 120) * 100}%` }}
          />
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-2 flex-wrap items-center">
        {["all", "XAUUSD", "NAS100", "US30"].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
              filter === f
                ? "bg-gold-400 text-dark-900"
                : "bg-dark-700 text-slate-400 hover:text-white"
            }`}
          >
            {f === "all" ? "🌐 Tous" : f === "XAUUSD" ? "🥇 XAUUSD" : f === "NAS100" ? "📈 NAS100" : "🏛️ US30"}
          </button>
        ))}
        <span className="text-xs text-slate-500 ml-2">{filtered.length} signaux affichés</span>
      </div>

      {loading && signals.length === 0 ? (
        <div className="text-center py-20 text-slate-400 animate-pulse">
          Chargement des signaux...
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 bg-dark-800 rounded-xl border border-dark-600">
          <p className="text-6xl mb-4">📡</p>
          <p className="text-slate-400 text-lg">Aucun signal disponible</p>
          <p className="text-slate-500 text-sm mt-2">
            Cliquez sur &quot;Générer Signaux&quot; ou activez le mode AUTO
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* High confidence signals */}
          {highConf.length > 0 && (
            <div>
              <h3 className="text-sm font-bold text-profit mb-3 flex items-center gap-2">
                <span className="w-2 h-2 bg-profit rounded-full animate-pulse" />
                🎯 Signaux Forts (Confiance ≥ 80%) — {highConf.length} signal(s)
              </h3>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {highConf.map((signal) => (
                  <SignalDetailCard key={signal.id} signal={signal} priority="high" />
                ))}
              </div>
            </div>
          )}

          {/* Medium confidence */}
          {medConf.length > 0 && (
            <div>
              <h3 className="text-sm font-bold text-gold-400 mb-3 flex items-center gap-2">
                <span className="w-2 h-2 bg-gold-400 rounded-full" />
                ⏳ En Attente de Confirmation (65-79%) — {medConf.length} signal(s)
              </h3>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {medConf.map((signal) => (
                  <SignalDetailCard key={signal.id} signal={signal} priority="medium" />
                ))}
              </div>
            </div>
          )}

          {/* Low confidence */}
          {lowConf.length > 0 && (
            <div>
              <h3 className="text-sm font-bold text-slate-400 mb-3 flex items-center gap-2">
                <span className="w-2 h-2 bg-slate-500 rounded-full" />
                ⚡ Signaux Faibles (&lt;65%) — {lowConf.length} signal(s)
              </h3>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 opacity-70">
                {lowConf.map((signal) => (
                  <SignalDetailCard key={signal.id} signal={signal} priority="low" />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SignalDetailCard({
  signal,
  priority,
}: {
  signal: Signal;
  priority: "high" | "medium" | "low";
}) {
  const isBuy = signal.direction === "BUY";
  const instrumentEmoji =
    signal.instrument === "XAUUSD" ? "🥇" : signal.instrument === "NAS100" ? "📈" : "🏛️";

  const rr =
    Math.abs(signal.takeProfit1 - signal.entryZone) /
    (Math.abs(signal.entryZone - signal.stopLoss) || 1);

  const borderColor =
    priority === "high"
      ? "border-profit/30 hover:border-profit/50"
      : priority === "medium"
      ? "border-gold-400/20 hover:border-gold-400/40"
      : "border-dark-600 hover:border-dark-500";

  return (
    <div
      className={`bg-dark-800 border ${borderColor} rounded-xl overflow-hidden transition-all`}
    >
      <div
        className={`p-4 flex items-center justify-between ${
          isBuy ? "bg-buy/10 border-b border-buy/20" : "bg-sell/10 border-b border-sell/20"
        }`}
      >
        <div className="flex items-center gap-3">
          <span className="text-3xl">{instrumentEmoji}</span>
          <div>
            <h3 className="text-lg font-bold text-white">{signal.instrument}</h3>
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span className="bg-dark-600 px-2 py-0.5 rounded">{signal.timeframe}</span>
              <span className="bg-dark-600 px-2 py-0.5 rounded">{signal.strategy}</span>
            </div>
          </div>
        </div>
        <div className="text-right">
          <span
            className={`inline-block px-4 py-1.5 rounded-full font-bold text-sm ${
              isBuy ? "bg-buy text-white" : "bg-sell text-white"
            }`}
          >
            {signal.direction}
          </span>
          <p className="text-xs text-slate-500 mt-1">
            {new Date(signal.createdAt).toLocaleString("fr-FR")}
          </p>
        </div>
      </div>

      <div className="p-5 space-y-4">
        {/* Price Levels */}
        <div className="grid grid-cols-5 gap-2 text-center text-xs">
          <div className="bg-dark-700 rounded-lg p-2">
            <p className="text-slate-500 mb-1">Entrée</p>
            <p className="text-white font-bold">{signal.entryZone.toFixed(2)}</p>
          </div>
          <div className="bg-red-900/20 rounded-lg p-2">
            <p className="text-slate-500 mb-1">SL</p>
            <p className="text-loss font-bold">{signal.stopLoss.toFixed(2)}</p>
          </div>
          <div className="bg-green-900/20 rounded-lg p-2">
            <p className="text-slate-500 mb-1">TP1</p>
            <p className="text-profit font-bold">{signal.takeProfit1.toFixed(2)}</p>
          </div>
          <div className="bg-green-900/20 rounded-lg p-2">
            <p className="text-slate-500 mb-1">TP2</p>
            <p className="text-profit font-bold">
              {signal.takeProfit2 ? signal.takeProfit2.toFixed(2) : "—"}
            </p>
          </div>
          <div className="bg-green-900/20 rounded-lg p-2">
            <p className="text-slate-500 mb-1">TP3</p>
            <p className="text-profit font-bold">
              {signal.takeProfit3 ? signal.takeProfit3.toFixed(2) : "—"}
            </p>
          </div>
        </div>

        {/* Metrics */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div>
              <span className="text-xs text-slate-500">Confiance</span>
              <div className="flex items-center gap-2 mt-1">
                <div className="w-20 h-2 bg-dark-600 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${
                      signal.confidence > 80
                        ? "bg-profit"
                        : signal.confidence > 60
                        ? "bg-gold-400"
                        : "bg-sell"
                    }`}
                    style={{ width: `${signal.confidence}%` }}
                  />
                </div>
                <span className="text-white text-sm font-bold">{signal.confidence}%</span>
              </div>
            </div>
            <div>
              <span className="text-xs text-slate-500">R:R</span>
              <p className="text-gold-400 font-bold text-sm mt-1">1:{rr.toFixed(1)}</p>
            </div>
          </div>

          {/* Quality badge */}
          {priority === "high" ? (
            <span className="px-3 py-1 rounded-full text-xs font-bold bg-profit/20 text-profit border border-profit/30">
              🎯 TRADER
            </span>
          ) : priority === "medium" ? (
            <span className="px-3 py-1 rounded-full text-xs font-bold bg-gold-400/20 text-gold-400 border border-gold-400/30">
              ⏳ WAIT
            </span>
          ) : (
            <span className="px-3 py-1 rounded-full text-xs font-bold bg-dark-600 text-slate-400">
              SKIP
            </span>
          )}
        </div>

        {/* Analysis */}
        {signal.analysis && (
          <div className="bg-dark-700 rounded-lg p-3 border-l-2 border-gold-400">
            <p className="text-xs text-slate-400 leading-relaxed">{signal.analysis}</p>
          </div>
        )}
      </div>
    </div>
  );
}
