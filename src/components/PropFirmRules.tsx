"use client";

import { useState } from "react";

interface FirmRules {
  name: string;
  logo: string;
  phases: {
    phase: number;
    profitTarget: number;
    maxDailyLoss: number;
    maxTotalLoss: number;
    minTradingDays: number;
    maxTradingDays: number;
    leverage: string;
    newsTrading: boolean;
    weekendHolding: boolean;
    scalping: boolean;
  }[];
  tips: string[];
}

const FIRMS: FirmRules[] = [
  {
    name: "FTMO",
    logo: "🏢",
    phases: [
      {
        phase: 1,
        profitTarget: 10,
        maxDailyLoss: 5,
        maxTotalLoss: 10,
        minTradingDays: 4,
        maxTradingDays: 30,
        leverage: "1:100",
        newsTrading: true,
        weekendHolding: true,
        scalping: true,
      },
      {
        phase: 2,
        profitTarget: 5,
        maxDailyLoss: 5,
        maxTotalLoss: 10,
        minTradingDays: 4,
        maxTradingDays: 60,
        leverage: "1:100",
        newsTrading: true,
        weekendHolding: true,
        scalping: true,
      },
    ],
    tips: [
      "Concentrez-vous sur 1-2 instruments maximum",
      "Tradez pendant les Kill Zones (London/NY)",
      "Utilisez la règle du 1% de risque par trade",
      "Visez des R:R de 3:1 minimum sur Gold",
      "Ne tradez pas pendant les NFP/FOMC",
    ],
  },
  {
    name: "MyFundedFX",
    logo: "💰",
    phases: [
      {
        phase: 1,
        profitTarget: 8,
        maxDailyLoss: 5,
        maxTotalLoss: 12,
        minTradingDays: 5,
        maxTradingDays: 0,
        leverage: "1:100",
        newsTrading: true,
        weekendHolding: true,
        scalping: true,
      },
      {
        phase: 2,
        profitTarget: 5,
        maxDailyLoss: 5,
        maxTotalLoss: 12,
        minTradingDays: 5,
        maxTradingDays: 0,
        leverage: "1:100",
        newsTrading: true,
        weekendHolding: true,
        scalping: true,
      },
    ],
    tips: [
      "Pas de limite de jours - prenez votre temps",
      "Le drawdown trailing s'applique - attention",
      "Commencez petit et augmentez progressivement",
      "Journal chaque trade pour l'amélioration",
    ],
  },
  {
    name: "The Funded Trader",
    logo: "🎯",
    phases: [
      {
        phase: 1,
        profitTarget: 8,
        maxDailyLoss: 5,
        maxTotalLoss: 10,
        minTradingDays: 3,
        maxTradingDays: 35,
        leverage: "1:100",
        newsTrading: false,
        weekendHolding: false,
        scalping: true,
      },
      {
        phase: 2,
        profitTarget: 5,
        maxDailyLoss: 5,
        maxTotalLoss: 10,
        minTradingDays: 3,
        maxTradingDays: 60,
        leverage: "1:100",
        newsTrading: false,
        weekendHolding: false,
        scalping: true,
      },
    ],
    tips: [
      "Pas de trading pendant les news high-impact",
      "Fermez les positions avant le weekend",
      "3 jours minimum de trading requis",
      "Soyez consistant dans votre approche",
    ],
  },
  {
    name: "E8 Funding",
    logo: "⚡",
    phases: [
      {
        phase: 1,
        profitTarget: 8,
        maxDailyLoss: 5,
        maxTotalLoss: 8,
        minTradingDays: 0,
        maxTradingDays: 0,
        leverage: "1:100",
        newsTrading: true,
        weekendHolding: true,
        scalping: true,
      },
      {
        phase: 2,
        profitTarget: 5,
        maxDailyLoss: 5,
        maxTotalLoss: 8,
        minTradingDays: 0,
        maxTradingDays: 0,
        leverage: "1:100",
        newsTrading: true,
        weekendHolding: true,
        scalping: true,
      },
    ],
    tips: [
      "Drawdown max très serré à 8% - soyez conservateur",
      "Pas de limite de jours - opportunité",
      "Risquez max 0.5% par trade en raison du drawdown",
      "Focus sur des setups à haute probabilité uniquement",
    ],
  },
  {
    name: "Funding Pips",
    logo: "📊",
    phases: [
      {
        phase: 1,
        profitTarget: 8,
        maxDailyLoss: 5,
        maxTotalLoss: 10,
        minTradingDays: 3,
        maxTradingDays: 0,
        leverage: "1:100",
        newsTrading: true,
        weekendHolding: true,
        scalping: true,
      },
      {
        phase: 2,
        profitTarget: 5,
        maxDailyLoss: 5,
        maxTotalLoss: 10,
        minTradingDays: 3,
        maxTradingDays: 0,
        leverage: "1:100",
        newsTrading: true,
        weekendHolding: true,
        scalping: true,
      },
    ],
    tips: [
      "Scaling plan disponible - commencez petit",
      "Pas de limite de durée pour le challenge",
      "Conditions souples pour le news trading",
      "Idéal pour les stratégies swing trading",
    ],
  },
];

