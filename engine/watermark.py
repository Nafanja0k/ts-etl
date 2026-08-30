"""
S3 Monotonic Watermark and Checkpoint Manager.
Maintains state in zero-database S3 object paths:
- watermarks/<job_id>.json
- checkpoints/<job_id>/<start_iso>.done
- deadletter/<job_id>/<timestamp>.json
"""
import json
import time
from datetime import datetime, timezone
import logging
from typing import Optional, Dict, Any, List

logger = logging.getLogger("telemetry_etl.watermark")


class S3StateManager:
    def __init__(
        self,
        bucket: str,
        s3_client: Optional[Any] = None,
        mock_storage: Optional[Dict[str, Any]] = None,
    ):
        self.bucket = bucket
        self.s3_client = s3_client
        self.mock_storage = mock_storage if mock_storage is not None else {}

    def get_watermark(self, job_id: str, default_lookback_seconds: int = 3600) -> int:
        """
        Read watermark timestamp (unix seconds). If not found, returns (now - default_lookback).
        """
        key = f"watermarks/{job_id}.json"
        now = int(time.time())
        default_watermark = now - default_lookback_seconds

        if self.s3_client:
            try:
                resp = self.s3_client.get_object(Bucket=self.bucket, Key=key)
                data = json.loads(resp["Body"].read().decode("utf-8"))
                watermark = int(data.get("watermark_timestamp", default_watermark))
                logger.info(f"Loaded watermark for {job_id}: {watermark} ({datetime.fromtimestamp(watermark, tz=timezone.utc).isoformat()})")
                return watermark
            except Exception:
                logger.info(f"No previous watermark for {job_id}. Initializing to lookback default: {default_watermark}")
                return default_watermark
        else:
            item = self.mock_storage.get(f"{self.bucket}/{key}")
            if item:
                data = json.loads(item["body"].decode("utf-8"))
                watermark = int(data.get("watermark_timestamp", default_watermark))
                logger.info(f"[Mock S3] Watermark for {job_id}: {watermark}")
                return watermark
            return default_watermark

    def commit_slice(
        self,
        job_id: str,
        slice_start: int,
        slice_end: int,
        metrics_count: int,
        samples_count: int,
    ) -> bool:
        """
        Idempotently commit slice checkpoint marker and advance monotonic watermark.
        """
        start_iso = datetime.fromtimestamp(slice_start, tz=timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        end_iso = datetime.fromtimestamp(slice_end, tz=timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        
        checkpoint_key = f"checkpoints/{job_id}/{start_iso}.done"
        watermark_key = f"watermarks/{job_id}.json"
        
        metadata = {
            "job_id": job_id,
            "slice_start": slice_start,
            "slice_end": slice_end,
            "slice_start_iso": start_iso,
            "slice_end_iso": end_iso,
            "committed_at": int(time.time()),
            "metrics_count": metrics_count,
            "samples_count": samples_count,
            "status": "COMPLETED",
        }
        
        checkpoint_body = json.dumps(metadata, indent=2).encode("utf-8")
        
        watermark_payload = {
            "job_id": job_id,
            "watermark_timestamp": slice_end,
            "watermark_iso": end_iso,
            "last_committed_at": int(time.time()),
            "last_slice_metrics": metrics_count,
            "last_slice_samples": samples_count,
        }
        watermark_body = json.dumps(watermark_payload, indent=2).encode("utf-8")

        if self.s3_client:
            try:
                # 1. Put zero-byte/metadata checkpoint marker
                self.s3_client.put_object(
                    Bucket=self.bucket,
                    Key=checkpoint_key,
                    Body=checkpoint_body,
                    ContentType="application/json",
                )
                # 2. Advance monotonic watermark
                self.s3_client.put_object(
                    Bucket=self.bucket,
                    Key=watermark_key,
                    Body=watermark_body,
                    ContentType="application/json",
                )
                logger.info(f"Committed slice [{start_iso} -> {end_iso}) for job {job_id}")
                return True
            except Exception as e:
                logger.error(f"Failed committing slice to S3: {e}")
                return False
        else:
            self.mock_storage[f"{self.bucket}/{checkpoint_key}"] = {
                "body": checkpoint_body,
                "last_modified": int(time.time()),
            }
            self.mock_storage[f"{self.bucket}/{watermark_key}"] = {
                "body": watermark_body,
                "last_modified": int(time.time()),
            }
            logger.info(f"[Mock S3] Committed slice [{start_iso} -> {end_iso}) for {job_id}")
            return True

    def put_dead_letter(self, job_id: str, quarantined_items: List[Dict[str, Any]]) -> None:
        """
        Quarantine non-compliant series into S3 dead-letter prefix.
        """
        if not quarantined_items:
            return
        
        now_iso = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        key = f"deadletter/{job_id}/{now_iso}.json"
        payload = {
            "job_id": job_id,
            "timestamp": int(time.time()),
            "count": len(quarantined_items),
            "items": quarantined_items,
        }
        body = json.dumps(payload, indent=2).encode("utf-8")
        
        if self.s3_client:
            try:
                self.s3_client.put_object(
                    Bucket=self.bucket,
                    Key=key,
                    Body=body,
                    ContentType="application/json",
                )
                logger.warning(f"Quarantined {len(quarantined_items)} series to s3://{self.bucket}/{key}")
            except Exception as e:
                logger.error(f"Failed to write dead letter: {e}")
        else:
            self.mock_storage[f"{self.bucket}/{key}"] = {
                "body": body,
                "last_modified": int(time.time()),
            }
            logger.warning(f"[Mock S3] Quarantined {len(quarantined_items)} series to {key}")
