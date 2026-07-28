"use client";

import { useState } from "react";

type Instrument = "XAUUSD" | "NAS100" | "US30";

export default function Calculator() {
  const [instrument, setInstrument] = useState<Instrument>("XAUUSD");
  const [direction, setDirection] = useState<"BUY" | "SELL">("BUY");
  const [accountSize, setAccountSize] = useState(100000);
  const [riskPercent, setRiskPercent] = useState(1);
  const [entryPrice, setEntryPrice] = useState(2650);
  const [stopLoss, setStopLoss] = useState(2645);
  const [takeProfit, setTakeProfit] = useState(2665);
  const [result, setResult] = useState<{
    lotSize: number;
    riskAmount: number;
    potentialProfit: number;
    maxLots: number;
  } | null>(null);
  const [loading, setLoading] = useState(false);

  const instrumentDefaults: Record<Instrument, { entry: number; sl: number; tp: number }> = {
    XAUUSD: { entry: 2650, sl: 2645, tp: 2665 },
    NAS100: { entry: 21500, sl: 21450, tp: 21625 },
    US30: { entry: 42500, sl: 42450, tp: 42625 },
  };

  function handleInstrumentChange(inst: Instrument) {
    setInstrument(inst);
    const defaults = instrumentDefaults[inst];
    setEntryPrice(defaults.entry);
    setStopLoss(defaults.sl);
    setTakeProfit(defaults.tp);
  }

  async function calculate() {
    setLoading(true);
    try {
      const res = await fetch("/api/calculator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instrument,
          direction,
          accountSize,
          riskPercent,
          entryPrice,
          stopLoss,
          takeProfit,
        }),
      });
      const data = await res.json();
      setResult(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  const rr =
    Math.abs(takeProfit - entryPrice) /
    (Math.abs(entryPrice - stopLoss) || 1);
  const riskAmount = (accountSize * riskPercent) / 100;

  return (
    <div className="space-y-6 animate-slide-up">
      <div>
        <h2 className="text-2xl font-bold text-white">🧮 Calculateur de Position</h2>
        <p className="text-slate-400 text-sm mt-1">
          Calcul précis de la taille de position selon vos règles de risk management
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Input Form */}
        <div className="bg-dark-800 border border-dark-600 rounded-xl p-6 space-y-5">
          <h3 className="text-lg font-bold text-gold-400">Paramètres du Trade</h3>

          {/* Instrument */}
          <div>
            <label className="block text-sm text-slate-400 mb-2">Instrument</label>
            <div className="grid grid-cols-3 gap-2">
              {(["XAUUSD", "NAS100", "US30"] as Instrument[]).map((inst) => (
                <button
                  key={inst}
                  onClick={() => handleInstrumentChange(inst)}
                  className={`py-3 rounded-lg font-bold text-sm transition ${
                    instrument === inst
                      ? "bg-gold-400 text-dark-900"
                      : "bg-dark-700 text-slate-400 hover:text-white"
                  }`}
                >
                  {inst === "XAUUSD" ? "🥇 " : inst === "NAS100" ? "📈 " : "🏛️ "}
                  {inst}
                </button>
              ))}
            </div>
          </div>

          {/* Direction */}
          <div>
            <label className="block text-sm text-slate-400 mb-2">Direction</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setDirection("BUY")}
                className={`py-3 rounded-lg font-bold transition ${
                  direction === "BUY"
                    ? "bg-buy text-white"
                    : "bg-dark-700 text-slate-400 hover:text-white"
                }`}
              >
                ▲ BUY
              </button>
              <button
                onClick={() => setDirection("SELL")}
                className={`py-3 rounded-lg font-bold transition ${
                  direction === "SELL"
                    ? "bg-sell text-white"
                    : "bg-dark-700 text-slate-400 hover:text-white"
                }`}
              >
                ▼ SELL
              </button>
            </div>
          </div>

          {/* Account Size */}
          <div>
            <label className="block text-sm text-slate-400 mb-2">
              Taille du Compte ($)
            </label>
            <input
              type="number"
              value={accountSize}
              onChange={(e) => setAccountSize(Number(e.target.value))}
              className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-3 text-white focus:border-gold-400 outline-none"
            />
          </div>

          {/* Risk Percent */}
          <div>
            <label className="block text-sm text-slate-400 mb-2">
              Risque par Trade (%) — Recommandé: 0.5-2%
            </label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min="0.25"
                max="5"
                step="0.25"
                value={riskPercent}
                onChange={(e) => setRiskPercent(Number(e.target.value))}
                className="flex-1 accent-gold-400"
              />
              <span className="text-gold-400 font-bold text-lg w-16 text-right">
                {riskPercent}%
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Risque: ${riskAmount.toFixed(2)}
            </p>
          </div>

          {/* Prices */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Prix d&apos;entrée</label>
              <input
                type="number"
                step="0.01"
                value={entryPrice}
                onChange={(e) => setEntryPrice(Number(e.target.value))}
                className="w-full bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 text-white text-sm focus:border-gold-400 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs text-loss mb-1">Stop Loss</label>
              <input
                type="number"
                step="0.01"
                value={stopLoss}
                onChange={(e) => setStopLoss(Number(e.target.value))}
                className="w-full bg-dark-700 border border-red-900 rounded-lg px-3 py-2 text-loss text-sm focus:border-loss outline-none"
              />
            </div>
            <div>
              <label className="block text-xs text-profit mb-1">Take Profit</label>
              <input
                type="number"
                step="0.01"
                value={takeProfit}
                onChange={(e) => setTakeProfit(Number(e.target.value))}
                className="w-full bg-dark-700 border border-green-900 rounded-lg px-3 py-2 text-profit text-sm focus:border-profit outline-none"
              />
            </div>
          </div>

          <button
            onClick={calculate}
            disabled={loading}
            className="w-full py-4 bg-gradient-to-r from-gold-400 to-gold-600 text-dark-900 font-bold rounded-xl text-lg hover:shadow-lg hover:shadow-gold-400/20 transition disabled:opacity-50"
          >
            {loading ? "⏳ Calcul..." : "📐 Calculer la Position"}
          </button>
        </div>

        {/* Results */}
        <div className="space-y-4">
          {/* Quick R:R display */}
          <div className="bg-dark-800 border border-dark-600 rounded-xl p-6">
            <h3 className="text-lg font-bold text-gold-400 mb-4">📊 Ratio Risque / Récompense</h3>
            <div className="text-center">
              <p className="text-5xl font-bold text-white">
                1 : <span className={rr >= 2 ? "text-profit" : rr >= 1.5 ? "text-gold-400" : "text-loss"}>{rr.toFixed(1)}</span>
              </p>
              <p className="text-sm text-slate-400 mt-2">
                {rr >= 3
                  ? "🎯 Excellent ratio - Haute probabilité de succès"
                  : rr >= 2
                  ? "✅ Bon ratio - Conforme aux standards prop firm"
                  : rr >= 1.5
                  ? "⚠️ Ratio acceptable - Peut être amélioré"
                  : "❌ Ratio insuffisant - Augmentez le TP ou réduisez le SL"}
              </p>
            </div>
          </div>

          {/* Position size result */}
          {result && (
            <div className="bg-dark-800 border border-gold-400/30 rounded-xl p-6 space-y-4 pulse-glow">
              <h3 className="text-lg font-bold text-gold-400">✅ Résultat du Calcul</h3>

              <div className="grid grid-cols-2 gap-4">
                <div className="bg-dark-700 rounded-lg p-4 text-center">
                  <p className="text-xs text-slate-500">Taille de Position</p>
                  <p className="text-3xl font-bold text-gold-400">{result.lotSize}</p>
                  <p className="text-xs text-slate-500">lots</p>
                </div>
                <div className="bg-dark-700 rounded-lg p-4 text-center">
                  <p className="text-xs text-slate-500">Risque en $</p>
                  <p className="text-3xl font-bold text-loss">${result.riskAmount}</p>
                  <p className="text-xs text-slate-500">{riskPercent}% du compte</p>
                </div>
                <div className="bg-dark-700 rounded-lg p-4 text-center">
                  <p className="text-xs text-slate-500">Profit Potentiel</p>
                  <p className="text-3xl font-bold text-profit">
                    ${result.potentialProfit.toFixed(0)}
                  </p>
                  <p className="text-xs text-slate-500">au TP</p>
                </div>
                <div className="bg-dark-700 rounded-lg p-4 text-center">
                  <p className="text-xs text-slate-500">Lots Max (Daily)</p>
                  <p className="text-3xl font-bold text-signal">{result.maxLots}</p>
                  <p className="text-xs text-slate-500">limite daily loss</p>
                </div>
              </div>
            </div>
          )}

          {/* Risk tips */}
          <div className="bg-dark-800 border border-dark-600 rounded-xl p-6">
            <h3 className="text-lg font-bold text-gold-400 mb-3">💡 Conseils Risk Management</h3>
            <div className="space-y-2 text-sm text-slate-400">
              <p>• <span className="text-white font-medium">Règle 1%:</span> Ne risquez jamais plus de 1% par trade en phase de challenge</p>
              <p>• <span className="text-white font-medium">3 trades max:</span> Pas plus de 3 positions ouvertes simultanément</p>
              <p>• <span className="text-white font-medium">Ratio minimum 1:2.5:</span> Chaque trade doit avoir un R:R de 2.5 minimum</p>
              <p>• <span className="text-white font-medium">Daily loss rule:</span> Arrêtez si vous perdez 3% dans la journée</p>
              <p>• <span className="text-white font-medium">Scale out:</span> Fermez 50% au TP1, 30% au TP2, 20% au TP3</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
