"use client";

import React, { useState } from "react";
import {
  Play,
  RefreshCw,
  Clock,
  Layers,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
  Zap,
  Filter,
  Flame,
  FileSpreadsheet,
  Terminal,
  Activity,
  Calendar,
} from "lucide-react";

interface PipelineStudioProps {
  onRunComplete?: () => void;
}

export const PipelineStudio: React.FC<PipelineStudioProps> = ({ onRunComplete }) => {
  const [selectedJob, setSelectedJob] = useState<string>("");
  const [outageHours, setOutageHours] = useState<number>(0);
  const [backfillMinutes, setBackfillMinutes] = useState<number>(0);
  const [injectQuarantine, setInjectQuarantine] = useState<boolean>(false);
  const [dryRun, setDryRun] = useState<boolean>(false);

  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [runResult, setRunResult] = useState<any>(null);
  const [logs, setLogs] = useState<any[]>([]);

  const handleExecute = async () => {
    setIsRunning(true);
    setRunResult(null);
    setLogs([]);

    try {
      const resp = await fetch("/api/etl/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: selectedJob || undefined,
          simulateOutageGapHours: outageHours > 0 ? outageHours : undefined,
          backfillStartMinutesAgo: backfillMinutes > 0 ? backfillMinutes : undefined,
          injectQuarantineError: injectQuarantine,
          dryRun,
        }),
      });

      const data = await resp.json();
      setRunResult(data);
      if (data.logs) {
        setLogs(data.logs);
      }
      if (onRunComplete) {
        onRunComplete();
      }
    } catch (e: any) {
      setLogs([
        {
          ts: new Date().toISOString(),
          level: "ERROR",
          message: `Network error triggering ETL: ${e.message}`,
        },
      ]);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      
      {/* Control Panel Card */}
      <div className="p-6 rounded-2xl bg-slate-900/90 border border-slate-800">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-5 border-b border-slate-800">
          <div>
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <Terminal className="w-4 h-4 text-cyan-400" />
              Ephemeral ETL Orchestrator & Gap Remediation Studio
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Trigger instant runs, simulate multi-hour cloud outages, test backfill bounds, and inspect step-by-step Nobl9 buffer mechanics.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              id="execute-studio-btn"
              onClick={handleExecute}
              disabled={isRunning}
              className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-semibold tracking-wide transition-all shadow-md ${
                isRunning
                  ? "bg-cyan-900/60 text-cyan-200 border border-cyan-700/60 cursor-not-allowed"
                  : "bg-cyan-600 hover:bg-cyan-500 text-white shadow-cyan-900/30 active:scale-95"
              }`}
            >
              {isRunning ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Executing Pull ETL Pipeline...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-current" />
                  Run Ephemeral ETL Cycle
                </>
              )}
            </button>
          </div>
        </div>

        {/* Studio Parameter Configuration Form */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mt-5">
          
          {/* Target Job Filter */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
              <Filter className="w-3.5 h-3.5 text-cyan-400" />
              Pipeline Scope
            </label>
            <select
              id="studio-job-select"
              value={selectedJob}
              onChange={(e) => setSelectedJob(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-cyan-500 font-mono"
            >
              <option value="">All Registered Jobs (Dynamic)</option>
              <option value="infra_k8s_prometheus">infra_k8s_prometheus (Prometheus)</option>
              <option value="apps_splunk_o11y">apps_splunk_o11y (Splunk O11y)</option>
              <option value="legacy_graphite_host_memory">legacy_graphite_host_memory (Graphite)</option>
            </select>
          </div>

          {/* Simulate Outage Gap Slider */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-amber-400" />
                Simulate Outage Gap
              </span>
              <span className="font-mono text-amber-400 text-[11px]">
                {outageHours === 0 ? "Normal (No Outage)" : `${outageHours}h gap (${outageHours * 4} slices)`}
              </span>
            </label>
            <input
              id="outage-hours-slider"
              type="range"
              min={0}
              max={12}
              step={1}
              value={outageHours}
              onChange={(e) => setOutageHours(parseInt(e.target.value))}
              className="w-full h-2 bg-slate-950 rounded-lg appearance-none cursor-pointer accent-amber-500"
            />
          </div>

          {/* Manual Backfill Minutes */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-sky-400" />
              Manual Backfill Start
            </label>
            <select
              id="studio-backfill-select"
              value={backfillMinutes}
              onChange={(e) => setBackfillMinutes(parseInt(e.target.value))}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-cyan-500 font-mono"
            >
              <option value={0}>From S3 Monotonic Watermark</option>
              <option value={30}>30 Minutes Ago (2 slices)</option>
              <option value={60}>1 Hour Ago (4 slices)</option>
              <option value={180}>3 Hours Ago (12 slices)</option>
              <option value={360}>6 Hours Ago (24 slices)</option>
            </select>
          </div>

          {/* Test Flags (Quarantine & Dry Run) */}
          <div className="space-y-2 pt-2">
            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={injectQuarantine}
                onChange={(e) => setInjectQuarantine(e.target.checked)}
                className="rounded bg-slate-950 border-slate-800 text-amber-500 focus:ring-0"
              />
              <span>Test Dead-Letter S3 Quarantine</span>
            </label>

            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={dryRun}
                onChange={(e) => setDryRun(e.target.checked)}
                className="rounded bg-slate-950 border-slate-800 text-cyan-500 focus:ring-0"
              />
              <span>Dry Run (No S3/TSDB mutations)</span>
            </label>
          </div>
        </div>
      </div>

      {/* Execution Results Overview (When Run Complete) */}
      {runResult && runResult.status === "SUCCESS" && (
        <div className="p-6 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-5 animate-fadeIn">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white">
                  Ephemeral Run Completed Successfully ({runResult.duration_ms}ms)
                </h3>
                <p className="text-xs text-slate-400 font-mono">
                  Runner: {runResult.runnerId} • S3 Lease Acquired & Released ($0.00 compute)
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="px-2.5 py-1 rounded-md text-xs font-mono bg-slate-800 border border-slate-700 text-cyan-300">
                {runResult.summary.total_slices} Slices Processed
              </span>
              <span className="px-2.5 py-1 rounded-md text-xs font-mono bg-slate-800 border border-slate-700 text-emerald-300">
                {runResult.summary.total_samples_exported} Samples Remote-Written
              </span>
            </div>
          </div>

          {/* Quick Metrics Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800">
              <div className="text-slate-400">Total Slices Processed</div>
              <div className="text-lg font-bold text-white font-mono mt-1">
                {runResult.summary.total_slices}
              </div>
            </div>
            <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800">
              <div className="text-slate-400">Metrics Exported</div>
              <div className="text-lg font-bold text-cyan-400 font-mono mt-1">
                {runResult.summary.total_metrics_exported}
              </div>
            </div>
            <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800">
              <div className="text-slate-400">Volatile Tags Pruned</div>
              <div className="text-lg font-bold text-purple-400 font-mono mt-1">
                {runResult.summary.total_dropped_tags}
              </div>
            </div>
            <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800">
              <div className="text-slate-400">Quarantined (Dead-Letter)</div>
              <div className="text-lg font-bold text-amber-400 font-mono mt-1">
                {runResult.summary.total_quarantined}
              </div>
            </div>
          </div>

          {/* Jobs & Slices Details Accordion / Table */}
          <div className="space-y-3">
            <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
              Processed Jobs & Sequential Slices
            </h4>
            
            <div className="space-y-3">
              {runResult.jobs_processed.map((jp: any) => (
                <div key={jp.job_id} className="p-4 rounded-xl bg-slate-950/80 border border-slate-800/80 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-white font-mono">{jp.job_id}</span>
                      <span className="px-1.5 py-0.5 rounded text-[10px] uppercase font-mono bg-slate-800 text-slate-300">
                        {jp.source_type}
                      </span>
                    </div>

                    <div className="flex items-center gap-3 text-slate-400 font-mono text-[11px]">
                      <span>{jp.slices_processed} slice(s)</span>
                      <span>•</span>
                      <span>{jp.samples_exported} samples</span>
                      <span>•</span>
                      <span className="text-purple-400">{jp.dropped_tags} tags trimmed</span>
                    </div>
                  </div>

                  {/* Slices detail breakdown */}
                  {jp.slices_detail && jp.slices_detail.length > 0 && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-[11px] text-left text-slate-300">
                        <thead className="bg-slate-900/60 text-slate-400 font-mono border-b border-slate-800">
                          <tr>
                            <th className="px-3 py-1.5">Slice Window [start &rarr; end)</th>
                            <th className="px-3 py-1.5">Raw Extracted</th>
                            <th className="px-3 py-1.5">Remote-Written</th>
                            <th className="px-3 py-1.5">Protobuf+Snappy Size</th>
                            <th className="px-3 py-1.5">State Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-900 font-mono">
                          {jp.slices_detail.map((s: any, idx: number) => (
                            <tr key={idx} className="hover:bg-slate-900/30">
                              <td className="px-3 py-2 text-cyan-300">
                                {s.start_iso.substring(11, 19)}Z → {s.end_iso.substring(11, 19)}Z
                              </td>
                              <td className="px-3 py-2">{s.raw_series} series</td>
                              <td className="px-3 py-2 text-emerald-400">{s.exported_samples} samples</td>
                              <td className="px-3 py-2 text-slate-400">{s.payload_bytes} bytes</td>
                              <td className="px-3 py-2">
                                <span className="inline-flex items-center gap-1 text-emerald-400 text-[10px]">
                                  <CheckCircle2 className="w-3 h-3" /> Checkpoint & Watermark Committed
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Lock Conflict Alert (When another runner is active) */}
      {runResult && runResult.status === "SKIPPED_LOCK_HELD" && (
        <div className="p-4 rounded-xl bg-amber-950/30 border border-amber-500/40 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div className="text-xs">
            <div className="font-semibold text-amber-300">Execution Skipped — Active S3 Distributed Lease Detected</div>
            <p className="text-amber-200/80 mt-1">
              Another orchestrator holds the lock on <code className="font-mono">s3://telemetry-etl-state/locks/orchestrator.lock</code>. 
              The engine automatically skips execution to prevent split-brain processing.
            </p>
          </div>
        </div>
      )}

      {/* Live Stream Logs Terminal */}
      <div className="p-5 rounded-2xl bg-slate-950 border border-slate-800 space-y-3 font-mono">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800 text-xs">
          <div className="flex items-center gap-2 text-slate-300">
            <Terminal className="w-3.5 h-3.5 text-cyan-400" />
            <span>Orchestrator Execution Logs</span>
          </div>
          <span className="text-[10px] text-slate-500">
            {logs.length} events logged
          </span>
        </div>

        <div className="max-h-80 overflow-y-auto space-y-1.5 text-[11px] pr-2 scrollbar-thin">
          {logs.length === 0 ? (
            <div className="text-slate-600 py-6 text-center italic">
              Ready to execute. Click &quot;Run Ephemeral ETL Cycle&quot; above to observe the live stream.
            </div>
          ) : (
            logs.map((item, idx) => {
              const levelColor =
                item.level === "SUCCESS"
                  ? "text-emerald-400"
                  : item.level === "WARN"
                  ? "text-amber-400"
                  : item.level === "ERROR"
                  ? "text-rose-400"
                  : "text-cyan-300";

              return (
                <div key={idx} className="flex items-start gap-2.5 leading-relaxed hover:bg-slate-900/50 p-1 rounded">
                  <span className="text-slate-500 shrink-0 select-none">
                    {item.ts.substring(11, 23)}
                  </span>
                  <span className={`font-bold shrink-0 text-[10px] px-1 rounded bg-slate-900 border border-slate-800 ${levelColor}`}>
                    {item.level}
                  </span>
                  {item.step && (
                    <span className="text-slate-400 text-[10px] shrink-0 font-semibold">
                      [{item.step}]
                    </span>
                  )}
                  <span className="text-slate-200">{item.message}</span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
