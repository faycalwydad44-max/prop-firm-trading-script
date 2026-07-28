"use client";

import { useEffect, useState } from "react";

interface Challenge {
  id: string;
  firmName: string;
  accountSize: number;
  phase: number;
  profitTarget: number;
  maxDailyLoss: number;
  maxTotalLoss: number;
  currentBalance: number;
  currentPnl: number;
  status: string;
  startDate: string;
  createdAt: string;
}

const PROP_FIRM_PRESETS = [
  {
    name: "FTMO",
    sizes: [10000, 25000, 50000, 100000, 200000],
    phase1: { profitTarget: 10, maxDailyLoss: 5, maxTotalLoss: 10 },
    phase2: { profitTarget: 5, maxDailyLoss: 5, maxTotalLoss: 10 },
  },
  {
    name: "MyFundedFX",
    sizes: [5000, 10000, 25000, 50000, 100000],
    phase1: { profitTarget: 8, maxDailyLoss: 5, maxTotalLoss: 12 },
    phase2: { profitTarget: 5, maxDailyLoss: 5, maxTotalLoss: 12 },
  },
  {
    name: "TFT (The Funded Trader)",
    sizes: [5000, 10000, 25000, 50000, 100000, 200000],
    phase1: { profitTarget: 8, maxDailyLoss: 5, maxTotalLoss: 10 },
    phase2: { profitTarget: 5, maxDailyLoss: 5, maxTotalLoss: 10 },
  },
  {
    name: "E8 Funding",
    sizes: [25000, 50000, 100000, 250000],
    phase1: { profitTarget: 8, maxDailyLoss: 5, maxTotalLoss: 8 },
    phase2: { profitTarget: 5, maxDailyLoss: 5, maxTotalLoss: 8 },
  },
  {
    name: "Funding Pips",
    sizes: [5000, 10000, 25000, 50000, 100000],
    phase1: { profitTarget: 8, maxDailyLoss: 5, maxTotalLoss: 10 },
    phase2: { profitTarget: 5, maxDailyLoss: 5, maxTotalLoss: 10 },
  },
  {
    name: "Autre (Custom)",
    sizes: [10000, 25000, 50000, 100000, 200000],
    phase1: { profitTarget: 8, maxDailyLoss: 5, maxTotalLoss: 10 },
    phase2: { profitTarget: 5, maxDailyLoss: 5, maxTotalLoss: 10 },
  },
];

export default function ChallengesPanel() {
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [selectedFirm, setSelectedFirm] = useState(0);
  const [selectedSize, setSelectedSize] = useState(0);
  const [phase, setPhase] = useState(1);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetchChallenges();
  }, []);

  async function fetchChallenges() {
    try {
      const res = await fetch("/api/challenges");
      const data = await res.json();
      setChallenges(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
    }
  }

  async function createChallenge() {
    setCreating(true);
    const firm = PROP_FIRM_PRESETS[selectedFirm];
    const rules = phase === 1 ? firm.phase1 : firm.phase2;

    try {
      await fetch("/api/challenges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firmName: firm.name,
          accountSize: firm.sizes[selectedSize],
          phase,
          profitTarget: rules.profitTarget,
          maxDailyLoss: rules.maxDailyLoss,
          maxTotalLoss: rules.maxTotalLoss,
        }),
      });
      await fetchChallenges();
      setShowForm(false);
    } catch (e) {
      console.error(e);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-6 animate-slide-up">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white">🏆 Challenges Prop Firm</h2>
          <p className="text-slate-400 text-sm mt-1">
            Gérez vos challenges et suivez votre progression
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-6 py-3 bg-gradient-to-r from-gold-400 to-gold-600 text-dark-900 font-bold rounded-xl hover:shadow-lg hover:shadow-gold-400/20 transition"
        >
          ➕ Nouveau Challenge
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <div className="bg-dark-800 border border-gold-400/30 rounded-xl p-6 space-y-4">
          <h3 className="text-lg font-bold text-gold-400">Configurer un nouveau challenge</h3>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Firm selection */}
            <div>
              <label className="block text-sm text-slate-400 mb-2">Prop Firm</label>
              <select
                value={selectedFirm}
                onChange={(e) => {
                  setSelectedFirm(Number(e.target.value));
                  setSelectedSize(0);
                }}
                className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-3 text-white focus:border-gold-400 outline-none"
              >
                {PROP_FIRM_PRESETS.map((f, i) => (
                  <option key={i} value={i}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Account size */}
            <div>
              <label className="block text-sm text-slate-400 mb-2">Taille du compte</label>
              <select
                value={selectedSize}
                onChange={(e) => setSelectedSize(Number(e.target.value))}
                className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-3 text-white focus:border-gold-400 outline-none"
              >
                {PROP_FIRM_PRESETS[selectedFirm].sizes.map((s, i) => (
                  <option key={i} value={i}>
                    ${s.toLocaleString()}
                  </option>
                ))}
              </select>
            </div>

            {/* Phase */}
            <div>
              <label className="block text-sm text-slate-400 mb-2">Phase</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setPhase(1)}
                  className={`flex-1 py-3 rounded-lg font-bold transition ${
                    phase === 1
                      ? "bg-gold-400 text-dark-900"
                      : "bg-dark-700 text-slate-400 hover:text-white"
                  }`}
                >
                  Phase 1
                </button>
                <button
                  onClick={() => setPhase(2)}
                  className={`flex-1 py-3 rounded-lg font-bold transition ${
                    phase === 2
                      ? "bg-gold-400 text-dark-900"
                      : "bg-dark-700 text-slate-400 hover:text-white"
                  }`}
                >
                  Phase 2
                </button>
              </div>
            </div>
          </div>

          {/* Preview rules */}
          <div className="bg-dark-700 rounded-lg p-4">
            <p className="text-sm text-slate-400 mb-2">Règles du challenge :</p>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-xs text-slate-500">Objectif Profit</p>
                <p className="text-profit font-bold text-lg">
                  {(phase === 1
                    ? PROP_FIRM_PRESETS[selectedFirm].phase1
                    : PROP_FIRM_PRESETS[selectedFirm].phase2
                  ).profitTarget}
                  %
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Perte Max/Jour</p>
                <p className="text-loss font-bold text-lg">
                  {(phase === 1
                    ? PROP_FIRM_PRESETS[selectedFirm].phase1
                    : PROP_FIRM_PRESETS[selectedFirm].phase2
                  ).maxDailyLoss}
                  %
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Perte Max Totale</p>
                <p className="text-loss font-bold text-lg">
                  {(phase === 1
                    ? PROP_FIRM_PRESETS[selectedFirm].phase1
                    : PROP_FIRM_PRESETS[selectedFirm].phase2
                  ).maxTotalLoss}
                  %
                </p>
              </div>
            </div>
          </div>

          <div className="flex gap-3 justify-end">
            <button
              onClick={() => setShowForm(false)}
              className="px-6 py-2 bg-dark-700 text-slate-400 rounded-lg hover:text-white transition"
            >
              Annuler
            </button>
            <button
              onClick={createChallenge}
              disabled={creating}
              className="px-6 py-2 bg-gold-400 text-dark-900 font-bold rounded-lg hover:bg-gold-500 transition disabled:opacity-50"
            >
              {creating ? "Création..." : "Créer le Challenge"}
            </button>
          </div>
        </div>
      )}

      {/* Challenge cards */}
      {challenges.length === 0 ? (
        <div className="text-center py-20 bg-dark-800 rounded-xl border border-dark-600">
          <p className="text-6xl mb-4">🏆</p>
          <p className="text-slate-400 text-lg">Aucun challenge en cours</p>
          <p className="text-slate-500 text-sm mt-2">
            Créez votre premier challenge pour commencer le suivi
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {challenges.map((ch) => (
            <ChallengeCard key={ch.id} challenge={ch} />
          ))}
        </div>
      )}
    </div>
  );
}

