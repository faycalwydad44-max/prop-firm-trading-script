"use client";

import RealSetupPanel from "./RealSetupPanel";

export default function Dashboard() {
  return (
    <div className="space-y-6 animate-slide-up">
      <header className="border-b border-dark-600 pb-5">
        <p className="text-xs font-bold uppercase tracking-widest text-gold-400">
          PropTrader / FTMO-MT5
        </p>

        <h1 className="mt-2 text-2xl font-bold text-white">
          Analyse réelle XAUUSD
        </h1>

        <p className="mt-2 text-sm text-slate-400">
          Seul le moteur ci-dessous doit être utilisé. Les anciens
          signaux simulés ont été retirés du Dashboard.
        </p>
      </header>

      <RealSetupPanel />

      <section className="border-l-2 border-gold-400 py-1 pl-4">
        <h2 className="font-bold text-white">
          Règle de décision
        </h2>

        <p className="mt-2 text-sm text-slate-400">
          ATTENDRE signifie : aucun trade.
        </p>

        <p className="mt-1 text-sm text-slate-400">
          SETUP VALIDE signifie : vérifier les niveaux dans MT5,
          puis décider manuellement sur le compte démo.
        </p>

        <p className="mt-1 text-sm text-slate-400">
          Risque maximal conseillé pendant les tests : 0,25 %.
        </p>
      </section>
    </div>
  );
}
