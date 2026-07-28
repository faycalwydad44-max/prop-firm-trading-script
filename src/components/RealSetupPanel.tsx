"use client";

import { useCallback, useEffect, useState } from "react";

type SetupResponse = {
  status: "WAIT" | "SETUP_VALID" | "ERROR";
  reason?: string;
  details?: Record<string, unknown>;
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
  priceSource?: string;
  execution?: string;
  warning?: string;
  generatedAt?: string;
};

export default function RealSetupPanel() {
  const [setup, setSetup] = useState<SetupResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const checkSetup = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/setup", {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error("Le moteur d'analyse ne repond pas.");
      }

      const data = (await response.json()) as SetupResponse;
      setSetup(data);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Erreur inconnue."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkSetup();

    const interval = window.setInterval(checkSetup, 30000);

    return () => window.clearInterval(interval);
  }, [checkSetup]);

  const generatedTime = setup?.generatedAt
    ? new Date(setup.generatedAt).toLocaleTimeString("fr-FR")
    : null;

  const detailEntries = Object.entries(setup?.details || {});

  return (
    <section className="rounded-xl border border-dark-600 bg-dark-800 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-gold-400">
            Moteur MT5 reel
          </p>

          <h2 className="mt-1 text-xl font-bold text-white">
            Setup XAUUSD
          </h2>

          <p className="mt-1 text-sm text-slate-400">
            Tendance H1, sweep M15 et confirmation FVG M5
          </p>
        </div>

        <button
          type="button"
          onClick={checkSetup}
          disabled={loading}
          className="rounded-lg bg-gold-400 px-4 py-2 text-sm font-bold text-dark-900 transition hover:bg-gold-500 disabled:opacity-50"
        >
          {loading ? "Analyse..." : "Verifier maintenant"}
        </button>
      </div>

      {error && (
        <div className="mt-5 border-l-2 border-red-500 pl-4">
          <p className="font-bold text-red-400">Erreur du moteur</p>
          <p className="mt-1 text-sm text-slate-400">{error}</p>
        </div>
      )}

      {!error && loading && !setup && (
        <p className="mt-6 text-sm text-slate-400">
          Lecture des bougies FTMO-MT5...
        </p>
      )}

      {!error && setup?.status === "WAIT" && (
        <div className="mt-6">
          <div className="flex items-center gap-3">
            <span className="h-3 w-3 rounded-full bg-gold-400" />

            <div>
              <p className="font-bold text-gold-400">
                ATTENDRE
              </p>
              <p className="text-sm text-slate-300">
                {setup.reason}
              </p>
            </div>
          </div>

          {detailEntries.length > 0 && (
            <dl className="mt-5 grid grid-cols-2 gap-x-8 gap-y-3 border-t border-dark-600 pt-4 md:grid-cols-4">
              {detailEntries.map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs uppercase text-slate-500">
                    {label}
                  </dt>
                  <dd className="mt-1 font-medium text-white">
                    {String(value)}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}

      {!error && setup?.status === "SETUP_VALID" && (
        <div className="mt-6">
          <div className="flex flex-wrap items-center gap-3">
            <span className="h-3 w-3 rounded-full bg-profit" />

            <p className="font-bold text-profit">
              SETUP VALIDE
            </p>

            <span
              className={
                setup.direction === "BUY"
                  ? "font-bold text-buy"
                  : "font-bold text-sell"
              }
            >
              {setup.direction}
            </span>

            <span className="text-sm text-slate-400">
              {setup.session}
            </span>
          </div>

          <dl className="mt-5 grid grid-cols-2 gap-4 border-y border-dark-600 py-5 md:grid-cols-5">
            <div>
              <dt className="text-xs uppercase text-slate-500">
                Entree
              </dt>
              <dd className="mt-1 text-lg font-bold text-white">
                {setup.entry}
              </dd>
            </div>

            <div>
              <dt className="text-xs uppercase text-slate-500">
                Stop Loss
              </dt>
              <dd className="mt-1 text-lg font-bold text-loss">
                {setup.stopLoss}
              </dd>
            </div>

            <div>
              <dt className="text-xs uppercase text-slate-500">
                Take Profit
              </dt>
              <dd className="mt-1 text-lg font-bold text-profit">
                {setup.takeProfit}
              </dd>
            </div>

            <div>
              <dt className="text-xs uppercase text-slate-500">
                R:R
              </dt>
              <dd className="mt-1 text-lg font-bold text-gold-400">
                1:{setup.riskReward}
              </dd>
            </div>

            <div>
              <dt className="text-xs uppercase text-slate-500">
                Risque conseille
              </dt>
              <dd className="mt-1 text-lg font-bold text-white">
                {setup.suggestedRiskPercent}%
              </dd>
            </div>
          </dl>

          <p className="mt-4 text-sm text-slate-400">
            Execution manuelle uniquement. Verifie toujours le setup
            dans MT5 avant toute decision.
          </p>
        </div>
      )}

      {!error && setup?.status === "ERROR" && (
        <div className="mt-5 border-l-2 border-red-500 pl-4">
          <p className="font-bold text-red-400">
            Analyse indisponible
          </p>
          <p className="mt-1 text-sm text-slate-400">
            {setup.reason}
          </p>
        </div>
      )}

      <div className="mt-5 flex flex-wrap justify-between gap-2 border-t border-dark-600 pt-4 text-xs text-slate-500">
        <span>Source : FTMO-MT5</span>
        <span>Actualisation : 30 secondes</span>
        {generatedTime && <span>Analyse : {generatedTime}</span>}
      </div>
    </section>
  );
}