export default function PropFirmRules() {
  const [selectedFirm, setSelectedFirm] = useState(0);
  const firm = FIRMS[selectedFirm];

  return (
    <div className="space-y-6 animate-slide-up">
      <div>
        <h2 className="text-2xl font-bold text-white">📋 Règles des Prop Firms</h2>
        <p className="text-slate-400 text-sm mt-1">
          Comparaison détaillée des règles de chaque prop firm
        </p>
      </div>

      {/* Firm selector */}
      <div className="flex gap-2 flex-wrap">
        {FIRMS.map((f, i) => (
          <button
            key={i}
            onClick={() => setSelectedFirm(i)}
            className={`px-5 py-3 rounded-xl font-medium text-sm transition flex items-center gap-2 ${
              selectedFirm === i
                ? "bg-gold-400 text-dark-900 shadow-lg shadow-gold-400/20"
                : "bg-dark-800 border border-dark-600 text-slate-400 hover:text-white hover:border-gold-400/30"
            }`}
          >
            <span className="text-xl">{f.logo}</span>
            {f.name}
          </button>
        ))}
      </div>

      {/* Selected firm details */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {firm.phases.map((phase) => (
          <div
            key={phase.phase}
            className="bg-dark-800 border border-dark-600 rounded-xl overflow-hidden"
          >
            <div className="bg-dark-700 px-5 py-3 flex items-center justify-between">
              <h3 className="text-lg font-bold text-white">
                {firm.logo} {firm.name} - Phase {phase.phase}
              </h3>
              <span className="bg-gold-400 text-dark-900 px-3 py-1 rounded-full text-xs font-bold">
                Phase {phase.phase}
              </span>
            </div>

            <div className="p-5 space-y-4">
              {/* Main rules */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-dark-700 rounded-lg p-3 text-center">
                  <p className="text-xs text-slate-500">🎯 Objectif Profit</p>
                  <p className="text-2xl font-bold text-profit">{phase.profitTarget}%</p>
                </div>
                <div className="bg-dark-700 rounded-lg p-3 text-center">
                  <p className="text-xs text-slate-500">📉 Perte Max Journalière</p>
                  <p className="text-2xl font-bold text-loss">{phase.maxDailyLoss}%</p>
                </div>
                <div className="bg-dark-700 rounded-lg p-3 text-center">
                  <p className="text-xs text-slate-500">⚠️ Perte Max Totale</p>
                  <p className="text-2xl font-bold text-loss">{phase.maxTotalLoss}%</p>
                </div>
                <div className="bg-dark-700 rounded-lg p-3 text-center">
                  <p className="text-xs text-slate-500">⚡ Levier</p>
                  <p className="text-2xl font-bold text-gold-400">{phase.leverage}</p>
                </div>
              </div>

              {/* Trading days */}
              <div className="flex justify-between text-sm bg-dark-700 rounded-lg p-3">
                <span className="text-slate-400">Jours min de trading:</span>
                <span className="text-white font-bold">
                  {phase.minTradingDays || "Aucun"}
                </span>
              </div>
              <div className="flex justify-between text-sm bg-dark-700 rounded-lg p-3">
                <span className="text-slate-400">Durée max du challenge:</span>
                <span className="text-white font-bold">
                  {phase.maxTradingDays ? `${phase.maxTradingDays} jours` : "Illimité"}
                </span>
              </div>

              {/* Restrictions */}
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">News Trading</span>
                  <span className={phase.newsTrading ? "text-profit" : "text-loss"}>
                    {phase.newsTrading ? "✅ Autorisé" : "❌ Interdit"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Holding Weekend</span>
                  <span className={phase.weekendHolding ? "text-profit" : "text-loss"}>
                    {phase.weekendHolding ? "✅ Autorisé" : "❌ Interdit"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Scalping</span>
                  <span className={phase.scalping ? "text-profit" : "text-loss"}>
                    {phase.scalping ? "✅ Autorisé" : "❌ Interdit"}
                  </span>
                </div>
              </div>

              {/* Quick math for account sizes */}
              <div className="bg-dark-900 rounded-lg p-4">
                <p className="text-xs text-gold-400 font-bold mb-2">💰 Calcul Rapide (Compte $100K)</p>
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div>
                    <p className="text-slate-500">Objectif $</p>
                    <p className="text-profit font-bold">${(100000 * phase.profitTarget / 100).toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-slate-500">Perte Max/Jour $</p>
                    <p className="text-loss font-bold">${(100000 * phase.maxDailyLoss / 100).toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-slate-500">Perte Max Total $</p>
                    <p className="text-loss font-bold">${(100000 * phase.maxTotalLoss / 100).toLocaleString()}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Tips */}
      <div className="bg-dark-800 border border-gold-400/20 rounded-xl p-6">
        <h3 className="text-lg font-bold text-gold-400 mb-4">
          💡 Conseils pour {firm.name}
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {firm.tips.map((tip, i) => (
            <div key={i} className="flex items-start gap-2 text-sm">
              <span className="text-gold-400 mt-0.5">▸</span>
              <span className="text-slate-300">{tip}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Comparison table */}
      <div className="bg-dark-800 border border-dark-600 rounded-xl overflow-hidden">
        <div className="px-5 py-3 bg-dark-700">
          <h3 className="text-lg font-bold text-white">📊 Comparaison Rapide (Phase 1)</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-dark-700 text-slate-400 text-xs uppercase">
                <th className="px-4 py-3 text-left">Prop Firm</th>
                <th className="px-4 py-3 text-center">Profit Target</th>
                <th className="px-4 py-3 text-center">Daily Loss</th>
                <th className="px-4 py-3 text-center">Total Loss</th>
                <th className="px-4 py-3 text-center">Min Jours</th>
                <th className="px-4 py-3 text-center">Durée Max</th>
                <th className="px-4 py-3 text-center">News</th>
              </tr>
            </thead>
            <tbody>
              {FIRMS.map((f, i) => (
                <tr
                  key={i}
                  className={`border-t border-dark-600 ${
                    i === selectedFirm ? "bg-gold-400/5" : ""
                  }`}
                >
                  <td className="px-4 py-3 font-bold text-white">
                    {f.logo} {f.name}
                  </td>
                  <td className="px-4 py-3 text-center text-profit font-bold">
                    {f.phases[0].profitTarget}%
                  </td>
                  <td className="px-4 py-3 text-center text-loss font-bold">
                    {f.phases[0].maxDailyLoss}%
                  </td>
                  <td className="px-4 py-3 text-center text-loss font-bold">
                    {f.phases[0].maxTotalLoss}%
                  </td>
                  <td className="px-4 py-3 text-center text-white">
                    {f.phases[0].minTradingDays || "—"}
                  </td>
                  <td className="px-4 py-3 text-center text-white">
                    {f.phases[0].maxTradingDays ? `${f.phases[0].maxTradingDays}j` : "∞"}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {f.phases[0].newsTrading ? "✅" : "❌"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
