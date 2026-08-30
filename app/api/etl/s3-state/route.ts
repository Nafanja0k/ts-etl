import { NextRequest, NextResponse } from "next/server";
import { getMockS3, getMockTsdbSink } from "../run/route";

export async function GET() {
  const s3 = getMockS3();
  const tsdb = getMockTsdbSink();
  const now = Math.floor(Date.now() / 1000);

  const lockList = Object.entries(s3.locks).map(([key, val]) => ({
    key,
    ...val.body,
    is_active: val.body.expires_at > now,
    expires_in_sec: Math.max(0, val.body.expires_at - now),
    last_modified_iso: new Date(val.last_modified * 1000).toISOString(),
  }));

  const watermarkList = Object.entries(s3.watermarks).map(([key, val]) => ({
    key,
    ...val.body,
    last_modified_iso: new Date(val.last_modified * 1000).toISOString(),
  }));

  const checkpointList = Object.entries(s3.checkpoints)
    .sort((a, b) => b[1].last_modified - a[1].last_modified)
    .slice(0, 50)
    .map(([key, val]) => ({
      key,
      ...val.body,
      last_modified_iso: new Date(val.last_modified * 1000).toISOString(),
    }));

  const deadletterList = Object.entries(s3.deadletter).map(([key, val]) => ({
    key,
    ...val.body,
    last_modified_iso: new Date(val.last_modified * 1000).toISOString(),
  }));

  return NextResponse.json({
    bucket: "telemetry-etl-state",
    locks: lockList,
    watermarks: watermarkList,
    checkpoints: checkpointList,
    deadletter: deadletterList,
    tsdb_sink_count: tsdb.length,
    recent_tsdb_writes: tsdb.slice(-15).reverse(),
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { action, hoursAgo } = body;
  const s3 = getMockS3();
  const now = Math.floor(Date.now() / 1000);

  if (action === "reset_watermarks") {
    const lookback = (hoursAgo || 2) * 3600;
    for (const key of Object.keys(s3.watermarks)) {
      const wTs = now - lookback;
      s3.watermarks[key] = {
        body: {
          job_id: key,
          watermark_timestamp: wTs,
          watermark_iso: new Date(wTs * 1000).toISOString(),
          last_committed_at: now,
          last_slice_metrics: 0,
          last_slice_samples: 0,
        },
        last_modified: now,
      };
    }
    return NextResponse.json({ status: "SUCCESS", message: `Watermarks reset to ${hoursAgo || 2} hours ago` });
  }

  if (action === "simulate_stale_lock") {
    s3.locks["locks/orchestrator.lock"] = {
      body: {
        instance_id: "orphan-runner-99a8bc",
        acquired_at: now - 60,
        expires_at: now + 240, // Active for another 4 minutes
        ttl_seconds: 300,
      },
      etag: '"stale-lock-etag-12345"',
      last_modified: now - 60,
    };
    return NextResponse.json({ status: "SUCCESS", message: "Created active mock S3 lock to simulate concurrency protection" });
  }

  if (action === "clear_lock") {
    delete s3.locks["locks/orchestrator.lock"];
    return NextResponse.json({ status: "SUCCESS", message: "S3 lock released manually" });
  }

  if (action === "clear_deadletter") {
    s3.deadletter = {};
    return NextResponse.json({ status: "SUCCESS", message: "Dead letter queue cleared" });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
