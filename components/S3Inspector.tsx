"use client";

import React, { useState, useEffect } from "react";
import {
  Database,
  Lock,
  Clock,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Trash2,
  Shield,
  FileCheck,
  Zap,
  FolderOpen,
} from "lucide-react";

export const S3Inspector: React.FC = () => {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const fetchS3State = async () => {
    setLoading(true);
    try {
      const resp = await fetch("/api/etl/s3-state");
      const json = await resp.json();
      setData(json);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let isMounted = true;
    const loadState = async () => {
      try {
        const resp = await fetch("/api/etl/s3-state");
        const json = await resp.json();
        if (isMounted) {
          setData(json);
        }
      } catch (e) {
        console.error(e);
      }
    };

    loadState();
    const interval = setInterval(loadState, 5000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  const triggerAction = async (action: string, payload?: any) => {
    setActionMsg(null);
    try {
      const resp = await fetch("/api/etl/s3-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
      });
      const res = await resp.json();
      setActionMsg(res.message || "Action executed");
      fetchS3State();
    } catch (e: any) {
      setActionMsg(`Error: ${e.message}`);
    }
  };

  return (
    <div className="space-y-6">
      
      {/* S3 State Store Overview Card */}
      <div className="p-6 rounded-2xl bg-slate-900/90 border border-slate-800">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-5 border-b border-slate-800">
          <div>
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <Database className="w-4 h-4 text-amber-400" />
              S3 Virtual Object Store & Lease Manager
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Live inspection of distributed lock files (<code className="text-amber-300 font-mono">locks/</code>), watermarks (<code className="text-cyan-300 font-mono">watermarks/</code>), and zero-byte audit checkpoints (<code className="text-emerald-300 font-mono">checkpoints/</code>).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={fetchS3State}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh S3 State
            </button>

            <button
              onClick={() => triggerAction("simulate_stale_lock")}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 transition-colors"
            >
              <Lock className="w-3.5 h-3.5" />
              Simulate Active Lock
            </button>

            <button
              onClick={() => triggerAction("clear_lock")}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
            >
              Release Lock
            </button>

            <button
              onClick={() => triggerAction("reset_watermarks", { hoursAgo: 3 })}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 border border-cyan-500/30 transition-colors"
            >
              <Clock className="w-3.5 h-3.5" />
              Reset Watermarks (3h Gap)
            </button>
          </div>
        </div>

        {actionMsg && (
          <div className="mt-4 p-2.5 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" />
            {actionMsg}
          </div>
        )}

        {/* Bucket Stats Badges */}
        {data && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5 text-xs">
            <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800">
              <div className="text-slate-400">Target S3 Bucket</div>
              <div className="text-sm font-bold text-amber-400 font-mono mt-1 truncate">
                s3://{data.bucket}
              </div>
            </div>
            <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800">
              <div className="text-slate-400">Active Distributed Locks</div>
              <div className="text-sm font-bold text-white font-mono mt-1">
                {data.locks.length > 0 ? (
                  <span className="text-amber-400 font-semibold flex items-center gap-1">
                    <Lock className="w-3.5 h-3.5" /> {data.locks.length} Active Lease ({data.locks[0].expires_in_sec}s TTL)
                  </span>
                ) : (
                  <span className="text-emerald-400">0 (Unlocked / Idle)</span>
                )}
              </div>
            </div>
            <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800">
              <div className="text-slate-400">Tracked Watermarks</div>
              <div className="text-sm font-bold text-cyan-400 font-mono mt-1">
                {data.watermarks.length} Pipelines
              </div>
            </div>
            <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800">
              <div className="text-slate-400">Committed Checkpoints</div>
              <div className="text-sm font-bold text-emerald-400 font-mono mt-1">
                {data.checkpoints.length} Slices Completed
              </div>
            </div>
          </div>
        )}
      </div>

      {/* S3 Key Prefixes Explorer */}
      {data && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          
          {/* Watermarks Inspector */}
          <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-xs font-semibold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                <Clock className="w-4 h-4 text-cyan-400" />
                s3://telemetry-etl-state/watermarks/
              </h3>
              <span className="text-[10px] font-mono text-slate-500">Monotonic Low-Watermarks</span>
            </div>

            <div className="space-y-2.5">
              {data.watermarks.map((wm: any) => (
                <div key={wm.key} className="p-3.5 rounded-xl bg-slate-950 border border-slate-800/80 font-mono text-xs space-y-1.5">
                  <div className="flex items-center justify-between text-slate-200 font-semibold">
                    <span className="text-cyan-300">{wm.key}</span>
                    <span className="text-[10px] text-slate-500 font-normal">Last committed</span>
                  </div>
                  <div className="text-slate-400 text-[11px] flex items-center justify-between">
                    <span>Watermark ISO:</span>
                    <span className="text-emerald-400">{wm.watermark_iso}</span>
                  </div>
                  <div className="text-slate-500 text-[10px] flex items-center justify-between">
                    <span>Timestamp Epoch:</span>
                    <span>{wm.watermark_timestamp}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Checkpoints Audit Inspector */}
          <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-xs font-semibold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                <FileCheck className="w-4 h-4 text-emerald-400" />
                s3://telemetry-etl-state/checkpoints/
              </h3>
              <span className="text-[10px] font-mono text-slate-500">Slice Completion Markers</span>
            </div>

            <div className="max-h-72 overflow-y-auto space-y-2 pr-1 scrollbar-thin">
              {data.checkpoints.length === 0 ? (
                <div className="text-slate-600 text-xs italic py-8 text-center font-mono">
                  No checkpoints recorded yet. Run the ETL cycle to generate audit markers.
                </div>
              ) : (
                data.checkpoints.map((cp: any, idx: number) => (
                  <div key={idx} className="p-2.5 rounded-lg bg-slate-950 border border-slate-800/70 font-mono text-[11px] flex items-center justify-between">
                    <div className="truncate mr-2">
                      <span className="text-emerald-400 font-semibold">✓ {cp.key}</span>
                      <div className="text-[10px] text-slate-500">
                        {cp.slice_start_iso} → {cp.slice_end_iso}
                      </div>
                    </div>
                    <span className="text-[10px] text-slate-400 shrink-0">
                      {cp.samples_count} samples
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Dead-Letter Quarantine Inspector */}
      {data && (
        <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <h3 className="text-xs font-semibold text-slate-200 uppercase tracking-wider flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              s3://telemetry-etl-state/deadletter/ (Quarantined Metric Stream)
            </h3>
            {data.deadletter.length > 0 && (
              <button
                onClick={() => triggerAction("clear_deadletter")}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] bg-rose-500/20 text-rose-300 hover:bg-rose-500/30 border border-rose-500/30 transition-colors"
              >
                <Trash2 className="w-3 h-3" /> Clear Quarantine
              </button>
            )}
          </div>

          {data.deadletter.length === 0 ? (
            <div className="text-slate-500 text-xs py-4 text-center font-mono">
              0 quarantined series. All incoming metrics strictly comply with Target Metrics Schema standards.
            </div>
          ) : (
            <div className="space-y-2">
              {data.deadletter.map((dl: any, idx: number) => (
                <div key={idx} className="p-3 rounded-xl bg-slate-950 border border-amber-500/30 font-mono text-xs space-y-1">
                  <div className="text-amber-300 font-semibold">{dl.key}</div>
                  <pre className="text-[11px] text-slate-300 bg-slate-900/80 p-2 rounded overflow-x-auto">
                    {JSON.stringify(dl, null, 2)}
                  </pre>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
