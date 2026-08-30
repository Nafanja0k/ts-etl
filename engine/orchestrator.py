"""
Orchestrator and ETL Runner.
Coordinates S3 Lease acquisition, watermark detection, Nobl9 safe-window calculation,
gap remediation loop, extraction with push-down downsampling, cardinality governance,
and Prometheus Remote-Write batching.
"""
import time
import logging
from datetime import datetime, timezone
from typing import Dict, List, Any, Optional

from .config import (
    load_pipeline_registry,
    load_target_schema,
    load_mapping_spec,
    JobConfig,
    PipelineRegistry,
    TargetMetricsSchema,
)
from .lock import S3DistributedLock
from .watermark import S3StateManager
from .extractors import PrometheusExtractor, GraphiteExtractor, SplunkExtractor, BaseExtractor
from .transformer import MetricTransformer
from .remote_write import RemoteWriteExporter

logger = logging.getLogger("telemetry_etl.orchestrator")


class ETLOrchestrator:
    def __init__(
        self,
        s3_bucket: str = "telemetry-etl-state",
        registry_path: str = "specs/pipeline_registry.yaml",
        target_schema_path: str = "specs/target_metrics_schema.yaml",
        target_tsdb_url: str = "http://victoriametrics.internal:8428/api/v1/write",
        s3_client: Optional[Any] = None,
        mock_storage: Optional[Dict[str, Any]] = None,
        mock_tsdb_sink: Optional[List[Dict[str, Any]]] = None,
    ):
        self.s3_bucket = s3_bucket
        self.registry_path = registry_path
        self.target_schema_path = target_schema_path
        self.target_tsdb_url = target_tsdb_url
        
        self.mock_storage = mock_storage if mock_storage is not None else {}
        self.mock_tsdb_sink = mock_tsdb_sink if mock_tsdb_sink is not None else []
        
        self.lock_manager = S3DistributedLock(
            bucket=s3_bucket,
            s3_client=s3_client,
            mock_storage=self.mock_storage,
        )
        self.state_manager = S3StateManager(
            bucket=s3_bucket,
            s3_client=s3_client,
            mock_storage=self.mock_storage,
        )
        self.exporter = RemoteWriteExporter(
            endpoint_url=target_tsdb_url,
            mock_sink=self.mock_tsdb_sink,
        )

    def run(self, specific_job_id: Optional[str] = None, backfill_start_ts: Optional[int] = None) -> Dict[str, Any]:
        """
        Main runner execution cycle.
        """
        start_wall_time = time.time()
        now_ts = int(time.time())
        summary: Dict[str, Any] = {
            "execution_id": self.lock_manager.instance_id,
            "started_at": datetime.fromtimestamp(now_ts, tz=timezone.utc).isoformat(),
            "status": "RUNNING",
            "jobs_processed": [],
            "total_slices": 0,
            "total_metrics_exported": 0,
            "total_samples_exported": 0,
            "total_dropped_tags": 0,
            "total_quarantined": 0,
            "lease_acquired": False,
        }

        # Step 1: Acquire Distributed S3 Lease
        logger.info(f"Attempting to acquire S3 Lease on s3://{self.s3_bucket}/locks/orchestrator.lock")
        if not self.lock_manager.acquire():
            summary["status"] = "SKIPPED_LOCK_HELD"
            summary["message"] = "Another orchestrator instance holds the S3 lease."
            logger.warning(summary["message"])
            return summary

        summary["lease_acquired"] = True

        try:
            # Step 2: Load Specs
            registry = load_pipeline_registry(self.registry_path)
            target_schema = load_target_schema(self.target_schema_path)

            jobs_to_run = [
                j for j in registry.jobs
                if j.enabled and (not specific_job_id or j.job_id == specific_job_id)
            ]

            if not jobs_to_run:
                summary["status"] = "NO_JOBS_MATCHED"
                return summary

            for job in jobs_to_run:
                job_result = self._process_job(job, target_schema, now_ts, backfill_start_ts)
                summary["jobs_processed"].append(job_result)
                summary["total_slices"] += job_result.get("slices_processed", 0)
                summary["total_metrics_exported"] += job_result.get("metrics_exported", 0)
                summary["total_samples_exported"] += job_result.get("samples_exported", 0)
                summary["total_dropped_tags"] += job_result.get("dropped_tags", 0)
                summary["total_quarantined"] += job_result.get("quarantined_series", 0)

            summary["status"] = "SUCCESS"

        except Exception as e:
            logger.error(f"Fatal error during ETL run: {e}", exc_info=True)
            summary["status"] = "ERROR"
            summary["error"] = str(e)

        finally:
            # Step 3: Release S3 Lease & Terminate Process (Compute drops to $0.00)
            self.lock_manager.release()
            duration = round(time.time() - start_wall_time, 3)
            summary["duration_seconds"] = duration
            summary["completed_at"] = datetime.now(timezone.utc).isoformat()
            logger.info(f"ETL cycle complete in {duration}s. Lock released.")

        return summary

    def _process_job(
        self,
        job: JobConfig,
        target_schema: TargetMetricsSchema,
        now_ts: int,
        backfill_start_ts: Optional[int] = None,
    ) -> Dict[str, Any]:
        logger.info(f"Processing job: {job.job_id} ({job.source_type})")
        mapping_spec = load_mapping_spec(job.mapping_spec)
        transformer = MetricTransformer(target_schema, mapping_spec)
        extractor = self._create_extractor(job, mapping_spec)

        # 1. Nobl9 Safe Limit Calculation: t_safe = t_now - query_delay
        query_delay_sec = job.query_delay_minutes * 60
        safe_limit_ts = now_ts - query_delay_sec

        # 2. Determine Watermark
        if backfill_start_ts:
            current_watermark = backfill_start_ts
        else:
            default_lookback = job.chunk_minutes * 60 * 2  # Default to 2 chunks back
            current_watermark = self.state_manager.get_watermark(job.job_id, default_lookback)

        chunk_size_sec = job.chunk_minutes * 60

        slices = []
        curr = current_watermark
        while curr + chunk_size_sec <= safe_limit_ts:
            slices.append((curr, curr + chunk_size_sec))
            curr += chunk_size_sec

        # If gap is smaller than a full chunk but behind safe limit, create one partial/active slice
        if not slices and curr < safe_limit_ts and (safe_limit_ts - curr) >= 60:
            slices.append((curr, safe_limit_ts))

        job_summary: Dict[str, Any] = {
            "job_id": job.job_id,
            "source_type": job.source_type,
            "watermark_start": current_watermark,
            "safe_limit": safe_limit_ts,
            "slices_processed": 0,
            "metrics_exported": 0,
            "samples_exported": 0,
            "dropped_tags": 0,
            "quarantined_series": 0,
            "slices_detail": [],
        }

        if not slices:
            logger.info(f"Job {job.job_id} is already caught up to safe limit {safe_limit_ts}.")
            return job_summary

        logger.info(f"Job {job.job_id} catch-up loop: {len(slices)} slices to process.")

        # 3. Chronological Catch-Up Loop
        for slice_start, slice_end in slices:
            slice_res = self._process_slice(job, extractor, transformer, slice_start, slice_end)
            job_summary["slices_processed"] += 1
            job_summary["metrics_exported"] += slice_res["metrics_exported"]
            job_summary["samples_exported"] += slice_res["samples_exported"]
            job_summary["dropped_tags"] += slice_res["dropped_tags"]
            job_summary["quarantined_series"] += slice_res["quarantined"]
            job_summary["slices_detail"].append(slice_res)

        return job_summary

    def _process_slice(
        self,
        job: JobConfig,
        extractor: BaseExtractor,
        transformer: MetricTransformer,
        start_ts: int,
        end_ts: int,
    ) -> Dict[str, Any]:
        start_iso = datetime.fromtimestamp(start_ts, tz=timezone.utc).isoformat()
        end_iso = datetime.fromtimestamp(end_ts, tz=timezone.utc).isoformat()

        logger.info(f"Running slice [{start_iso} -> {end_iso}) for {job.job_id}")

        # a. Extract & Push-Down Downsample
        raw_series = extractor.extract(start_ts, end_ts)

        # b. Normalize, Enrich & Trim Cardinality
        transform_res = transformer.transform(raw_series)

        # Handle quarantined series in S3 dead-letter queue
        if transform_res.quarantined_series:
            self.state_manager.put_dead_letter(job.job_id, transform_res.quarantined_series)

        # c. Bulk Export to Prometheus Remote-Write
        export_summary = self.exporter.export(transform_res.valid_series)

        # d. Commit State to S3 (Checkpoint marker + Watermark)
        self.state_manager.commit_slice(
            job_id=job.job_id,
            slice_start=start_ts,
            slice_end=end_ts,
            metrics_count=export_summary.exported_series,
            samples_count=export_summary.exported_samples,
        )

        return {
            "slice_start": start_ts,
            "slice_end": end_ts,
            "slice_start_iso": start_iso,
            "slice_end_iso": end_iso,
            "raw_series_count": transform_res.total_raw_series,
            "metrics_exported": export_summary.exported_series,
            "samples_exported": export_summary.exported_samples,
            "dropped_tags": transform_res.dropped_tags_count,
            "quarantined": len(transform_res.quarantined_series),
            "payload_bytes": export_summary.payload_bytes,
        }

    def _create_extractor(self, job: JobConfig, mapping_spec: Any) -> BaseExtractor:
        st = job.source_type.lower()
        if st == "prometheus":
            return PrometheusExtractor(job, mapping_spec)
        elif st == "splunk_o11y":
            return SplunkExtractor(job, mapping_spec)
        elif st == "graphite":
            return GraphiteExtractor(job, mapping_spec)
        else:
            raise ValueError(f"Unsupported source_type: {job.source_type}")
