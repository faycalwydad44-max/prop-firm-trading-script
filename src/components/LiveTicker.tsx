"use client";

import { useEffect, useState, useCallback } from "react";

interface MarketPrice {
  instrument: string;
  price: number;
  direction: string;
  confidence: number;
}

interface LiveTickerProps {
  onNewSignal?: () => void;
}

export default function LiveTicker({ onNewSignal }: LiveTickerProps) {
  const [prices, setPrices] = useState<MarketPrice[]>([]);
  const [countdown, setCountdown] = useState(30);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const fetchPrices = useCallback(async () => {
    try {
      const res = await fetch("/api/analysis");
      const data = await res.json();
      if (data.marketOverview) {
        const newPrices = data.marketOverview.map((s: MarketPrice) => ({
          instrument: s.instrument,
          price: s.price,
          direction: s.direction,
          confidence: s.confidence,
        }));

        // Check if direction changed for flash effect
        if (prices.length > 0) {
          newPrices.forEach((np: MarketPrice) => {
            const old = prices.find((p) => p.instrument === np.instrument);
            if (old && old.direction !== np.direction) {
              setFlash(np.instrument);
              setTimeout(() => setFlash(null), 2000);
              onNewSignal?.();
            }
          });
        }

        setPrices(newPrices);
        setLastUpdate(new Date());
        setCountdown(30);
      }
    } catch (e) {
      console.error(e);
    }
  }, [prices, onNewSignal]);

  useEffect(() => {
    fetchPrices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          fetchPrices();
          return 30;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchPrices]);

  return (
    <div className="flex items-center gap-3 flex-wrap">
      {/* Live indicator */}
      <div className="flex items-center gap-2">
        <div
          className={`w-2.5 h-2.5 rounded-full ${
            autoRefresh ? "bg-profit animate-pulse" : "bg-slate-500"
          }`}
        />
        <span className="text-xs text-slate-400">
          {autoRefresh ? "LIVE" : "PAUSED"}
        </span>
      </div>

      {/* Price tickers */}
      <div className="hidden md:flex items-center gap-2">
        {prices.map((p) => {
          const emoji =
            p.instrument === "XAUUSD" ? "🥇" : p.instrument === "NAS100" ? "📈" : "🏛️";
          const isFlashing = flash === p.instrument;
          return (
            <div
              key={p.instrument}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition-all duration-300 ${
                isFlashing
                  ? "bg-gold-400/20 border-gold-400 scale-105"
                  : "bg-dark-800 border-dark-600"
              }`}
            >
              <span className="text-sm">{emoji}</span>
              <span className="text-white font-medium text-xs">{p.instrument}</span>
              <span className="text-slate-400 text-xs">{p.price.toFixed(p.instrument === "XAUUSD" ? 2 : 0)}</span>
              <span
                className={`text-xs font-bold ${
                  p.direction === "BUY" ? "text-buy" : "text-sell"
                }`}
              >
                {p.direction === "BUY" ? "▲" : "▼"}
              </span>
            </div>
          );
        })}
      </div>

      {/* Countdown & controls */}
      <div className="flex items-center gap-2 ml-auto">
        {autoRefresh && (
          <div className="flex items-center gap-1.5">
            <div className="w-16 h-1.5 bg-dark-600 rounded-full overflow-hidden">
              <div
                className="h-full bg-gold-400 rounded-full transition-all duration-1000"
                style={{ width: `${(countdown / 30) * 100}%` }}
              />
            </div>
            <span className="text-xs text-slate-500 w-6 text-right">{countdown}s</span>
          </div>
        )}
        <button
          onClick={() => setAutoRefresh(!autoRefresh)}
          className={`px-2.5 py-1 rounded text-xs font-medium transition ${
            autoRefresh
              ? "bg-profit/20 text-profit hover:bg-profit/30"
              : "bg-dark-700 text-slate-400 hover:text-white"
          }`}
          title={autoRefresh ? "Pause auto-refresh" : "Activer auto-refresh"}
        >
          {autoRefresh ? "⏸" : "▶"}
        </button>
        <button
          onClick={fetchPrices}
          className="px-2.5 py-1 rounded text-xs font-medium bg-dark-700 text-slate-400 hover:text-white transition"
          title="Rafraîchir maintenant"
        >
          🔄
        </button>
      </div>

      {/* Last update */}
      {lastUpdate && (
        <span className="text-xs text-slate-600 hidden lg:inline">
          {lastUpdate.toLocaleTimeString("fr-FR")}
        </span>
      )}
    </div>
  );
}
