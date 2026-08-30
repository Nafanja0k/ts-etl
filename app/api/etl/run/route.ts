import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import * as yaml from "js-yaml";

export interface S3VirtualStorage {
  locks: Record<string, { body: any; etag: string; last_modified: number }>;
  watermarks: Record<string, { body: any; last_modified: number }>;
  checkpoints: Record<string, { body: any; last_modified: number }>;
  deadletter: Record<string, { body: any; last_modified: number }>;
}

// In-memory persistent state for server runtime
declare global {
  var __mockS3Storage: S3VirtualStorage | undefined;
  var __mockTsdbSink: any[] | undefined;
}

if (!global.__mockS3Storage) {
  const now = Math.floor(Date.now() / 1000);
  global.__mockS3Storage = {
    locks: {},
    watermarks: {
      "infra_k8s_prometheus": {
        body: {
          job_id: "infra_k8s_prometheus",
          watermark_timestamp: now - 3600, // 1 hour ago
          watermark_iso: new Date((now - 3600) * 1000).toISOString(),
          last_committed_at: now - 3600,
          last_slice_metrics: 3,
          last_slice_samples: 45,
        },
        last_modified: now - 3600,
      },
      "apps_splunk_o11y": {
        body: {
          job_id: "apps_splunk_o11y",
          watermark_timestamp: now - 7200, // 2 hours ago
          watermark_iso: new Date((now - 7200) * 1000).toISOString(),
          last_committed_at: now - 7200,
          last_slice_metrics: 4,
          last_slice_samples: 48,
        },
        last_modified: now - 7200,
      },
      "legacy_graphite_host_memory": {
        body: {
          job_id: "legacy_graphite_host_memory",
          watermark_timestamp: now - 1800, // 30m ago
          watermark_iso: new Date((now - 1800) * 1000).toISOString(),
          last_committed_at: now - 1800,
          last_slice_metrics: 3,
          last_slice_samples: 45,
        },
        last_modified: now - 1800,
      },
    },
    checkpoints: {},
    deadletter: {},
  };
}

if (!global.__mockTsdbSink) {
  global.__mockTsdbSink = [];
}

export function getMockS3(): S3VirtualStorage {
  return global.__mockS3Storage!;
}

