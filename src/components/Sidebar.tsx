"use client";

import { useState } from "react";

interface SidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

const navItems = [
  { id: "dashboard", label: "Dashboard", icon: "📊" },
  { id: "signals", label: "Signaux Trading", icon: "📡" },
  { id: "challenges", label: "Challenges", icon: "🏆" },
  { id: "calculator", label: "Calculateur", icon: "🧮" },
  { id: "journal", label: "Journal", icon: "📓" },
  { id: "rules", label: "Règles Prop Firm", icon: "📋" },
];

export default function Sidebar({ activeTab, onTabChange }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={`${
        collapsed ? "w-20" : "w-64"
      } bg-dark-800 border-r border-dark-600 flex flex-col transition-all duration-300 shrink-0`}
    >
      {/* Logo */}
      <div className="p-4 border-b border-dark-600 flex items-center gap-3">
        <div className="w-10 h-10 bg-gradient-to-br from-gold-400 to-gold-600 rounded-lg flex items-center justify-center text-dark-900 font-bold text-lg shrink-0">
          PT
        </div>
        {!collapsed && (
          <div>
            <h1 className="text-gold-400 font-bold text-lg leading-tight">PropTrader</h1>
            <p className="text-xs text-slate-500">Pro Edition</p>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onTabChange(item.id)}
            className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-all ${
              activeTab === item.id
                ? "bg-dark-600 text-gold-400 border-r-2 border-gold-400"
                : "text-slate-400 hover:bg-dark-700 hover:text-slate-200"
            }`}
          >
            <span className="text-xl shrink-0">{item.icon}</span>
            {!collapsed && <span className="text-sm font-medium">{item.label}</span>}
          </button>
        ))}
      </nav>

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="p-4 border-t border-dark-600 text-slate-500 hover:text-slate-300 text-sm"
      >
        {collapsed ? "→" : "← Réduire"}
      </button>
    </aside>
  );
}
