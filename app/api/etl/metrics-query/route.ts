import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const metricType = searchParams.get("type") || "cpu"; // "cpu" | "http" | "memory"
  const now = Math.floor(Date.now() / 1000);
  const startTs = now - 3600; // 1 hour window

  if (metricType === "cpu") {
    // Raw Prometheus data with 12 high-cardinality volatile labels and high jitter
    const rawData = [];
    const normalizedData = [];
    const stepSec = 60; // 1m

    for (let t = startTs; t <= now; t += stepSec) {
      const timeStr = new Date(t * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const rawJitter = Math.sin(t / 600) * 0.15 + (Math.random() * 0.08);
      const baseCpu = 0.48 + Math.sin(t / 2400) * 0.25;

      const rawVal = Math.max(0.05, Math.min(0.98, baseCpu + rawJitter));
      const cleanVal = Math.max(0.05, Math.min(0.95, baseCpu));

      rawData.push({
        timestamp: t,
        time: timeStr,
        node_worker_01: parseFloat(rawVal.toFixed(4)),
        node_worker_02: parseFloat((rawVal * 0.88 + 0.05).toFixed(4)),
        node_worker_03: parseFloat((rawVal * 1.05 - 0.02).toFixed(4)),
        volatile_tags: {
          pod_uuid: "e81d4-uuid-" + Math.floor(Math.random() * 9000 + 1000),
          container_id: "docker://" + Math.random().toString(36).substring(2, 10),
          ip: "10.244.3." + Math.floor(Math.random() * 200 + 10),
        },
      });

      normalizedData.push({
        timestamp: t,
        time: timeStr,
        "system.cpu.utilization (node-01)": parseFloat(cleanVal.toFixed(4)),
        "system.cpu.utilization (node-02)": parseFloat((cleanVal * 0.88 + 0.05).toFixed(4)),
        "system.cpu.utilization (node-03)": parseFloat((cleanVal * 1.05 - 0.02).toFixed(4)),
      });
    }

    return NextResponse.json({
      metric_type: "cpu",
      source_name: "node_cpu_seconds_total",
      target_name: "system.cpu.utilization",
      unit: "ratio (0.0 to 1.0)",
      raw_points: rawData,
      normalized_points: normalizedData,
      cardinality_impact: {
        raw_series_count: 1420, // With ephemeral pod tags
        governed_series_count: 3, // Grouped by host.name, service.name, deployment.environment
        reduction_percentage: 99.8,
      },
    });
  }

  if (metricType === "http") {
    const rawData = [];
    const normalizedData = [];
    const stepSec = 300; // 5m

    for (let t = startTs; t <= now; t += stepSec) {
      const timeStr = new Date(t * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const jitter = Math.sin(t / 1200) * 180 + Math.random() * 50;

      const okRequests = Math.floor(1250 + jitter);
      const err500 = Math.floor(15 + Math.random() * 10);
      const err404 = Math.floor(45 + Math.random() * 20);

      rawData.push({
        timestamp: t,
        time: timeStr,
        "checkout_200": okRequests,
        "checkout_500": err500,
        "gateway_404": err404,
      });

      normalizedData.push({
        timestamp: t,
        time: timeStr,
        "http.server.requests [status=200, route=/api/v1/checkout]": okRequests,
        "http.server.requests [status=500, route=/api/v1/checkout]": err500,
        "http.server.requests [status=404, route=/legacy/endpoint]": err404,
      });
    }

    return NextResponse.json({
      metric_type: "http",
      source_name: "http.requests.total (Splunk O11y)",
      target_name: "http.server.requests",
      unit: "requests count / interval",
      raw_points: rawData,
      normalized_points: normalizedData,
      cardinality_impact: {
        raw_series_count: 8500, // Due to client_ip and trace_id tags
        governed_series_count: 4,
        reduction_percentage: 99.95,
      },
    });
  }

  // Memory (Graphite dot path)
  const rawData = [];
  const normalizedData = [];
  const stepSec = 120; // 2m

  for (let t = startTs; t <= now; t += stepSec) {
    const timeStr = new Date(t * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const rawPct = 68.0 + Math.sin(t / 1800) * 14.0 + (Math.random() * 2);
    const ratioVal = parseFloat((rawPct / 100.0).toFixed(4));

    rawData.push({
      timestamp: t,
      time: timeStr,
      "servers.us-east.metal-srv-01 (% used)": parseFloat(rawPct.toFixed(2)),
      "servers.us-east.metal-srv-02 (% used)": parseFloat((rawPct + 5.2).toFixed(2)),
    });

    normalizedData.push({
      timestamp: t,
      time: timeStr,
      "system.memory.utilization [host=srv-01, region=us-east]": ratioVal,
      "system.memory.utilization [host=srv-02, region=us-east]": parseFloat(((rawPct + 5.2) / 100.0).toFixed(4)),
    });
  }

  return NextResponse.json({
    metric_type: "memory",
    source_name: "servers.*.*.*.memory.percent_used (Graphite)",
    target_name: "system.memory.utilization",
    unit: "0.0 - 1.0 ratio (converted from 0-100% dot-path)",
    raw_points: rawData,
    normalized_points: normalizedData,
    cardinality_impact: {
      raw_series_count: 120,
      governed_series_count: 3,
      reduction_percentage: 97.5,
    },
  });
}
