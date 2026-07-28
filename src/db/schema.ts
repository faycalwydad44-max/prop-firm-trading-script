import {
  pgTable,
  text,
  timestamp,
  doublePrecision,
  integer,
  boolean,
  uuid,
  varchar,
  jsonb,
} from "drizzle-orm/pg-core";

export const propFirmChallenges = pgTable("prop_firm_challenges", {
  id: uuid("id").defaultRandom().primaryKey(),
  firmName: varchar("firm_name", { length: 100 }).notNull(),
  accountSize: doublePrecision("account_size").notNull(),
  phase: integer("phase").notNull().default(1),
  profitTarget: doublePrecision("profit_target").notNull(),
  maxDailyLoss: doublePrecision("max_daily_loss").notNull(),
  maxTotalLoss: doublePrecision("max_total_loss").notNull(),
  currentBalance: doublePrecision("current_balance").notNull(),
  currentPnl: doublePrecision("current_pnl").notNull().default(0),
  status: varchar("status", { length: 20 }).notNull().default("active"),
  startDate: timestamp("start_date").notNull().defaultNow(),
  endDate: timestamp("end_date"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const trades = pgTable("trades", {
  id: uuid("id").defaultRandom().primaryKey(),
  challengeId: uuid("challenge_id").references(() => propFirmChallenges.id),
  instrument: varchar("instrument", { length: 20 }).notNull(),
  direction: varchar("direction", { length: 10 }).notNull(),
  entryPrice: doublePrecision("entry_price").notNull(),
  exitPrice: doublePrecision("exit_price"),
  stopLoss: doublePrecision("stop_loss").notNull(),
  takeProfit: doublePrecision("take_profit").notNull(),
  lotSize: doublePrecision("lot_size").notNull(),
  pnl: doublePrecision("pnl").default(0),
  status: varchar("status", { length: 20 }).notNull().default("open"),
  strategy: varchar("strategy", { length: 50 }),
  notes: text("notes"),
  riskRewardRatio: doublePrecision("risk_reward_ratio"),
  openedAt: timestamp("opened_at").notNull().defaultNow(),
  closedAt: timestamp("closed_at"),
});

export const tradingSignals = pgTable("trading_signals", {
  id: uuid("id").defaultRandom().primaryKey(),
  instrument: varchar("instrument", { length: 20 }).notNull(),
  direction: varchar("direction", { length: 10 }).notNull(),
  entryZone: doublePrecision("entry_zone").notNull(),
  stopLoss: doublePrecision("stop_loss").notNull(),
  takeProfit1: doublePrecision("take_profit_1").notNull(),
  takeProfit2: doublePrecision("take_profit_2"),
  takeProfit3: doublePrecision("take_profit_3"),
  strategy: varchar("strategy", { length: 50 }).notNull(),
  confidence: integer("confidence").notNull(),
  timeframe: varchar("timeframe", { length: 10 }).notNull(),
  analysis: text("analysis"),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const dailyStats = pgTable("daily_stats", {
  id: uuid("id").defaultRandom().primaryKey(),
  challengeId: uuid("challenge_id").references(() => propFirmChallenges.id),
  date: timestamp("date").notNull().defaultNow(),
  startBalance: doublePrecision("start_balance").notNull(),
  endBalance: doublePrecision("end_balance").notNull(),
  dailyPnl: doublePrecision("daily_pnl").notNull().default(0),
  tradesCount: integer("trades_count").notNull().default(0),
  winRate: doublePrecision("win_rate").default(0),
});
