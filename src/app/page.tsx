"use client";

import { useState } from "react";
import Sidebar from "@/components/Sidebar";
import Dashboard from "@/components/Dashboard";
import SignalsPanel from "@/components/SignalsPanel";
import ChallengesPanel from "@/components/ChallengesPanel";
import Calculator from "@/components/Calculator";
import TradeJournal from "@/components/TradeJournal";
import PropFirmRules from "@/components/PropFirmRules";
import LiveTicker from "@/components/LiveTicker";

export default function Home() {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [alertCount, setAlertCount] = useState(0);

  const renderContent = () => {
    switch (activeTab) {
      case "dashboard":
        return <Dashboard />;
      case "signals":
        return <SignalsPanel />;
      case "challenges":
        return <ChallengesPanel />;
      case "calculator":
        return <Calculator />;
      case "journal":
        return <TradeJournal />;
      case "rules":
        return <PropFirmRules />;
      default:
        return <Dashboard />;
    }
  };

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />
      <main className="flex-1 overflow-y-auto">
        {/* Top bar with live ticker */}
        <div className="sticky top-0 z-10 bg-dark-900/90 backdrop-blur-xl border-b border-dark-600 px-6 py-2.5">
          <div className="flex items-center justify-between gap-4">
            <LiveTicker
              onNewSignal={() => setAlertCount((c) => c + 1)}
            />
            <div className="flex items-center gap-3 shrink-0">
              {alertCount > 0 && (
                <button
                  onClick={() => setAlertCount(0)}
                  className="relative px-2.5 py-1 rounded-lg bg-gold-400/10 text-gold-400 text-xs font-medium hover:bg-gold-400/20 transition"
                >
                  🔔
                  <span className="absolute -top-1 -right-1 w-4 h-4 bg-loss text-white text-xs rounded-full flex items-center justify-center">
                    {alertCount}
                  </span>
                </button>
              )}
              <span className="text-xs text-slate-500 hidden lg:inline">
                {new Date().toLocaleDateString("fr-FR", {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                })}
              </span>
              <div className="w-8 h-8 bg-gradient-to-br from-gold-400 to-gold-600 rounded-full flex items-center justify-center text-dark-900 font-bold text-xs">
                PT
              </div>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-6">{renderContent()}</div>
      </main>
    </div>
  );
}
