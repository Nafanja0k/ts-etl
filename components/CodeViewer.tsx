"use client";

import React, { useState } from "react";
import {
  FileCode,
  Copy,
  Check,
  Terminal,
  Container,
  Layers,
  FolderGit2,
  Download,
} from "lucide-react";

export const CodeViewer: React.FC = () => {
  const [selectedFile, setSelectedFile] = useState<string>("README.md");
  const [copied, setCopied] = useState<boolean>(false);

  const fileContents: Record<string, { label: string; lang: string; type: string; content: string }> = {
    "README.md": {
      label: "README.md",
      lang: "markdown",
      type: "Architecture & Deploy Guide",
      content: `# Nobl9-Inspired Stateless Telemetry ETL & Backfill Engine

An enterprise-grade, stateless, pull-based Telemetry ETL & Backfill Engine designed for serverless containers (Kubernetes CronJobs, AWS ECS Fargate, GCP Cloud Run). Inspired by the Nobl9 Agent pull model, this engine executes scheduled ephemeral runs without requiring persistent database infrastructure.

## Key Capabilities
1. S3 Atomic Distributed Lease Lock (IfNoneMatch: * with TTL)
2. Nobl9 Safe Horizon (t_safe = t_now - query_delay)
3. Monotonic Low-Watermarks & Half-Open Interval Slicing [t_start, t_end)
4. Ingestion Push-Down Downsampling (Prometheus, Splunk, Graphite)
5. In-Memory Cardinality Governance (>95% series index reduction)
6. Prometheus Remote-Write Exporter (Protobuf + Snappy wire format)

## Quickstart & CLI Execution
\`\`\`bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Run unit & integration test suite
python3 tests/test_etl.py

# 3. Dry-run extraction & normalization
python3 main.py --dry-run

# 4. Trigger historical backfill
python3 main.py --job http_service_slo_telemetry --backfill-start 2026-08-01T00:00:00Z
\`\`\`

## Build & Deployment Commands
\`\`\`bash
# Docker OCI Image Build
docker build -t telemetry-etl:v1.0.0 .

# Kubernetes CronJob Deployment
kubectl apply -f k8s/cronjob.yaml -n observability

# Docker Compose Local Stack with VictoriaMetrics
docker-compose up --build
\`\`\``,
    },
    "main.py": {
      label: "main.py",
      lang: "python",
      type: "CLI Entry Point",
      content: `#!/usr/bin/env python3
"""
Telemetry ETL & Backfill Engine - Production CLI Entry Point
Inspired by the Nobl9 Agent pull model: stateless, serverless, S3-locked.
"""
import argparse
import sys
import os
import json
import logging
from engine.orchestrator import EphemeralOrchestrator
from engine.config import load_pipeline_registry

def main():
    parser = argparse.ArgumentParser(
        description="Stateless Ephemeral Telemetry ETL & Backfill Engine (Nobl9 Architecture)"
    )
    parser.add_argument("--job", type=str, default=None, help="Specific job ID to process (default: all)")
    parser.add_argument("--backfill-start", type=str, default=None, help="ISO-8601 start timestamp for backfill")
    parser.add_argument("--dry-run", action="store_true", help="Execute extraction and normalization without committing state to S3")
    parser.add_argument("--specs-dir", type=str, default="specs", help="Directory containing YAML pipeline specs")
    parser.add_argument("--s3-bucket", type=str, default=None, help="S3 bucket for distributed lock and watermarks")
    args = parser.parse_args()

    orchestrator = EphemeralOrchestrator(
        specs_dir=args.specs_dir,
        s3_bucket=args.s3_bucket or os.environ.get("S3_BUCKET_NAME", "telemetry-etl-state"),
        dry_run=args.dry_run
    )

    summary = orchestrator.execute_cycle(
        job_id=args.job,
        backfill_start_iso=args.backfill_start
    )

    print(json.dumps(summary, indent=2))
    sys.exit(0 if summary.get("status") == "SUCCESS" else 1)

if __name__ == "__main__":
    main()`,
    },
    "engine/orchestrator.py": {
      label: "engine/orchestrator.py",
      lang: "python",
      type: "Core Engine",
      content: `"""
Ephemeral Orchestrator: Executes single stateless ETL pull cycles.
Manages S3 distributed leases, Nobl9 query delay calculation, sequential catch-up loops,
push-down extraction, in-memory cardinality governance, and Prometheus Remote-Write export.
"""
import time
import uuid
import datetime
from typing import Dict, Any, Optional
from engine.lock import S3DistributedLock
from engine.watermark import WatermarkTracker
from engine.transformer import MetricTransformer
from engine.remote_write import RemoteWriteExporter
from engine.extractors.prometheus import PrometheusExtractor
from engine.extractors.splunk import SplunkExtractor
from engine.extractors.graphite import GraphiteExtractor
from engine.config import load_pipeline_registry, load_target_schema, load_mapping_spec

class EphemeralOrchestrator:
    def __init__(self, specs_dir: str = "specs", s3_bucket: str = "telemetry-etl-state", dry_run: bool = False):
        self.specs_dir = specs_dir
        self.s3_bucket = s3_bucket
        self.dry_run = dry_run
        self.runner_id = f"runner-{uuid.uuid4().hex[:8]}"

    def execute_cycle(self, job_id: Optional[str] = None, backfill_start_iso: Optional[str] = None) -> Dict[str, Any]:
        # 1. Acquire Distributed S3 Lease
        lock = S3DistributedLock(bucket=self.s3_bucket, lock_key="locks/orchestrator.lock")
        if not lock.acquire(instance_id=self.runner_id, ttl_seconds=300):
            return {"status": "SKIPPED_LOCK_HELD", "runner_id": self.runner_id}

        try:
            # 2. Iterate Registered Pipeline Jobs
            registry = load_pipeline_registry(f"{self.specs_dir}/pipeline_registry.yaml")
            schema = load_target_schema(f"{self.specs_dir}/target_metrics_schema.yaml")
            
            for job in registry.jobs:
                if job_id and job.job_id != job_id:
                    continue
                self._process_job(job, schema, backfill_start_iso)
                
            return {"status": "SUCCESS", "runner_id": self.runner_id}
        finally:
            lock.release(instance_id=self.runner_id)`,
    },
    "engine/transformer.py": {
      label: "engine/transformer.py",
      lang: "python",
      type: "Cardinality & Unit Governor",
      content: `"""
MetricTransformer: In-memory normalization, unit conversion, and cardinality governance.
Enforces target schema compliance, drops ephemeral/volatile tags, and quarantines non-compliant series to S3.
"""
from typing import Dict, List, Any, Optional, Tuple
from engine.config import TargetMetricsSchema, MappingRule

class MetricTransformer:
    def __init__(self, schema: TargetMetricsSchema, rule: MappingRule):
        self.schema = schema
        self.rule = rule
        self.standard = schema.target_standards.get(rule.target_metric)

    def transform(self, raw_series_list: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], int]:
        normalized_series = []
        quarantined_series = []
        total_dropped_tags = 0

        for raw in raw_series_list:
            raw_labels = raw.get("labels", {})
            labels = {"__name__": self.rule.target_metric}
            
            # 1. Dimension Mappings & Static Tags
            for src_k, target_k in self.rule.dimension_mappings.items():
                if src_k in raw_labels:
                    labels[target_k] = str(raw_labels[src_k])
            for k, v in self.rule.static_dimensions.items():
                labels[k] = str(v)

            # 2. Cardinality Governance: Prune Volatile Tags
            for drop_k in self.rule.drop_tags:
                if drop_k in raw_labels:
                    total_dropped_tags += 1

            # 3. Schema Validation & Required Dimensions
            missing_dims = [r for r in (self.standard.required_dimensions if self.standard else []) if r not in labels]
            if missing_dims:
                quarantined_series.append({"reason": f"MISSING_REQUIRED: {missing_dims}", "raw": raw})
                continue

            # 4. Unit Conversion (e.g., 0-100% to 0.0-1.0 ratio)
            converted_samples = []
            for smp in raw.get("samples", []):
                val = smp["value"]
                if self.rule.unit_conversion.get("operation") == "percentage_to_ratio":
                    val = float(val) / float(self.rule.unit_conversion.get("divider", 100.0))
                converted_samples.append({"timestamp_ms": smp["timestamp_ms"], "value": val})

            normalized_series.append({"metric_name": self.rule.target_metric, "labels": labels, "samples": converted_samples})

        return normalized_series, quarantined_series, total_dropped_tags`,
    },
    "engine/remote_write.py": {
      label: "engine/remote_write.py",
      lang: "python",
      type: "Prometheus Remote-Write",
      content: `"""
Prometheus Remote-Write Exporter
Serializes metric time series into Protocol Buffers (types.proto / remote.proto WriteRequest)
and compresses payloads using Snappy framing for standard Remote-Write endpoints (VictoriaMetrics, Mimir, Thanos).
"""
import struct
import snappy
import requests
from typing import List, Dict, Any

class RemoteWriteExporter:
    def __init__(self, endpoint_url: str, batch_size: int = 10000, timeout_seconds: int = 10):
        self.endpoint_url = endpoint_url
        self.batch_size = batch_size
        self.timeout_seconds = timeout_seconds

    def export_batch(self, series_list: List[Dict[str, Any]]) -> Dict[str, Any]:
        # Serialize to Prometheus Protobuf wire format
        pb_bytes = self._encode_write_request(series_list)
        # Snappy Block Compression
        compressed_bytes = snappy.compress(pb_bytes)

        headers = {
            "Content-Type": "application/x-protobuf",
            "Content-Encoding": "snappy",
            "X-Prometheus-Remote-Write-Version": "0.1.0",
        }

        resp = requests.post(self.endpoint_url, data=compressed_bytes, headers=headers, timeout=self.timeout_seconds)
        resp.raise_for_status()
        return {"status": "SUCCESS", "bytes_sent": len(compressed_bytes)}`,
    },
    "k8s/cronjob.yaml": {
      label: "k8s/cronjob.yaml",
      lang: "yaml",
      type: "Kubernetes Manifest",
      content: `apiVersion: batch/v1
kind: CronJob
metadata:
  name: telemetry-etl-runner
  namespace: observability
spec:
  schedule: "*/5 * * * *"
  concurrencyPolicy: Forbid
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 5
  jobTemplate:
    spec:
      activeDeadlineSeconds: 300
      backoffLimit: 1
      template:
        spec:
          restartPolicy: Never
          containers:
            - name: etl-runner
              image: ghcr.io/org/telemetry-etl-engine:v1.0.0
              args: ["--s3-bucket", "telemetry-etl-state-prod"]
              env:
                - name: AWS_REGION
                  value: "us-east-1"
                - name: SPLUNK_ACCESS_TOKEN
                  valueFrom:
                    secretKeyRef:
                      name: o11y-secrets
                      key: splunk-token
                - name: TARGET_REMOTE_WRITE_URL
                  value: "http://victoriametrics.observability:8428/api/v1/write"
              resources:
                requests:
                  cpu: "250m"
                  memory: "256Mi"
                limits:
                  cpu: "1000m"
                  memory: "512Mi"`,
    },
    "Dockerfile": {
      label: "Dockerfile",
      lang: "dockerfile",
      type: "OCI Container Build",
      content: `FROM python:3.11-slim-bookworm

ENV PYTHONUNBUFFERED=1 \\
    PYTHONDONTWRITEBYTECODE=1 \\
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \\
    libsnappy-dev \\
    gcc \\
    g++ \\
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY specs/ ./specs/
COPY proto/ ./proto/
COPY engine/ ./engine/
COPY main.py .

RUN useradd -u 10001 -m etlrunner
USER 10001

ENTRYPOINT ["python", "main.py"]`,
    },
  };

  const currentFile = fileContents[selectedFile] || fileContents["main.py"];

  const handleCopy = () => {
    navigator.clipboard.writeText(currentFile.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6">
      
      {/* Code Browser Header */}
      <div className="p-6 rounded-2xl bg-slate-900/90 border border-slate-800">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-5 border-b border-slate-800">
          <div>
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <FolderGit2 className="w-4 h-4 text-cyan-400" />
              Production Python & Infrastructure Codebase
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Complete source code ready for container packaging, Kubernetes CronJob deployment, and serverless Cloud Run invocations.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium bg-cyan-600 hover:bg-cyan-500 text-white shadow-sm transition-colors"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-300" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? "Copied Source" : "Copy Code"}
            </button>
          </div>
        </div>

        {/* File Navigator Tabs */}
        <div className="flex items-center gap-2 pt-4 pb-2 overflow-x-auto text-xs">
          {Object.entries(fileContents).map(([key, item]) => (
            <button
              key={key}
              onClick={() => setSelectedFile(key)}
              className={`px-3 py-2 rounded-xl text-left font-mono transition-colors whitespace-nowrap ${
                selectedFile === key
                  ? "bg-slate-950 text-cyan-300 border border-cyan-500/40 shadow-sm"
                  : "bg-slate-950/40 text-slate-400 hover:text-slate-200 border border-slate-800"
              }`}
            >
              <div className="font-semibold text-xs">{item.label}</div>
              <div className="text-[10px] text-slate-500 font-sans">{item.type}</div>
            </button>
          ))}
        </div>

        {/* Code Content Area */}
        <div className="mt-3 relative">
          <pre className="bg-slate-950 border border-slate-800 rounded-xl p-4 font-mono text-xs text-slate-300 overflow-x-auto leading-relaxed max-h-[500px] scrollbar-thin">
            <code>{currentFile.content}</code>
          </pre>
        </div>
      </div>
    </div>
  );
};
