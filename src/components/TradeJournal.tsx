"use client";

import { useEffect, useState } from "react";

interface Trade {
  id: string;
  instrument: string;
  direction: string;
  entryPrice: number;
  exitPrice: number | null;
  stopLoss: number;
  takeProfit: number;
  lotSize: number;
  pnl: number | null;
  status: string;
  strategy: string | null;
  notes: string | null;
  riskRewardRatio: number | null;
  openedAt: string;
  closedAt: string | null;
}

type Instrument = "XAUUSD" | "NAS100" | "US30";

export default function TradeJournal() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    instrument: "XAUUSD" as Instrument,
    direction: "BUY" as "BUY" | "SELL",
    entryPrice: 2650,
    stopLoss: 2645,
    takeProfit: 2665,
    lotSize: 0.5,
    strategy: "SMC",
    notes: "",
  });
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetchTrades();
  }, []);

  async function fetchTrades() {
    try {
      const res = await fetch("/api/trades");
      const data = await res.json();
      setTrades(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
    }
  }

  async function createTrade() {
    setCreating(true);
    try {
      await fetch("/api/trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      await fetchTrades();
      setShowForm(false);
    } catch (e) {
      console.error(e);
    } finally {
      setCreating(false);
    }
  }

  const totalPnl = trades.reduce((sum, t) => sum + (t.pnl || 0), 0);
  const winningTrades = trades.filter((t) => (t.pnl || 0) > 0).length;
  const winRate = trades.length > 0 ? (winningTrades / trades.length) * 100 : 0;

  return (
    <div className="space-y-6 animate-slide-up">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white">📓 Journal de Trading</h2>
          <p className="text-slate-400 text-sm mt-1">
            Enregistrez et analysez tous vos trades
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-6 py-3 bg-gradient-to-r from-gold-400 to-gold-600 text-dark-900 font-bold rounded-xl hover:shadow-lg hover:shadow-gold-400/20 transition"
        >
          ➕ Nouveau Trade
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-dark-800 border border-dark-600 rounded-xl p-4 text-center">
          <p className="text-xs text-slate-500">Total Trades</p>
          <p className="text-2xl font-bold text-white">{trades.length}</p>
        </div>
        <div className="bg-dark-800 border border-dark-600 rounded-xl p-4 text-center">
          <p className="text-xs text-slate-500">Win Rate</p>
          <p className={`text-2xl font-bold ${winRate >= 50 ? "text-profit" : "text-loss"}`}>
            {winRate.toFixed(1)}%
          </p>
        </div>
        <div className="bg-dark-800 border border-dark-600 rounded-xl p-4 text-center">
          <p className="text-xs text-slate-500">P&L Total</p>
          <p className={`text-2xl font-bold ${totalPnl >= 0 ? "text-profit" : "text-loss"}`}>
            {totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(2)}
          </p>
        </div>
        <div className="bg-dark-800 border border-dark-600 rounded-xl p-4 text-center">
          <p className="text-xs text-slate-500">Trades Gagnants</p>
          <p className="text-2xl font-bold text-profit">{winningTrades}</p>
        </div>
      </div>

      {/* New Trade Form */}
      {showForm && (
        <div className="bg-dark-800 border border-gold-400/30 rounded-xl p-6 space-y-4">
          <h3 className="text-lg font-bold text-gold-400">Enregistrer un Trade</h3>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Instrument</label>
              <select
                value={formData.instrument}
                onChange={(e) =>
                  setFormData({ ...formData, instrument: e.target.value as Instrument })
                }
                className="w-full bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 text-white text-sm outline-none focus:border-gold-400"
              >
                <option value="XAUUSD">🥇 XAUUSD</option>
                <option value="NAS100">📈 NAS100</option>
                <option value="US30">🏛️ US30</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Direction</label>
              <div className="grid grid-cols-2 gap-1">
                <button
                  onClick={() => setFormData({ ...formData, direction: "BUY" })}
                  className={`py-2 rounded text-xs font-bold ${
                    formData.direction === "BUY" ? "bg-buy text-white" : "bg-dark-600 text-slate-400"
                  }`}
                >
                  BUY
                </button>
                <button
                  onClick={() => setFormData({ ...formData, direction: "SELL" })}
                  className={`py-2 rounded text-xs font-bold ${
                    formData.direction === "SELL" ? "bg-sell text-white" : "bg-dark-600 text-slate-400"
                  }`}
                >
                  SELL
                </button>
              </div>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Prix d&apos;entrée</label>
              <input
                type="number"
                step="0.01"
                value={formData.entryPrice}
                onChange={(e) => setFormData({ ...formData, entryPrice: Number(e.target.value) })}
                className="w-full bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 text-white text-sm outline-none"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Lot Size</label>
              <input
                type="number"
                step="0.01"
                value={formData.lotSize}
                onChange={(e) => setFormData({ ...formData, lotSize: Number(e.target.value) })}
                className="w-full bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 text-white text-sm outline-none"
              />
            </div>
            <div>
              <label className="block text-xs text-loss mb-1">Stop Loss</label>
              <input
                type="number"
                step="0.01"
                value={formData.stopLoss}
                onChange={(e) => setFormData({ ...formData, stopLoss: Number(e.target.value) })}
                className="w-full bg-dark-700 border border-red-900 rounded-lg px-3 py-2 text-loss text-sm outline-none"
              />
            </div>
            <div>
              <label className="block text-xs text-profit mb-1">Take Profit</label>
              <input
                type="number"
                step="0.01"
                value={formData.takeProfit}
                onChange={(e) => setFormData({ ...formData, takeProfit: Number(e.target.value) })}
                className="w-full bg-dark-700 border border-green-900 rounded-lg px-3 py-2 text-profit text-sm outline-none"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Stratégie</label>
              <select
                value={formData.strategy}
                onChange={(e) => setFormData({ ...formData, strategy: e.target.value })}
                className="w-full bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 text-white text-sm outline-none"
              >
                <option value="SMC">SMC</option>
                <option value="ICT">ICT</option>
                <option value="ORDER_BLOCK">Order Block</option>
                <option value="FVG">Fair Value Gap</option>
                <option value="LIQUIDITY_SWEEP">Liquidity Sweep</option>
                <option value="BOS">Break of Structure</option>
                <option value="CHOCH">CHoCH</option>
                <option value="SUPPLY_DEMAND">Supply & Demand</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Notes</label>
              <input
                type="text"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="Notes sur le trade..."
                className="w-full bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 text-white text-sm outline-none"
              />
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
              onClick={createTrade}
              disabled={creating}
              className="px-6 py-2 bg-gold-400 text-dark-900 font-bold rounded-lg hover:bg-gold-500 transition disabled:opacity-50"
            >
              {creating ? "Enregistrement..." : "Enregistrer le Trade"}
            </button>
          </div>
        </div>
      )}

      {/* Trades Table */}
      {trades.length === 0 ? (
        <div className="text-center py-20 bg-dark-800 rounded-xl border border-dark-600">
          <p className="text-6xl mb-4">📓</p>
          <p className="text-slate-400 text-lg">Aucun trade enregistré</p>
          <p className="text-slate-500 text-sm mt-2">
            Commencez à journaliser vos trades pour analyser vos performances
          </p>
        </div>
      ) : (
        <div className="bg-dark-800 border border-dark-600 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-dark-700 text-slate-400 text-xs uppercase">
                  <th className="px-4 py-3 text-left">Date</th>
                  <th className="px-4 py-3 text-left">Instrument</th>
                  <th className="px-4 py-3 text-center">Direction</th>
                  <th className="px-4 py-3 text-right">Entrée</th>
                  <th className="px-4 py-3 text-right">SL</th>
                  <th className="px-4 py-3 text-right">TP</th>
                  <th className="px-4 py-3 text-center">Lots</th>
                  <th className="px-4 py-3 text-center">R:R</th>
                  <th className="px-4 py-3 text-center">Stratégie</th>
                  <th className="px-4 py-3 text-center">Statut</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((trade) => (
                  <tr key={trade.id} className="border-t border-dark-600 hover:bg-dark-700/50">
                    <td className="px-4 py-3 text-slate-400">
                      {new Date(trade.openedAt).toLocaleDateString("fr-FR")}
                    </td>
                    <td className="px-4 py-3 font-bold text-white">{trade.instrument}</td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-bold ${
                          trade.direction === "BUY"
                            ? "bg-buy/20 text-buy"
                            : "bg-sell/20 text-sell"
                        }`}
                      >
                        {trade.direction}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-white">
                      {trade.entryPrice.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-right text-loss">
                      {trade.stopLoss.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-right text-profit">
                      {trade.takeProfit.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-center text-white">{trade.lotSize}</td>
                    <td className="px-4 py-3 text-center text-gold-400 font-bold">
                      1:{trade.riskRewardRatio?.toFixed(1) || "—"}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="text-xs bg-dark-600 px-2 py-0.5 rounded text-slate-300">
                        {trade.strategy || "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`text-xs px-2 py-0.5 rounded font-bold ${
                          trade.status === "open"
                            ? "bg-blue-900/30 text-signal"
                            : trade.status === "won"
                            ? "bg-green-900/30 text-profit"
                            : trade.status === "lost"
                            ? "bg-red-900/30 text-loss"
                            : "bg-dark-600 text-slate-400"
                        }`}
                      >
                        {trade.status.toUpperCase()}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