export function getMockTsdbSink(): any[] {
  return global.__mockTsdbSink!;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const {
    jobId,
    backfillStartMinutesAgo,
    simulateOutageGapHours,
    injectQuarantineError,
    dryRun,
  } = body;

  const s3 = getMockS3();
  const tsdbSink = getMockTsdbSink();
  const now = Math.floor(Date.now() / 1000);
  const runnerId = `runner-${Math.random().toString(36).substring(2, 9)}`;

  const logs: Array<{ ts: string; level: "INFO" | "WARN" | "ERROR" | "SUCCESS"; message: string; step?: string }> = [];
  const log = (level: "INFO" | "WARN" | "ERROR" | "SUCCESS", message: string, step?: string) => {
    logs.push({ ts: new Date().toISOString(), level, message, step });
  };

  log("INFO", `Initializing Ephemeral Telemetry ETL Orchestrator [${runnerId}]...`, "INIT");

  // Step 1: Distributed S3 Lease
  log("INFO", `Attempting atomic S3 Lease acquisition on s3://telemetry-etl-state/locks/orchestrator.lock (IfNoneMatch: *)...`, "LOCK");
  const lockKey = "locks/orchestrator.lock";
  const existingLock = s3.locks[lockKey];
  
  if (existingLock && existingLock.body.expires_at > now && existingLock.body.instance_id !== runnerId) {
    const remaining = existingLock.body.expires_at - now;
    log("WARN", `Lock held by active instance ${existingLock.body.instance_id}. Expires in ${remaining}s. Skipping run to prevent split-brain.`, "LOCK");
    return NextResponse.json({
      status: "SKIPPED_LOCK_HELD",
      runnerId,
      logs,
      summary: { lease_acquired: false, total_slices: 0, metrics_exported: 0 },
    });
  }

  // Acquire lock
  const lockTtl = 300;
  if (!dryRun) {
    s3.locks[lockKey] = {
      body: {
        instance_id: runnerId,
        acquired_at: now,
        expires_at: now + lockTtl,
        ttl_seconds: lockTtl,
      },
      etag: `"${Math.random().toString(36).substring(2, 14)}"`,
      last_modified: now,
    };
  }
  log("SUCCESS", `Acquired distributed S3 lease for ${runnerId} (TTL: ${lockTtl}s)`, "LOCK");

  // Load Specs
  let registryData: any;
  let schemaData: any;

  try {
    const regPath = path.join(process.cwd(), "specs", "pipeline_registry.yaml");
    const schPath = path.join(process.cwd(), "specs", "target_metrics_schema.yaml");
    registryData = yaml.load(fs.readFileSync(regPath, "utf-8"));
    schemaData = yaml.load(fs.readFileSync(schPath, "utf-8"));
  } catch (e: any) {
    log("ERROR", `Failed reading specs: ${e.message}`, "CONFIG");
    if (!dryRun) delete s3.locks[lockKey];
    return NextResponse.json({ status: "ERROR", error: e.message, logs }, { status: 500 });
  }

  const jobsToProcess = registryData.jobs.filter((j: any) => !jobId || j.job_id === jobId);
  const jobSummaries: any[] = [];
  let totalSlices = 0;
  let totalMetrics = 0;
  let totalSamples = 0;
  let totalDroppedTags = 0;
  let totalQuarantined = 0;

  for (const job of jobsToProcess) {
    log("INFO", `Processing registered pipeline job: ${job.job_id} [Source: ${job.source_type.toUpperCase()}]`, "JOB_START");

    // Nobl9 Safe Offset: t_safe = t_now - query_delay
    const queryDelaySec = (job.query_delay_minutes || 10) * 60;
    const safeLimitTs = now - queryDelaySec;
    const safeLimitIso = new Date(safeLimitTs * 1000).toISOString();

    log("INFO", `[Nobl9 Safe Window] t_now: ${new Date(now * 1000).toISOString()} | Query Delay: ${job.query_delay_minutes}m -> t_safe = ${safeLimitIso}`, "SAFE_BUFFER");

    // Read Watermark
    let watermarkTs = now - (job.chunk_minutes * 60 * 2);
    if (simulateOutageGapHours && simulateOutageGapHours > 0) {
      watermarkTs = now - (simulateOutageGapHours * 3600);
      log("WARN", `Simulated outage gap active: Forcing watermark back to ${new Date(watermarkTs * 1000).toISOString()} (${simulateOutageGapHours}h ago)`, "WATERMARK");
    } else if (backfillStartMinutesAgo && backfillStartMinutesAgo > 0) {
      watermarkTs = now - (backfillStartMinutesAgo * 60);
      log("INFO", `Manual backfill specified: Setting start watermark to ${new Date(watermarkTs * 1000).toISOString()}`, "WATERMARK");
    } else if (s3.watermarks[job.job_id]) {
      watermarkTs = s3.watermarks[job.job_id].body.watermark_timestamp;
      log("INFO", `Loaded watermark from s3://telemetry-etl-state/watermarks/${job.job_id}.json: ${new Date(watermarkTs * 1000).toISOString()}`, "WATERMARK");
    }

    const chunkSizeSec = (job.chunk_minutes || 15) * 60;
    const slices: Array<{ start: number; end: number }> = [];

    let currentCursor = watermarkTs;
    while (currentCursor + chunkSizeSec <= safeLimitTs) {
      slices.push({ start: currentCursor, end: currentCursor + chunkSizeSec });
      currentCursor += chunkSizeSec;
    }
    if (slices.length === 0 && currentCursor < safeLimitTs && (safeLimitTs - currentCursor) >= 60) {
      slices.push({ start: currentCursor, end: safeLimitTs });
    }

    if (slices.length === 0) {
      log("INFO", `Job ${job.job_id} is completely caught up to safe limit. 0 pending slices.`, "WATERMARK");
      jobSummaries.push({
        job_id: job.job_id,
        source_type: job.source_type,
        watermark_start: watermarkTs,
        safe_limit: safeLimitTs,
        slices_processed: 0,
        metrics_exported: 0,
      });
      continue;
    }

    log("INFO", `Detected gap: ${slices.length} sequential slice(s) to process for ${job.job_id}`, "CATCH_UP");

    let jobExportedMetrics = 0;
    let jobExportedSamples = 0;
    let jobDroppedTags = 0;
    let jobQuarantined = 0;
    const sliceDetails: any[] = [];

    // Load Mapping spec
    let mappingSpec: any;
    try {
      const mappingPath = path.join(process.cwd(), job.mapping_spec);
      mappingSpec = yaml.load(fs.readFileSync(mappingPath, "utf-8"));
    } catch {
      mappingSpec = { rules: [] };
    }

    // Process each slice in chronological order
    for (let sIdx = 0; sIdx < slices.length; sIdx++) {
      const slice = slices[sIdx];
      const startIso = new Date(slice.start * 1000).toISOString();
      const endIso = new Date(slice.end * 1000).toISOString();

      log("INFO", `[Slice ${sIdx + 1}/${slices.length}] Range [${startIso} -> ${endIso})`, "EXTRACT");

      // Extract with Push-Down Downsample
      const resolution = job.downsample_resolution || "1m";
      let rawSeriesCount = 0;
      let rawSamplesCount = 0;
      const normalizedSeriesList: any[] = [];
      const quarantinedList: any[] = [];

      if (job.source_type === "prometheus") {
        log("INFO", `Push-Down Extractor: GET ${job.source_url || "http://prometheus.internal:9090"}/api/v1/query_range?step=${resolution}&start=${slice.start}&end=${slice.end - 1}`, "EXTRACT");
        
        // Generate simulated raw series
        const instances = ["node-worker-01.prod.cloud", "node-worker-02.prod.cloud", "node-worker-03.prod.cloud"];
        rawSeriesCount = instances.length;
        
        for (const inst of instances) {
          const samples: any[] = [];
          const stepSec = resolution.endsWith("m") ? parseInt(resolution) * 60 : 60;
          for (let t = slice.start; t < slice.end; t += stepSec) {
            const rawVal = Math.max(0.1, Math.min(0.95, 0.45 + 0.3 * Math.sin(t / 3600) + (Math.random() * 0.05)));
            samples.push({ timestamp_ms: t * 1000, value: parseFloat(rawVal.toFixed(4)) });
            rawSamplesCount++;
          }

          // Test Quarantine if requested
          if (injectQuarantineError && inst.includes("03")) {
            quarantinedList.push({
              reason: "MISSING_REQUIRED_DIMENSIONS: ['deployment.environment']",
              raw_metric: "node_cpu_seconds_total",
              tags: { instance: inst, app: "k8s-core" },
            });
            continue;
          }

          // Transform & Trim Cardinality
          // Dropped volatile tags: pod_uuid, container_id, job, ip
          const droppedInThisSeries = 4;
          jobDroppedTags += droppedInThisSeries;

          normalizedSeriesList.push({
            metric_name: "system.cpu.utilization",
            labels: {
              "__name__": "system.cpu.utilization",
              "host.name": inst,
              "service.name": "k8s-core",
              "deployment.environment": "production",
              "cloud.region": "us-east-1",
              "source.system": "prometheus-k8s",
            },
            samples,
          });
        }
      } else if (job.source_type === "splunk_o11y") {
        log("INFO", `Push-Down Extractor: GET https://api.${job.realm || "us0"}.signalfx.com/v2/datapoint/http.requests.total?resolution=${resolution}`, "EXTRACT");
        const endpoints = [
          { status: "200", path: "/api/v1/checkout", service: "order-api" },
          { status: "200", path: "/api/v1/users/profile", service: "auth-service" },
          { status: "500", path: "/api/v1/checkout", service: "order-api" },
          { status: "404", path: "/legacy/endpoint", service: "gateway" },
        ];
        rawSeriesCount = endpoints.length;

        for (const ep of endpoints) {
          const samples: any[] = [];
          const stepSec = 300; // 5m
          const baseCount = ep.status === "200" ? 1250 : (ep.status === "500" ? 18 : 55);
          for (let t = slice.start; t < slice.end; t += stepSec) {
            const jitter = Math.floor(Math.sin(t / 1800) * 120);
            samples.push({ timestamp_ms: t * 1000, value: Math.max(1, baseCount + jitter) });
            rawSamplesCount++;
          }

          // Dropped volatile tags: client_ip, trace_id, span_id, sf_schema
          jobDroppedTags += 4;

          normalizedSeriesList.push({
            metric_name: "http.server.requests",
            labels: {
              "__name__": "http.server.requests",
              "http.response.status_code": ep.status,
              "http.route": ep.path,
              "service.name": ep.service,
              "deployment.environment": "production",
              "source.system": "splunk-o11y",
            },
            samples,
          });
        }
      } else if (job.source_type === "graphite") {
        log("INFO", `Push-Down Extractor: GET ${job.source_url || "http://graphite.internal:8080"}/render?target=summarize(servers.*.*.*.memory.percent_used,"2m","average")`, "EXTRACT");
        const paths = [
          "servers.us-east.metal-srv-01.billing-engine.memory.percent_used",
          "servers.us-east.metal-srv-02.billing-engine.memory.percent_used",
          "servers.eu-west.metal-srv-03.cache-tier.memory.percent_used",
        ];
        rawSeriesCount = paths.length;

        for (const p of paths) {
          const parts = p.split(".");
          const samples: any[] = [];
          const stepSec = 120; // 2m
          for (let t = slice.start; t < slice.end; t += stepSec) {
            const rawPct = 65.0 + Math.sin(t / 2400) * 15.0; // 50% to 80%
            // Unit conversion: 0-100% -> 0.0-1.0 ratio
            const ratio = parseFloat((rawPct / 100.0).toFixed(4));
            samples.push({ timestamp_ms: t * 1000, value: ratio });
            rawSamplesCount++;
          }

          normalizedSeriesList.push({
            metric_name: "system.memory.utilization",
            labels: {
              "__name__": "system.memory.utilization",
              "cloud.region": parts[1],
              "host.name": parts[2],
              "service.name": parts[3],
              "deployment.environment": "production",
              "source.system": "graphite",
            },
            samples,
          });
        }
      }

      // Handle Quarantined
      if (quarantinedList.length > 0) {
        jobQuarantined += quarantinedList.length;
        if (!dryRun) {
          const qKey = `deadletter/${job.job_id}/${new Date().toISOString().replace(/[:.]/g, "")}.json`;
          s3.deadletter[qKey] = {
            body: {
              job_id: job.job_id,
              count: quarantinedList.length,
              items: quarantinedList,
            },
            last_modified: now,
          };
        }
        log("WARN", `Quarantined ${quarantinedList.length} non-compliant series into s3://telemetry-etl-state/deadletter/${job.job_id}/...`, "TRANSFORM");
      }

      // Remote Write Bulk Export
      const sampleCountInSlice = normalizedSeriesList.reduce((acc, s) => acc + s.samples.length, 0);
      const estProtobufBytes = normalizedSeriesList.length * 180 + sampleCountInSlice * 16;
      const estSnappyBytes = Math.floor(estProtobufBytes * 0.45);

      log("INFO", `Bulk Export: Serializing ${normalizedSeriesList.length} series (${sampleCountInSlice} samples) to Protobuf + Snappy (${estSnappyBytes} bytes)...`, "REMOTE_WRITE");
      log("SUCCESS", `POST 204 No Content -> Target TSDB (VictoriaMetrics / Mimir) at /api/v1/write`, "REMOTE_WRITE");

      if (!dryRun) {
        for (const s of normalizedSeriesList) {
          tsdbSink.push({
            job_id: job.job_id,
            metric: s.metric_name,
            labels: s.labels,
            samples_count: s.samples.length,
            time_range: [startIso, endIso],
          });
        }
      }

      // Commit State to S3 (Checkpoint marker + Watermark update)
      const startTag = startIso.replace(/[-:]/g, "").replace(/\..+/, "Z");
      const checkpointKey = `checkpoints/${job.job_id}/${startTag}.done`;
      
      if (!dryRun) {
        // 1. Zero-byte/metadata checkpoint marker
        s3.checkpoints[checkpointKey] = {
          body: {
            job_id: job.job_id,
            slice_start: slice.start,
            slice_end: slice.end,
            slice_start_iso: startIso,
            slice_end_iso: endIso,
            committed_at: now,
            metrics_count: normalizedSeriesList.length,
            samples_count: sampleCountInSlice,
          },
          last_modified: now,
        };

        // 2. Advance monotonic watermark
        s3.watermarks[job.job_id] = {
          body: {
            job_id: job.job_id,
            watermark_timestamp: slice.end,
            watermark_iso: endIso,
            last_committed_at: now,
            last_slice_metrics: normalizedSeriesList.length,
            last_slice_samples: sampleCountInSlice,
          },
          last_modified: now,
        };
      }

      log("SUCCESS", `Committed S3 state: Put ${checkpointKey} & advanced watermark to ${endIso}`, "COMMIT");

      jobExportedMetrics += normalizedSeriesList.length;
      jobExportedSamples += sampleCountInSlice;

      sliceDetails.push({
        start_iso: startIso,
        end_iso: endIso,
        raw_series: rawSeriesCount,
        exported_series: normalizedSeriesList.length,
        exported_samples: sampleCountInSlice,
        payload_bytes: estSnappyBytes,
      });
    }

    totalSlices += slices.length;
    totalMetrics += jobExportedMetrics;
    totalSamples += jobExportedSamples;
    totalDroppedTags += jobDroppedTags;
    totalQuarantined += jobQuarantined;

    jobSummaries.push({
      job_id: job.job_id,
      source_type: job.source_type,
      watermark_start: watermarkTs,
      watermark_end: slices[slices.length - 1].end,
      slices_processed: slices.length,
      metrics_exported: jobExportedMetrics,
      samples_exported: jobExportedSamples,
      dropped_tags: jobDroppedTags,
      quarantined_series: jobQuarantined,
      slices_detail: sliceDetails,
    });
  }

  // Step 3: Release S3 Lease & Terminate Process (Compute drops to $0.00)
  if (!dryRun) {
    delete s3.locks[lockKey];
  }
  log("SUCCESS", `Released S3 Lease on locks/orchestrator.lock. Process terminating. Ephemeral compute drops to $0.00.`, "TERMINATE");

  return NextResponse.json({
    status: "SUCCESS",
    runnerId,
    duration_ms: 18,
    jobs_processed: jobSummaries,
    summary: {
      total_jobs: jobsToProcess.length,
      total_slices: totalSlices,
      total_metrics_exported: totalMetrics,
      total_samples_exported: totalSamples,
      total_dropped_tags: totalDroppedTags,
      total_quarantined: totalQuarantined,
      lease_acquired: true,
    },
    logs,
  });
}
