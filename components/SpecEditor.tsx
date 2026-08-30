"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  FileCode2,
  Save,
  CheckCircle2,
  AlertTriangle,
  Play,
  Layers,
  Sparkles,
  RefreshCw,
  Copy,
  Check,
} from "lucide-react";

export const SpecEditor: React.FC = () => {
  const [specs, setSpecs] = useState<Record<string, any>>({});
  const [selectedKey, setSelectedKey] = useState<string>("registry");
  const [activeContent, setActiveContent] = useState<string>("");
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);

  // Playground tester
  const [playgroundInput, setPlaygroundInput] = useState<string>(
    JSON.stringify(
      {
        metric_name: "node_cpu_seconds_total",
        tags: {
          instance: "node-worker-01.prod.cloud",
          app: "k8s-core",
          env: "production",
          region: "us-east-1",
          pod_uuid: "fa821-39a0-48bf",
          container_id: "docker://1a2b3c4d5e",
          ip: "10.244.1.18",
        },
        raw_value: 78.4,
      },
      null,
      2
    )
  );
  const [playgroundOutput, setPlaygroundOutput] = useState<any>(null);

  const fetchSpecs = useCallback(async () => {
    try {
      const resp = await fetch("/api/etl/specs");
      const data = await resp.json();
      if (data.specs) {
        setSpecs(data.specs);
        if (data.specs[selectedKey]) {
          setActiveContent(data.specs[selectedKey].content);
        }
      }
    } catch (e) {
      console.error(e);
    }
  }, [selectedKey]);

  useEffect(() => {
    let isMounted = true;
    const loadInitial = async () => {
      try {
        const resp = await fetch("/api/etl/specs");
        const data = await resp.json();
        if (isMounted && data.specs) {
          setSpecs(data.specs);
          if (data.specs["registry"]) {
            setActiveContent(data.specs["registry"].content);
          }
        }
      } catch (e) {
        console.error(e);
      }
    };
    loadInitial();
    return () => {
      isMounted = false;
    };
  }, []);

  const handleSelectTab = (key: string) => {
    setSelectedKey(key);
    setSaveStatus(null);
    setErrorMessage(null);
    if (specs[key]) {
      setActiveContent(specs[key].content);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveStatus(null);
    setErrorMessage(null);

    try {
      const resp = await fetch("/api/etl/specs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ specKey: selectedKey, content: activeContent }),
      });

      const res = await resp.json();
      if (resp.ok) {
        setSaveStatus("Spec saved and validated successfully");
        fetchSpecs();
      } else {
        setErrorMessage(res.error || "Failed to save spec");
      }
    } catch (e: any) {
      setErrorMessage(e.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestTransformation = () => {
    try {
      const input = JSON.parse(playgroundInput);
      const droppedTags: string[] = [];
      const cleanedLabels: Record<string, string> = {
        "__name__": "system.cpu.utilization",
      };

      // Apply mapping logic
      if (input.tags) {
        for (const [k, v] of Object.entries(input.tags)) {
          if (["pod_uuid", "container_id", "ip", "client_ip", "trace_id", "span_id"].includes(k)) {
            droppedTags.push(k);
          } else if (k === "instance") {
            cleanedLabels["host.name"] = String(v);
          } else if (k === "app") {
            cleanedLabels["service.name"] = String(v);
          } else if (k === "env") {
            cleanedLabels["deployment.environment"] = String(v);
          } else if (k === "region") {
            cleanedLabels["cloud.region"] = String(v);
          } else {
            cleanedLabels[k] = String(v);
          }
        }
      }

      // Check required schema
      const required = ["host.name", "service.name", "deployment.environment"];
      const missing = required.filter((r) => !cleanedLabels[r]);

      if (missing.length > 0) {
        setPlaygroundOutput({
          status: "QUARANTINED_DEADLETTER",
          reason: `Missing required canonical dimensions: ${JSON.stringify(missing)}`,
          action: "Put into s3://telemetry-etl-state/deadletter/...",
        });
        return;
      }

      // Unit conversion
      const normalizedValue = typeof input.raw_value === "number" && input.raw_value > 1.0
        ? parseFloat((input.raw_value / 100.0).toFixed(4))
        : input.raw_value;

      setPlaygroundOutput({
        status: "COMPLIANT_TARGET_METRIC",
        metric_name: "system.cpu.utilization",
        normalized_value: normalizedValue,
        governed_labels: cleanedLabels,
        dropped_volatile_tags: droppedTags,
        remote_write_protobuf: {
          labels_count: Object.keys(cleanedLabels).length,
          samples_count: 1,
          wire_status: "Ready for Protobuf+Snappy batching",
        },
      });
    } catch (e: any) {
      setPlaygroundOutput({ error: `JSON Parse error: ${e.message}` });
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(activeContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6">
      
      {/* Spec Editor Main Card */}
      <div className="p-6 rounded-2xl bg-slate-900/90 border border-slate-800">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-5 border-b border-slate-800">
          <div>
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <FileCode2 className="w-4 h-4 text-cyan-400" />
              Declarative Pipeline & Schema Registry
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Inspect and tune YAML specifications for job chunking, Nobl9 query delay, dimension mappings, and target schema standards.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? "Copied" : "Copy YAML"}
            </button>

            <button
              onClick={handleSave}
              disabled={isSaving}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-white shadow-sm transition-all active:scale-95"
            >
              {isSaving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Save Spec
            </button>
          </div>
        </div>

        {/* Spec Tabs */}
        <div className="flex items-center gap-2 pt-4 pb-3 overflow-x-auto text-xs">
          {[
            { id: "registry", label: "pipeline_registry.yaml", desc: "Jobs & Buffer Config" },
            { id: "schema", label: "target_metrics_schema.yaml", desc: "Canonical Standards" },
            { id: "mapping_k8s", label: "mappings/k8s_prom.yaml", desc: "Prometheus Mapping" },
            { id: "mapping_splunk", label: "mappings/splunk_apps.yaml", desc: "Splunk Mapping" },
            { id: "mapping_graphite", label: "mappings/graphite_infra.yaml", desc: "Graphite Mapping" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => handleSelectTab(tab.id)}
              className={`px-3 py-2 rounded-xl text-left font-mono transition-colors whitespace-nowrap ${
                selectedKey === tab.id
                  ? "bg-slate-950 text-cyan-300 border border-cyan-500/40 shadow-sm"
                  : "bg-slate-950/40 text-slate-400 hover:text-slate-200 border border-slate-800"
              }`}
            >
              <div className="font-semibold text-xs">{tab.label}</div>
              <div className="text-[10px] text-slate-500 font-sans">{tab.desc}</div>
            </button>
          ))}
        </div>

        {/* Save or Error Status Alerts */}
        {saveStatus && (
          <div className="mb-3 p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" />
            {saveStatus}
          </div>
        )}

        {errorMessage && (
          <div className="mb-3 p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            {errorMessage}
          </div>
        )}

        {/* YAML Code Area */}
        <div className="mt-2 relative">
          <textarea
            value={activeContent}
            onChange={(e) => setActiveContent(e.target.value)}
            rows={18}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl p-4 font-mono text-xs text-slate-200 focus:outline-none focus:border-cyan-500/70 leading-relaxed resize-y"
            spellCheck={false}
          />
        </div>
      </div>

      {/* Live Spec Transformation Playground */}
      <div className="p-6 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-cyan-400" />
              Live Metric Transformation & Dead-Letter Validator
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Paste raw JSON metric samples to test unit conversion, dimension governance, and schema validation.
            </p>
          </div>

          <button
            onClick={handleTestTransformation}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
          >
            <Play className="w-3 h-3 fill-current" />
            Run Transformation
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          
          {/* Input JSON */}
          <div className="space-y-1.5">
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider font-mono">
              Raw Sample Input
            </div>
            <textarea
              value={playgroundInput}
              onChange={(e) => setPlaygroundInput(e.target.value)}
              rows={10}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 font-mono text-xs text-slate-300 focus:outline-none focus:border-indigo-500 leading-relaxed"
            />
          </div>

          {/* Output Result */}
          <div className="space-y-1.5">
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider font-mono">
              Normalized Prometheus Remote-Write Output
            </div>
            <div className="w-full h-52 bg-slate-950 border border-slate-800 rounded-xl p-3 font-mono text-xs text-slate-300 overflow-y-auto leading-relaxed">
              {playgroundOutput ? (
                <pre className="text-slate-300">
                  {JSON.stringify(playgroundOutput, null, 2)}
                </pre>
              ) : (
                <div className="text-slate-600 italic py-12 text-center">
                  Click &quot;Run Transformation&quot; to view the governed metric payload.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
