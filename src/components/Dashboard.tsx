"use client";

import { useEffect, useState, useCallback } from "react";
import TradingSession from "./TradingSession";
import RealSetupPanel from "./RealSetupPanel";
interface MarketSignal {
  instrument: string;
  price: number;
  direction: string;
  strategy: string;
  confidence: number;
  timeframe: string;
  analysis: string;
  riskRewardRatio: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  takeProfit3: number;
  riskPips: number;
}

interface PropStatus {
  dailyLossUsed: number;
  totalDrawdown: number;
  profitProgress: number;
  isAtRisk: boolean;
  canTrade: boolean;
  warnings: string[];
}

interface AnalysisData {
  marketOverview: MarketSignal[];
  propFirmStatus: PropStatus;
  generatedAt: string;
}

export default function Dashboard() {
  const [data, setData] = useState<AnalysisData | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoMode, setAutoMode] = useState(true);
  const [refreshRate, setRefreshRate] = useState(30);
  const [countdown, setCountdown] = useState(30);
  const [signalHistory, setSignalHistory] = useState<
    { time: string; instrument: string; direction: string; confidence: number }[]
  >([]);

  const fetchAnalysis = useCallback(async () => {
    try {
      const res = await fetch("/api/analysis");
      const json = await res.json();

      // Track signal changes
      if (data && json.marketOverview) {
        json.marketOverview.forEach((newSig: MarketSignal) => {
          const old = data.marketOverview.find((s) => s.instrument === newSig.instrument);
          if (old && (old.direction !== newSig.direction || old.strategy !== newSig.strategy)) {
            setSignalHistory((prev) => [
              {
                time: new Date().toLocaleTimeString("fr-FR"),
                instrument: newSig.instrument,
                direction: newSig.direction,
                confidence: newSig.confidence,
              },
              ...prev.slice(0, 19),
            ]);
          }
        });
      }

      setData(json);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [data]);

  // Initial fetch
  useEffect(() => {
    fetchAnalysis();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-refresh countdown
  useEffect(() => {
    if (!autoMode) return;
    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          fetchAnalysis();
          return refreshRate;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [autoMode, refreshRate, fetchAnalysis]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <div className="text-5xl mb-4 animate-pulse">📡</div>
          <div className="text-gold-400 text-xl animate-pulse">Analyse des marchés en cours...</div>
          <p className="text-slate-500 text-sm mt-2">Connexion aux flux de données</p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const stats = [
    {
      label: "Progression Profit",
      value: `${data.propFirmStatus.profitProgress}%`,
      color: "text-profit",
      bg: "from-green-900/30 to-green-800/10",
      icon: "🎯",
    },
    {
      label: "Perte Journalière",
      value: `${data.propFirmStatus.dailyLossUsed}%`,
      color: data.propFirmStatus.dailyLossUsed > 70 ? "text-loss" : "text-gold-400",
      bg: data.propFirmStatus.dailyLossUsed > 70
        ? "from-red-900/30 to-red-800/10"
        : "from-yellow-900/30 to-yellow-800/10",
      icon: "📉",
    },
    {
      label: "Drawdown Total",
      value: `${data.propFirmStatus.totalDrawdown}%`,
      color: data.propFirmStatus.totalDrawdown > 60 ? "text-loss" : "text-signal",
      bg: "from-blue-900/30 to-blue-800/10",
      icon: "⚠️",
    },
    {
      label: "Statut Trading",
      value: data.propFirmStatus.canTrade ? "ACTIF" : "STOP",
      color: data.propFirmStatus.canTrade ? "text-profit" : "text-loss",
      bg: data.propFirmStatus.canTrade
        ? "from-green-900/30 to-green-800/10"
        : "from-red-900/30 to-red-800/10",
      icon: data.propFirmStatus.canTrade ? "✅" : "🛑",
    },
  ];

  return (
    <div className="space-y-6 animate-slide-up">
  <RealSetupPanel />
      <RealSetupPanel />
      {/* Header with auto-refresh controls */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white">📊 Dashboard Trading Live</h2>
          <p className="text-slate-400 text-sm mt-1">
            Mise à jour: {new Date(data.generatedAt).toLocaleTimeString("fr-FR")}
            {autoMode && (
              <span className="text-gold-400 ml-2">
                • Prochain refresh dans {countdown}s
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Refresh rate selector */}
          <div className="flex items-center gap-1 bg-dark-800 rounded-lg border border-dark-600 p-1">
            {[15, 30, 60].map((rate) => (
              <button
                key={rate}
                onClick={() => {
                  setRefreshRate(rate);
                  setCountdown(rate);
                }}
                className={`px-2.5 py-1 rounded text-xs font-medium transition ${
                  refreshRate === rate
                    ? "bg-gold-400 text-dark-900"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                {rate}s
              </button>
            ))}
          </div>
          {/* Auto toggle */}
          <button
            onClick={() => {
              setAutoMode(!autoMode);
              if (!autoMode) setCountdown(refreshRate);
            }}
            className={`px-4 py-2 rounded-lg text-sm font-bold transition ${
              autoMode
                ? "bg-profit/20 text-profit border border-profit/30"
                : "bg-dark-700 text-slate-400 border border-dark-600"
            }`}
          >
            {autoMode ? "🟢 AUTO ON" : "⏸ AUTO OFF"}
          </button>
          {/* Manual refresh */}
          <button
            onClick={() => {
              fetchAnalysis();
              setCountdown(refreshRate);
            }}
            className="px-4 py-2 bg-gold-400 text-dark-900 font-bold rounded-lg hover:bg-gold-500 transition"
          >
            🔄 Refresh
          </button>
        </div>
      </div>

      {/* Auto-refresh progress bar */}
      {autoMode && (
        <div className="h-1 bg-dark-700 rounded-full overflow-hidden -mt-3">
          <div
            className="h-full bg-gradient-to-r from-gold-400 to-gold-600 rounded-full transition-all duration-1000"
            style={{ width: `${(countdown / refreshRate) * 100}%` }}
          />
        </div>
      )}
      <RealSetupPanel />
      {/* Warnings */}
      {data.propFirmStatus.warnings.length > 0 && (
        <div className="bg-red-900/20 border border-red-500/30 rounded-xl p-4 animate-pulse">
          <p className="text-red-400 text-xs font-bold uppercase mb-2">⚠️ ALERTES RISQUE</p>
          {data.propFirmStatus.warnings.map((w, i) => (
            <p key={i} className="text-red-400 text-sm font-medium">{w}</p>
          ))}
        </div>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s) => (
          <div
            key={s.label}
            className={`bg-gradient-to-br ${s.bg} border border-dark-600 rounded-xl p-5 hover:border-gold-400/20 transition`}
          >
            <div className="flex items-center justify-between">
              <p className="text-slate-400 text-xs uppercase tracking-wider">{s.label}</p>
              <span className="text-lg">{s.icon}</span>
            </div>
            <p className={`text-3xl font-bold mt-2 ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Main content: Signals + Session */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Signals - 3 cols */}
        <div className="lg:col-span-3 grid grid-cols-1 md:grid-cols-3 gap-4">
          {data.marketOverview.map((signal) => (
            <SignalCard key={signal.instrument} signal={signal} />
          ))}
        </div>

        {/* Right panel - 1 col */}
        <div className="space-y-4">
          <TradingSession />

          {/* Signal History */}
          <div className="bg-dark-800 border border-dark-600 rounded-xl p-4">
            <h3 className="text-sm font-bold text-gold-400 mb-3">📜 Historique Signaux</h3>
            {signalHistory.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-4">
                Les changements de signaux apparaîtront ici automatiquement
              </p>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {signalHistory.map((h, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between text-xs bg-dark-700 rounded-lg px-3 py-2"
                  >
                    <span className="text-slate-500">{h.time}</span>
                    <span className="text-white font-bold">{h.instrument}</span>
                    <span
                      className={`font-bold ${
                        h.direction === "BUY" ? "text-buy" : "text-sell"
                      }`}
                    >
                      {h.direction}
                    </span>
                    <span className="text-gold-400">{h.confidence}%</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* How it works */}
      <div className="bg-dark-800 border border-dark-600 rounded-xl p-6">
        <h3 className="text-lg font-bold text-gold-400 mb-4">🚀 Comment utiliser PropTrader Pro</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-sm">
          <div className="space-y-3">
            <div className="w-10 h-10 bg-gold-400/10 rounded-lg flex items-center justify-center text-xl">1️⃣</div>
            <h4 className="text-white font-bold">Laissez l&apos;app tourner</h4>
            <p className="text-slate-400">
              L&apos;app se rafraîchit automatiquement toutes les 15-60 secondes. Les signaux se mettent 
              à jour en temps réel. <span className="text-gold-400 font-medium">Pas besoin de rafraîchir manuellement.</span>
            </p>
          </div>
          <div className="space-y-3">
            <div className="w-10 h-10 bg-gold-400/10 rounded-lg flex items-center justify-center text-xl">2️⃣</div>
            <h4 className="text-white font-bold">Suivez les signaux</h4>
            <p className="text-slate-400">
              Quand un signal apparaît avec une <span className="text-profit">confiance &gt;80%</span> et un 
              <span className="text-gold-400"> R:R &gt;2.5</span>, allez sur votre plateforme MT4/MT5 et 
              placez le trade avec les niveaux indiqués.
            </p>
          </div>
          <div className="space-y-3">
            <div className="w-10 h-10 bg-gold-400/10 rounded-lg flex items-center justify-center text-xl">3️⃣</div>
            <h4 className="text-white font-bold">Gérez le risque</h4>
            <p className="text-slate-400">
              Utilisez le <span className="text-gold-400 font-medium">Calculateur</span> pour la taille de position. 
              Journalisez chaque trade. Respectez les règles de votre prop firm affichées en permanence.
            </p>
          </div>
        </div>
      </div>

      {/* Risk Rules */}
      <div className="bg-dark-800 border border-dark-600 rounded-xl p-6">
        <h3 className="text-lg font-bold text-gold-400 mb-4">📋 Checklist Avant Chaque Trade</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div className="space-y-2">
            <RuleItem text="Confiance du signal ≥ 75%" checked />
            <RuleItem text="Ratio R:R minimum 1:2.5" checked />
            <RuleItem text="Risque max 1% du compte par trade" checked />
            <RuleItem text="Pas plus de 3 trades simultanés" checked />
            <RuleItem text="Stop loss placé AVANT d'entrer" checked />
          </div>
          <div className="space-y-2">
            <RuleItem text="Vérifier le calendrier économique" checked />
            <RuleItem text="Trader pendant les Kill Zones" checked />
            <RuleItem text="Pas de trading revenge après perte" checked />
            <RuleItem text="Journal le trade dans l'app" checked />
            <RuleItem text="Respecter le drawdown journalier" checked />
          </div>
        </div>
      </div>
    </div>
  );
}

function RuleItem({ text, checked }: { text: string; checked: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className={checked ? "text-profit" : "text-loss"}>
        {checked ? "✅" : "❌"}
      </span>
      <span className="text-slate-300">{text}</span>
    </div>
  );
}

function SignalCard({ signal }: { signal: MarketSignal }) {
  const isBuy = signal.direction === "BUY";
  const instrumentEmoji =
    signal.instrument === "XAUUSD" ? "🥇" : signal.instrument === "NAS100" ? "📈" : "🏛️";

  return (
    <div className="bg-dark-800 border border-dark-600 rounded-xl overflow-hidden hover:border-gold-400/30 transition-all group">
      {/* Header */}
      <div
        className={`px-5 py-3 flex items-center justify-between ${
          isBuy ? "bg-buy/10" : "bg-sell/10"
        }`}
      >
        <div className="flex items-center gap-2">
          <span className="text-2xl">{instrumentEmoji}</span>
          <div>
            <h4 className="font-bold text-white">{signal.instrument}</h4>
            <p className="text-xs text-slate-400">{signal.timeframe} • {signal.strategy}</p>
          </div>
        </div>
        <span
          className={`px-3 py-1 rounded-full text-xs font-bold ${
            isBuy ? "bg-buy text-white" : "bg-sell text-white"
          }`}
        >
          {signal.direction}
        </span>
      </div>

      {/* Body */}
      <div className="p-4 space-y-3">
        {/* Price */}
        <div className="text-center">
          <p className="text-xs text-slate-500">Zone d&apos;entrée</p>
          <p className="text-2xl font-bold text-white">{signal.price.toFixed(2)}</p>
        </div>

        {/* Levels */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="bg-red-900/20 rounded-lg p-2 text-center">
            <p className="text-slate-500">SL</p>
            <p className="text-loss font-bold">{signal.stopLoss.toFixed(2)}</p>
          </div>
          <div className="bg-green-900/20 rounded-lg p-2 text-center">
            <p className="text-slate-500">TP1</p>
            <p className="text-profit font-bold">{signal.takeProfit1.toFixed(2)}</p>
          </div>
          <div className="bg-green-900/20 rounded-lg p-2 text-center">
            <p className="text-slate-500">TP2</p>
            <p className="text-profit font-bold">{signal.takeProfit2.toFixed(2)}</p>
          </div>
          <div className="bg-green-900/20 rounded-lg p-2 text-center">
            <p className="text-slate-500">TP3</p>
            <p className="text-profit font-bold">{signal.takeProfit3.toFixed(2)}</p>
          </div>
        </div>

        {/* Confidence & R:R */}
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <span className="text-slate-500">Confiance:</span>
            <div className="w-20 h-2 bg-dark-600 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  signal.confidence > 80 ? "bg-profit" : signal.confidence > 60 ? "bg-gold-400" : "bg-sell"
                }`}
                style={{ width: `${signal.confidence}%` }}
              />
            </div>
            <span className="text-white font-bold">{signal.confidence}%</span>
          </div>
          <div>
            <span className="text-slate-500">R:R </span>
            <span className="text-gold-400 font-bold">1:{signal.riskRewardRatio}</span>
          </div>
        </div>

        {/* Analysis */}
        <div className="bg-dark-700 rounded-lg p-3 opacity-80 group-hover:opacity-100 transition">
          <p className="text-xs text-slate-400 leading-relaxed">{signal.analysis}</p>
        </div>

        {/* Action quality badge */}
        <div className="text-center">
          {signal.confidence >= 80 && signal.riskRewardRatio >= 2.5 ? (
            <span className="inline-block px-4 py-1.5 bg-profit/20 text-profit text-xs font-bold rounded-full border border-profit/30">
              🎯 SIGNAL FORT — Prêt à trader
            </span>
          ) : signal.confidence >= 65 ? (
            <span className="inline-block px-4 py-1.5 bg-gold-400/20 text-gold-400 text-xs font-bold rounded-full border border-gold-400/30">
              ⏳ Attendre confirmation
            </span>
          ) : (
            <span className="inline-block px-4 py-1.5 bg-dark-600 text-slate-400 text-xs font-bold rounded-full">
              ⚡ Signal faible — Éviter
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