function ChallengeCard({ challenge }: { challenge: Challenge }) {
  const pnlPercent = (challenge.currentPnl / challenge.accountSize) * 100;
  const profitProgress = Math.max(0, (pnlPercent / challenge.profitTarget) * 100);
  const drawdownUsed = Math.max(0, (-pnlPercent / challenge.maxTotalLoss) * 100);
  const daysActive = Math.max(
    1,
    Math.floor((Date.now() - new Date(challenge.startDate).getTime()) / 86400000)
  );

  const statusColor =
    challenge.status === "active"
      ? "text-profit"
      : challenge.status === "passed"
      ? "text-gold-400"
      : "text-loss";

  return (
    <div className="bg-dark-800 border border-dark-600 rounded-xl overflow-hidden">
      <div className="p-5 border-b border-dark-600 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold text-white">{challenge.firmName}</h3>
          <p className="text-sm text-slate-400">
            Phase {challenge.phase} • ${challenge.accountSize.toLocaleString()}
          </p>
        </div>
        <span className={`font-bold text-sm ${statusColor}`}>
          {challenge.status.toUpperCase()}
        </span>
      </div>

      <div className="p-5 space-y-4">
        {/* Balance */}
        <div className="text-center">
          <p className="text-xs text-slate-500">Balance Actuelle</p>
          <p className="text-3xl font-bold text-white">
            ${challenge.currentBalance.toLocaleString()}
          </p>
          <p className={`text-sm font-bold ${pnlPercent >= 0 ? "text-profit" : "text-loss"}`}>
            {pnlPercent >= 0 ? "+" : ""}
            {pnlPercent.toFixed(2)}%
          </p>
        </div>

        {/* Progress bars */}
        <div className="space-y-3">
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-slate-400">Objectif Profit ({challenge.profitTarget}%)</span>
              <span className="text-profit">{profitProgress.toFixed(1)}%</span>
            </div>
            <div className="h-2 bg-dark-600 rounded-full overflow-hidden">
              <div
                className="h-full bg-profit rounded-full transition-all"
                style={{ width: `${Math.min(100, profitProgress)}%` }}
              />
            </div>
          </div>
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-slate-400">
                Drawdown Max ({challenge.maxTotalLoss}%)
              </span>
              <span className={drawdownUsed > 60 ? "text-loss" : "text-gold-400"}>
                {drawdownUsed.toFixed(1)}%
              </span>
            </div>
            <div className="h-2 bg-dark-600 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  drawdownUsed > 60 ? "bg-loss" : "bg-gold-400"
                }`}
                style={{ width: `${Math.min(100, drawdownUsed)}%` }}
              />
            </div>
          </div>
        </div>

        {/* Info grid */}
        <div className="grid grid-cols-3 gap-3 text-center text-xs">
          <div className="bg-dark-700 rounded-lg p-2">
            <p className="text-slate-500">Jours actifs</p>
            <p className="text-white font-bold">{daysActive}</p>
          </div>
          <div className="bg-dark-700 rounded-lg p-2">
            <p className="text-slate-500">Perte Max/Jour</p>
            <p className="text-loss font-bold">{challenge.maxDailyLoss}%</p>
          </div>
          <div className="bg-dark-700 rounded-lg p-2">
            <p className="text-slate-500">Objectif $</p>
            <p className="text-profit font-bold">
              ${((challenge.accountSize * challenge.profitTarget) / 100).toLocaleString()}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
