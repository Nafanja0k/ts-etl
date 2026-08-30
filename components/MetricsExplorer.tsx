"use client";

import React, { useState, useEffect } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from "recharts";
import {
  Layers,
  Cpu,
  Zap,
  Tag,
  ArrowRight,
  TrendingDown,
  CheckCircle2,
  RefreshCw,
  Sparkles,
} from "lucide-react";

export const MetricsExplorer: React.FC = () => {
  const [metricType, setMetricType] = useState<string>("cpu");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    let isMounted = true;
    const loadMetricData = async () => {
      setLoading(true);
      try {
        const resp = await fetch(`/api/etl/metrics-query?type=${metricType}`);
        const json = await resp.json();
        if (isMounted) {
          setData(json);
        }
      } catch (e) {
        console.error(e);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };
    loadMetricData();
    return () => {
      isMounted = false;
    };
  }, [metricType]);

  return (
    <div className="space-y-6">
      
      {/* Metric Selector and Cardinality Stats */}
      <div className="p-6 rounded-2xl bg-slate-900/90 border border-slate-800">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-5 border-b border-slate-800">
          <div>
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <Layers className="w-4 h-4 text-cyan-400" />
              Source vs. Governed Target TSDB Visualizer
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Compare noisy raw metric ingestion streams against normalized, cardinality-governed Prometheus Remote-Write series.
            </p>
          </div>

          {/* Metric Selector Tabs */}
          <div className="flex items-center gap-1.5 p-1 rounded-xl bg-slate-950 border border-slate-800 text-xs">
            <button
              onClick={() => setMetricType("cpu")}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                metricType === "cpu"
                  ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Prometheus CPU Utilization
            </button>
            <button
              onClick={() => setMetricType("http")}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                metricType === "http"
                  ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Splunk O11y HTTP Requests
            </button>
            <button
              onClick={() => setMetricType("memory")}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                metricType === "memory"
                  ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Graphite Memory Ratio
            </button>
          </div>
        </div>

        {/* Cardinality Impact Metrics Grid */}
        {data && data.cardinality_impact && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-5">
            <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 flex items-center justify-between">
              <div>
                <div className="text-xs text-slate-400">Raw Ingested Cardinality</div>
                <div className="text-xl font-bold text-rose-400 font-mono mt-1">
                  ~{data.cardinality_impact.raw_series_count.toLocaleString()} series
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">With ephemeral pod/IP tags</div>
              </div>
              <div className="p-2 rounded-lg bg-rose-500/10 text-rose-400">
                <Tag className="w-5 h-5" />
              </div>
            </div>

            <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 flex items-center justify-between">
              <div>
                <div className="text-xs text-slate-400">Target Governed Cardinality</div>
                <div className="text-xl font-bold text-emerald-400 font-mono mt-1">
                  {data.cardinality_impact.governed_series_count} canonical series
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">Strict schema dimensions only</div>
              </div>
              <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
                <CheckCircle2 className="w-5 h-5" />
              </div>
            </div>

            <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 flex items-center justify-between">
              <div>
                <div className="text-xs text-slate-400">Cardinality Reduction</div>
                <div className="text-xl font-bold text-cyan-400 font-mono mt-1 flex items-center gap-1">
                  <TrendingDown className="w-5 h-5 text-cyan-400" />
                  {data.cardinality_impact.reduction_percentage}%
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">TSDB RAM & disk storage saved</div>
              </div>
              <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-400">
                <Zap className="w-5 h-5" />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Side-by-Side Time-Series Charts */}
      {data && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          
          {/* Raw Source TSDB Chart */}
          <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-semibold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                  Source Stream: <span className="font-mono text-amber-300">{data.source_name}</span>
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Raw pushdown query before dimension normalization & unit conversion
                </p>
              </div>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-amber-500/10 text-amber-300 border border-amber-500/20">
                Raw Input
              </span>
            </div>

            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.raw_points} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="time" stroke="#64748b" tick={{ fontSize: 10 }} />
                  <YAxis stroke="#64748b" tick={{ fontSize: 10 }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#0f172a", borderColor: "#334155", borderRadius: "8px", fontSize: "11px" }}
                  />
                  <Legend wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }} />
                  {metricType === "cpu" && (
                    <>
                      <Line type="monotone" dataKey="node_worker_01" stroke="#f59e0b" strokeWidth={1.5} dot={false} name="worker-01 (raw)" />
                      <Line type="monotone" dataKey="node_worker_02" stroke="#fbbf24" strokeWidth={1.5} dot={false} name="worker-02 (raw)" />
                      <Line type="monotone" dataKey="node_worker_03" stroke="#d97706" strokeWidth={1.5} dot={false} name="worker-03 (raw)" />
                    </>
                  )}
                  {metricType === "http" && (
                    <>
                      <Line type="monotone" dataKey="checkout_200" stroke="#10b981" strokeWidth={1.5} dot={false} name="checkout 200" />
                      <Line type="monotone" dataKey="gateway_404" stroke="#6366f1" strokeWidth={1.5} dot={false} name="gateway 404" />
                      <Line type="monotone" dataKey="checkout_500" stroke="#ef4444" strokeWidth={1.5} dot={false} name="checkout 500" />
                    </>
                  )}
                  {metricType === "memory" && (
                    <>
                      <Line type="monotone" dataKey="servers.us-east.metal-srv-01 (% used)" stroke="#f59e0b" strokeWidth={1.5} dot={false} />
                      <Line type="monotone" dataKey="servers.us-east.metal-srv-02 (% used)" stroke="#fbbf24" strokeWidth={1.5} dot={false} />
                    </>
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Governed Target TSDB Chart */}
          <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-semibold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                  Governed Target TSDB: <span className="font-mono text-emerald-300">{data.target_name}</span>
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Normalized units ({data.unit}), canonical dimensions, zero volatile tags
                </p>
              </div>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                Remote-Written
              </span>
            </div>

            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.normalized_points} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="time" stroke="#64748b" tick={{ fontSize: 10 }} />
                  <YAxis stroke="#64748b" tick={{ fontSize: 10 }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#0f172a", borderColor: "#334155", borderRadius: "8px", fontSize: "11px" }}
                  />
                  <Legend wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }} />
                  {metricType === "cpu" && (
                    <>
                      <Line type="monotone" dataKey="system.cpu.utilization (node-01)" stroke="#06b6d4" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="system.cpu.utilization (node-02)" stroke="#3b82f6" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="system.cpu.utilization (node-03)" stroke="#8b5cf6" strokeWidth={2} dot={false} />
                    </>
                  )}
                  {metricType === "http" && (
                    <>
                      <Line type="monotone" dataKey="http.server.requests [status=200, route=/api/v1/checkout]" stroke="#10b981" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="http.server.requests [status=500, route=/api/v1/checkout]" stroke="#f43f5e" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="http.server.requests [status=404, route=/legacy/endpoint]" stroke="#a855f7" strokeWidth={2} dot={false} />
                    </>
                  )}
                  {metricType === "memory" && (
                    <>
                      <Line type="monotone" dataKey="system.memory.utilization [host=srv-01, region=us-east]" stroke="#06b6d4" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="system.memory.utilization [host=srv-02, region=us-east]" stroke="#3b82f6" strokeWidth={2} dot={false} />
                    </>
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* Governance & Pruning Rule Details */}
      <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-3">
        <h3 className="text-xs font-semibold text-slate-200 uppercase tracking-wider">
          Cardinality & Tag Governance Breakdown
        </h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          
          {/* Dropped Volatile Tags */}
          <div className="p-4 rounded-xl bg-slate-950 border border-slate-800/80 space-y-2">
            <div className="font-semibold text-rose-400 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-rose-500"></span>
              Automatically Pruned Volatile Dimensions
            </div>
            <p className="text-slate-400 text-[11px]">
              These ephemeral dimensions are systematically stripped before serialization to prevent target TSDB index explosion:
            </p>
            <div className="flex flex-wrap gap-1.5 pt-1 font-mono text-[10px]">
              <span className="px-2 py-0.5 rounded bg-rose-500/10 text-rose-300 border border-rose-500/20">pod_uuid (GUID)</span>
              <span className="px-2 py-0.5 rounded bg-rose-500/10 text-rose-300 border border-rose-500/20">container_id (Docker)</span>
              <span className="px-2 py-0.5 rounded bg-rose-500/10 text-rose-300 border border-rose-500/20">client_ip (10.x.x.x)</span>
              <span className="px-2 py-0.5 rounded bg-rose-500/10 text-rose-300 border border-rose-500/20">trace_id (Hex)</span>
              <span className="px-2 py-0.5 rounded bg-rose-500/10 text-rose-300 border border-rose-500/20">span_id</span>
              <span className="px-2 py-0.5 rounded bg-rose-500/10 text-rose-300 border border-rose-500/20">thread_id</span>
            </div>
          </div>

          {/* Enforced Canonical Dimensions */}
          <div className="p-4 rounded-xl bg-slate-950 border border-slate-800/80 space-y-2">
            <div className="font-semibold text-emerald-400 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
              Enforced Canonical Target Dimensions
            </div>
            <p className="text-slate-400 text-[11px]">
              Validated against <code className="text-cyan-300 font-mono">target_metrics_schema.yaml</code>:
            </p>
            <div className="flex flex-wrap gap-1.5 pt-1 font-mono text-[10px]">
              <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">host.name</span>
              <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">service.name</span>
              <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">deployment.environment</span>
              <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">http.route</span>
              <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">http.response.status_code</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
