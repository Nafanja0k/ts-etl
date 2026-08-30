"use client";

import React from "react";
import { Activity, Database, Lock, Server, ShieldCheck, Play, RefreshCw } from "lucide-react";

interface HeaderProps {
  onTriggerRun: () => void;
  isRunning: boolean;
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

export const Header: React.FC<HeaderProps> = ({
  onTriggerRun,
  isRunning,
  activeTab,
  setActiveTab,
}) => {
  return (
    <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          
          {/* Brand & Subtitle */}
          <div className="flex items-center space-x-3.5">
            <div className="h-10 w-10 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shadow-inner">
              <Activity className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base sm:text-lg font-semibold tracking-tight text-white flex items-center gap-2">
                  Nobl9-Inspired Telemetry ETL & Backfill Engine
                </h1>
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  Zero-DB / Serverless
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Stateless Pull-Based Aggregation • S3 Distributed Locking • Prometheus Remote-Write
              </p>
            </div>
          </div>

          {/* Quick Metrics Badges & Action Trigger */}
          <div className="flex flex-wrap items-center gap-2.5">
            
            {/* Nobl9 Query Delay Offset */}
            <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800/80 border border-slate-700/60 text-xs">
              <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />
              <span className="text-slate-400">Nobl9 Buffer:</span>
              <span className="font-mono font-medium text-cyan-300">t_now - 10m</span>
            </div>

            {/* S3 Zero-DB Badge */}
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800/80 border border-slate-700/60 text-xs">
              <Database className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-slate-400">State:</span>
              <span className="font-mono text-amber-300">S3 Only (No RDBMS)</span>
            </div>

            {/* Idle Compute Badge */}
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800/80 border border-slate-700/60 text-xs">
              <Server className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-slate-400">Idle Cost:</span>
              <span className="font-mono text-emerald-400 font-semibold">$0.00</span>
            </div>

            {/* Run ETL Cycle Button */}
            <button
              id="trigger-etl-button"
              onClick={onTriggerRun}
              disabled={isRunning}
              className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all shadow-sm ${
                isRunning
                  ? "bg-cyan-900/50 text-cyan-300 border border-cyan-700/50 cursor-not-allowed"
                  : "bg-cyan-600 hover:bg-cyan-500 text-white shadow-cyan-900/20 active:scale-95"
              }`}
            >
              {isRunning ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  Running ETL Pipeline...
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5 fill-current" />
                  Execute Ephemeral Run
                </>
              )}
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center space-x-1 mt-3.5 pt-2 border-t border-slate-800/80 overflow-x-auto text-xs">
          {[
            { id: "overview", label: "Architecture Topology" },
            { id: "studio", label: "Pipeline & Gap Studio" },
            { id: "metrics", label: "Live TSDB & Metric Governance" },
            { id: "specs", label: "Declarative Spec Registry" },
            { id: "s3", label: "S3 State Store Browser" },
            { id: "code", label: "Python Engine & Deployment" },
          ].map((tab) => (
            <button
              key={tab.id}
              id={`nav-tab-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-1.5 rounded-md font-medium whitespace-nowrap transition-colors ${
                activeTab === tab.id
                  ? "bg-cyan-500/15 text-cyan-400 border border-cyan-500/30"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
    </header>
  );
};
