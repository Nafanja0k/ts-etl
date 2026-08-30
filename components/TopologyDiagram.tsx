"use client";

import React, { useState } from "react";
import {
  Clock,
  Lock,
  Database,
  Cpu,
  Layers,
  ArrowRight,
  Shield,
  Zap,
  CheckCircle2,
  AlertTriangle,
  FolderGit2,
  FileCode2,
  Archive,
  BarChart3,
  Server,
  Share2,
} from "lucide-react";

export const TopologyDiagram: React.FC = () => {
  const [activeStep, setActiveStep] = useState<number | null>(null);

  const steps = [
    {
      id: 1,
      title: "1. Ephemeral Trigger",
      badge: "Every 5 Mins",
      color: "border-sky-500/40 bg-sky-950/30 text-sky-300",
      icon: Clock,
      desc: "K8s CronJob / Cloud Run / GitHub Actions invokes an ephemeral container runner.",
      details: "Spawns container instance, runs single ETL cycle in <1s, and exits to reduce idle cloud compute bill to $0.00.",
    },
    {
      id: 2,
      title: "2. S3 Distributed Lease",
      badge: "Atomic IfNoneMatch",
      color: "border-amber-500/40 bg-amber-950/30 text-amber-300",
      icon: Lock,
      desc: "Acquires lease on s3://.../locks/orchestrator.lock with 300s TTL.",
      details: "Uses S3 conditional writes (IfNoneMatch: * or If-Match ETag) to prevent concurrent split-brain execution.",
    },
    {
      id: 3,
      title: "3. Nobl9 Safe Offset Buffer",
      badge: "t_now - 10m",
      color: "border-cyan-500/40 bg-cyan-950/30 text-cyan-300",
      icon: Shield,
      desc: "Calculates safe boundary t_safe = t_now - query_delay (10m) to bypass ingestion jitter.",
      details: "Queries use non-overlapping half-open intervals [t_start, t_end) ensuring zero duplicate or dropped data points.",
    },
    {
      id: 4,
      title: "4. Push-Down Downsample",
      badge: "Heterogeneous TSDBs",
      color: "border-indigo-500/40 bg-indigo-950/30 text-indigo-300",
      icon: Layers,
      desc: "Pushes downsampling to source: Prom (step), Graphite (summarize), Splunk (resolution).",
      details: "Minimizes network transfer by requesting pre-aggregated time slices directly from heterogeneous sources.",
    },
    {
      id: 5,
      title: "5. In-Memory Governance",
      badge: "Cardinality & Units",
      color: "border-purple-500/40 bg-purple-950/30 text-purple-300",
      icon: Cpu,
      desc: "Trims volatile tags (pod UUIDs, IPs), converts units (0-100% -> 0.0-1.0), validates schema.",
      details: "Non-compliant series without required dimensions are safely quarantined to S3 dead-letter prefix.",
    },
    {
      id: 6,
      title: "6. Prometheus Remote-Write",
      badge: "Protobuf + Snappy",
      color: "border-emerald-500/40 bg-emerald-950/30 text-emerald-300",
      icon: Zap,
      desc: "Batches up to 10,000 metrics per payload and POSTs to VictoriaMetrics/Mimir.",
      details: "Compressed wire format with standard types.proto / remote.proto WriteRequest messages.",
    },
    {
      id: 7,
      title: "7. S3 State Commit & Exit",
      badge: "Monotonic Advance",
      color: "border-teal-500/40 bg-teal-950/30 text-teal-300",
      icon: CheckCircle2,
      desc: "Puts zero-byte marker (.done), updates watermark JSON, releases S3 lock, and exits.",
      details: "Advances watermark strictly after successful remote-write; next run resumes seamlessly without gaps.",
    },
  ];

  return (
    <div className="space-y-6">
      
      {/* Architecture Highlights Banner */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 flex items-start gap-3.5">
          <div className="p-2.5 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white">Nobl9 Ingestion Integrity</h2>
            <p className="text-xs text-slate-400 mt-1">
              Strict Query Delay buffer (<code className="text-cyan-300">t_safe = t_now - 10m</code>) with half-open <code className="text-cyan-300">[t_start, t_end)</code> boundaries to eliminate ingestion jitter loss.
            </p>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 flex items-start gap-3.5">
          <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400">
            <Database className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white">Zero-Database S3 State</h2>
            <p className="text-xs text-slate-400 mt-1">
              Distributed leader lease (<code className="text-amber-300">locks/*.lock</code>), monotonic watermarks (<code className="text-amber-300">watermarks/*.json</code>), and zero-byte checkpoints (<code className="text-amber-300">*.done</code>).
            </p>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 flex items-start gap-3.5">
          <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
            <Zap className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white">Prometheus Remote-Write</h2>
            <p className="text-xs text-slate-400 mt-1">
              Push-down downsampling at the source, streaming in-memory transformation, and batch Protobuf+Snappy export to VictoriaMetrics / Mimir.
            </p>
          </div>
        </div>
      </div>

      {/* Visual Interactive Pipeline Map */}
      <div className="p-6 rounded-2xl bg-slate-900/90 border border-slate-800">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-6 pb-4 border-b border-slate-800">
          <div>
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <Share2 className="w-4 h-4 text-cyan-400" />
              End-to-End Pull-Based Telemetry Lifecycle
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Click any pipeline node to inspect technical specifications and mathematical boundaries.
            </p>
          </div>
          <span className="text-xs text-slate-500 font-mono">
            Specs: pipeline_registry.yaml • target_metrics_schema.yaml
          </span>
        </div>

        {/* Step Nodes Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3.5">
          {steps.map((step) => {
            const Icon = step.icon;
            const isSelected = activeStep === step.id;
            return (
              <div
                key={step.id}
                onClick={() => setActiveStep(isSelected ? null : step.id)}
                className={`p-4 rounded-xl border transition-all cursor-pointer relative ${step.color} ${
                  isSelected ? "ring-2 ring-cyan-400 shadow-lg scale-[1.02]" : "hover:border-slate-600"
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <Icon className="w-4 h-4" />
                    <span className="font-semibold text-xs tracking-wide">{step.title}</span>
                  </div>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-black/40 border border-white/10">
                    {step.badge}
                  </span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">{step.desc}</p>

                {isSelected && (
                  <div className="mt-3 pt-2.5 border-t border-white/10 text-[11px] text-slate-300">
                    <span className="font-semibold text-cyan-300">Deep Dive:</span> {step.details}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Heterogeneous Sources vs Governed Target TSDB Visualizer */}
        <div className="mt-6 pt-6 border-t border-slate-800 grid grid-cols-1 lg:grid-cols-3 gap-4 items-center">
          
          {/* Source TSDBs */}
          <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2.5">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
              <span className="flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-indigo-400" />
                Heterogeneous Source TSDBs
              </span>
              <span className="text-[10px] font-mono text-slate-500">Extract</span>
            </div>
            
            <div className="space-y-1.5 text-xs">
              <div className="p-2 rounded bg-slate-900 border border-slate-800 flex items-center justify-between">
                <span className="text-slate-300 font-mono">Prometheus</span>
                <span className="text-[10px] text-indigo-300 font-mono">/api/v1/query_range?step=1m</span>
              </div>
              <div className="p-2 rounded bg-slate-900 border border-slate-800 flex items-center justify-between">
                <span className="text-slate-300 font-mono">Splunk Observability</span>
                <span className="text-[10px] text-indigo-300 font-mono">/v2/datapoint?resolution=5m</span>
              </div>
              <div className="p-2 rounded bg-slate-900 border border-slate-800 flex items-center justify-between">
                <span className="text-slate-300 font-mono">Graphite Bare-Metal</span>
                <span className="text-[10px] text-indigo-300 font-mono">summarize(..., &apos;2m&apos;, &apos;avg&apos;)</span>
              </div>
            </div>
          </div>

          {/* Normalization & Cardinality Governor */}
          <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2.5">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
              <span className="flex items-center gap-1.5">
                <Cpu className="w-3.5 h-3.5 text-purple-400" />
                In-Memory Governance & Trimming
              </span>
              <span className="text-[10px] font-mono text-slate-500">Transform</span>
            </div>

            <div className="space-y-2 text-xs text-slate-400">
              <div className="flex items-center justify-between">
                <span>Unit Conversion:</span>
                <span className="text-cyan-300 font-mono">0-100% → 0.0-1.0 Ratio</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Cardinality Pruned:</span>
                <span className="text-purple-300 font-mono">Drop UUIDs, Pod IPs</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Dead-Letter Queue:</span>
                <span className="text-amber-300 font-mono">S3 Quarantine</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Buffer Footprint:</span>
                <span className="text-emerald-300 font-mono">&lt; 256MB (Streaming)</span>
              </div>
            </div>
          </div>

          {/* Target TSDB */}
          <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2.5">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
              <span className="flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-emerald-400" />
                Unified Target TSDB
              </span>
              <span className="text-[10px] font-mono text-emerald-400">Remote-Write</span>
            </div>

            <div className="space-y-1.5 text-xs">
              <div className="p-2 rounded bg-slate-900 border border-slate-800 flex items-center justify-between">
                <span className="text-slate-300 font-mono">VictoriaMetrics / Mimir</span>
                <span className="text-[10px] text-emerald-300 font-mono">/api/v1/write</span>
              </div>
              <div className="p-2 rounded bg-slate-900 border border-slate-800 flex items-center justify-between">
                <span className="text-slate-300 font-mono">Payload Serialization</span>
                <span className="text-[10px] text-emerald-300 font-mono">Protobuf + Snappy</span>
              </div>
              <div className="p-2 rounded bg-slate-900 border border-slate-800 flex items-center justify-between">
                <span className="text-slate-300 font-mono">Batching Policy</span>
                <span className="text-[10px] text-emerald-300 font-mono">10,000 metrics / POST</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
