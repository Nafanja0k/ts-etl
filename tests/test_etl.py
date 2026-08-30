"""
Unit and Integration Test Suite for Telemetry ETL & Backfill Engine.
"""
import time
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    import pytest
except ImportError:
    pytest = None

from engine.config import (
    load_pipeline_registry,
    load_target_schema,
    load_mapping_spec,
    JobConfig,
)
from engine.lock import S3DistributedLock
from engine.watermark import S3StateManager
from engine.transformer import MetricTransformer
from engine.extractors.base import RawTimeSeries, RawSample
from engine.orchestrator import ETLOrchestrator


def test_specs_loading():
    registry = load_pipeline_registry("specs/pipeline_registry.yaml")
    assert len(registry.jobs) >= 2
    assert registry.jobs[0].job_id == "infra_k8s_prometheus"
    assert registry.jobs[0].query_delay_minutes == 10

    target_schema = load_target_schema("specs/target_metrics_schema.yaml")
    assert "system.cpu.utilization" in target_schema.target_standards
    assert "http.server.requests" in target_schema.target_standards

    mapping = load_mapping_spec("specs/mappings/k8s_prom.yaml")
    assert mapping.source_id == "infra_k8s_prometheus"
    assert len(mapping.rules) >= 1


def test_s3_distributed_lock():
    mock_s3 = {}
    lock1 = S3DistributedLock(bucket="test-bucket", ttl_seconds=60, mock_storage=mock_s3)
    lock2 = S3DistributedLock(bucket="test-bucket", ttl_seconds=60, mock_storage=mock_s3)

    # 1. Lock 1 acquires
    assert lock1.acquire() is True

    # 2. Lock 2 attempts and gets rejected (split-brain prevention)
    assert lock2.acquire() is False

    # 3. Lock 1 releases
    assert lock1.release() is True

    # 4. Lock 2 can now acquire
    assert lock2.acquire() is True
    assert lock2.release() is True


def test_metric_transformation_and_cardinality_trimming():
    target_schema = load_target_schema("specs/target_metrics_schema.yaml")
    mapping_spec = load_mapping_spec("specs/mappings/k8s_prom.yaml")
    transformer = MetricTransformer(target_schema, mapping_spec)

    raw_series = [
        RawTimeSeries(
            metric_name="node_cpu_seconds_total",
            tags={
                "instance": "node-01.internal",
                "app": "auth-service",
                "env": "production",
                "region": "us-east-1",
                # Volatile high-cardinality tags that MUST be pruned:
                "pod_uuid": "c3f8-8812-9999",
                "container_id": "docker://12345abc",
                "ip": "10.244.0.12",
                "job": "node-exporter",
            },
            samples=[
                RawSample(timestamp_ms=1700000000000, value=0.75),
                RawSample(timestamp_ms=1700000060000, value=0.82),
            ],
        )
    ]

    result = transformer.transform(raw_series)
    assert len(result.valid_series) == 1
    assert len(result.quarantined_series) == 0
    assert result.dropped_tags_count >= 4  # Dropped pod_uuid, container_id, ip, job

    transformed = result.valid_series[0]
    assert transformed.metric_name == "system.cpu.utilization"
    assert transformed.labels["host.name"] == "node-01.internal"
    assert transformed.labels["service.name"] == "auth-service"
    assert transformed.labels["deployment.environment"] == "production"
    assert transformed.labels["source.system"] == "prometheus-k8s"
    # Ensure forbidden/volatile tags are NOT present
    assert "pod_uuid" not in transformed.labels
    assert "container_id" not in transformed.labels
    assert "ip" not in transformed.labels


def test_unit_conversion_percentage_to_ratio():
    target_schema = load_target_schema("specs/target_metrics_schema.yaml")
    mapping_spec = load_mapping_spec("specs/mappings/graphite_infra.yaml")
    transformer = MetricTransformer(target_schema, mapping_spec)

    raw_series = [
        RawTimeSeries(
            metric_name="servers.us-east.srv01.billing.memory.percent_used",
            tags={
                "_raw_graphite_path": "servers.us-east.srv01.billing.memory.percent_used"
            },
            samples=[
                RawSample(timestamp_ms=1700000000000, value=85.5),  # 85.5%
            ],
        )
    ]

    result = transformer.transform(raw_series)
    assert len(result.valid_series) == 1
    ts = result.valid_series[0]
    assert ts.metric_name == "system.memory.utilization"
    assert ts.labels["cloud.region"] == "us-east"
    assert ts.labels["host.name"] == "srv01"
    assert ts.labels["service.name"] == "billing"
    # 85.5% converted to ratio 0.855
    assert ts.samples[0].value == 0.855


def test_dead_letter_quarantine_on_missing_dimensions():
    target_schema = load_target_schema("specs/target_metrics_schema.yaml")
    mapping_spec = load_mapping_spec("specs/mappings/k8s_prom.yaml")
    transformer = MetricTransformer(target_schema, mapping_spec)

    # Missing mandatory "env" label
    raw_series = [
        RawTimeSeries(
            metric_name="node_cpu_seconds_total",
            tags={
                "instance": "node-01.internal",
                "app": "auth-service",
                # "env" is intentionally missing
            },
            samples=[RawSample(timestamp_ms=1700000000000, value=0.5)],
        )
    ]

    result = transformer.transform(raw_series)
    assert len(result.valid_series) == 0
    assert len(result.quarantined_series) == 1
    assert "MISSING_REQUIRED_DIMENSIONS" in result.quarantined_series[0]["reason"]


def test_orchestrator_catch_up_loop():
    mock_s3 = {}
    mock_tsdb = []
    orchestrator = ETLOrchestrator(
        s3_bucket="test-bucket",
        mock_storage=mock_s3,
        mock_tsdb_sink=mock_tsdb,
    )

    # Run ETL cycle
    summary = orchestrator.run()
    assert summary["status"] == "SUCCESS"
    assert summary["lease_acquired"] is True
    assert summary["total_slices"] > 0
    assert summary["total_metrics_exported"] > 0

    # Ensure S3 lease was released after completion
    assert f"test-bucket/locks/orchestrator.lock" not in mock_s3

if __name__ == "__main__":
    print("Running Telemetry ETL Test Suite...")
    test_specs_loading()
    print("✓ test_specs_loading passed")
    test_s3_distributed_lock()
    print("✓ test_s3_distributed_lock passed")
    test_metric_transformation_and_cardinality_trimming()
    print("✓ test_metric_transformation_and_cardinality_trimming passed")
    test_unit_conversion_percentage_to_ratio()
    print("✓ test_unit_conversion_percentage_to_ratio passed")
    test_dead_letter_quarantine_on_missing_dimensions()
    print("✓ test_dead_letter_quarantine_on_missing_dimensions passed")
    test_orchestrator_catch_up_loop()
    print("✓ test_orchestrator_catch_up_loop passed")
    print("\nALL 6 TEST CASES PASSED SUCCESSFULLY!")
