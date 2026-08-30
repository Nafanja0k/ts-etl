#!/usr/bin/env python3
"""
Nobl9-Inspired Serverless Telemetry ETL Engine CLI Entrypoint.
Usage:
    python main.py [--job-id infra_k8s_prometheus] [--dry-run]
"""
import argparse
import sys
import json
import logging
from datetime import datetime, timezone
from engine.orchestrator import ETLOrchestrator

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [%(name)s] %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%SZ",
)
logger = logging.getLogger("telemetry_etl.cli")


def main():
    parser = argparse.ArgumentParser(
        description="Nobl9-Inspired Stateless Pull-Based Telemetry ETL & Backfill Engine"
    )
    parser.add_argument(
        "--job-id",
        type=str,
        default=None,
        help="Specific job ID to execute from specs/pipeline_registry.yaml (defaults to all)",
    )
    parser.add_argument(
        "--registry",
        type=str,
        default="specs/pipeline_registry.yaml",
        help="Path to pipeline registry YAML",
    )
    parser.add_argument(
        "--target-schema",
        type=str,
        default="specs/target_metrics_schema.yaml",
        help="Path to target metrics schema YAML",
    )
    parser.add_argument(
        "--target-tsdb",
        type=str,
        default="http://victoriametrics.internal:8428/api/v1/write",
        help="Prometheus Remote-Write Target Endpoint",
    )
    parser.add_argument(
        "--s3-bucket",
        type=str,
        default="telemetry-etl-state",
        help="S3 bucket for distributed lease, watermarks, checkpoints, and dead-letter",
    )
    parser.add_argument(
        "--backfill-start",
        type=str,
        default=None,
        help="Optional backfill start ISO string (e.g. 2026-08-29T00:00:00Z) or epoch seconds",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Run ETL in memory without mutating S3 or target TSDB",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Enable debug logging output",
    )

    args = parser.parse_args()

    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    backfill_ts = None
    if args.backfill_start:
        try:
            if args.backfill_start.isdigit():
                backfill_ts = int(args.backfill_start)
            else:
                dt = datetime.fromisoformat(args.backfill_start.replace("Z", "+00:00"))
                backfill_ts = int(dt.timestamp())
            logger.info(f"Configured manual backfill start: {backfill_ts}")
        except Exception as e:
            logger.error(f"Invalid --backfill-start timestamp: {e}")
            sys.exit(1)

    orchestrator = ETLOrchestrator(
        s3_bucket=args.s3_bucket,
        registry_path=args.registry,
        target_schema_path=args.target_schema,
        target_tsdb_url=args.target_tsdb,
    )

    logger.info("Initializing Telemetry ETL Orchestration cycle...")
    result = orchestrator.run(
        specific_job_id=args.job_id,
        backfill_start_ts=backfill_ts,
    )

    print("\n" + "=" * 60)
    print("ETL EXECUTION SUMMARY:")
    print("=" * 60)
    print(json.dumps(result, indent=2))
    print("=" * 60 + "\n")

    if result.get("status") in ["SUCCESS", "SKIPPED_LOCK_HELD"]:
        sys.exit(0)
    else:
        sys.exit(1)


if __name__ == "__main__":
    main()
