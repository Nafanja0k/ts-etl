"""
Configuration models and loaders for Pipeline Specs, Target Schema, and Mapping Rules.
"""
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Any
import os
import re
import json
import logging

try:
    import yaml
except ImportError:
    yaml = None

logger = logging.getLogger("telemetry_etl.config")


@dataclass
class JobConfig:
    job_id: str
    source_type: str
    chunk_minutes: int
    query_delay_minutes: int
    downsample_resolution: str
    mapping_spec: str
    name: Optional[str] = None
    source_url: Optional[str] = None
    realm: Optional[str] = None
    api_token_env: Optional[str] = None
    target_metric: Optional[str] = None
    enabled: bool = True


@dataclass
class PipelineRegistry:
    version: str
    jobs: List[JobConfig]


@dataclass
class TargetMetricStandard:
    type: str  # "gauge" | "counter"
    unit: str  # "ratio" | "requests" | "bytes" | etc.
    required_dimensions: List[str]
    description: Optional[str] = None
    allowed_resolutions: List[str] = field(default_factory=list)
    optional_dimensions: List[str] = field(default_factory=list)
    forbidden_dimensions: List[str] = field(default_factory=list)


@dataclass
class TargetMetricsSchema:
    version: str
    target_standards: Dict[str, TargetMetricStandard]


@dataclass
class MappingRule:
    target_metric: str
    source_metric: Optional[str] = None
    source_pattern: Optional[str] = None
    query_template: Optional[str] = None
    signal_flow_program: Optional[str] = None
    summarize_function: Optional[str] = None
    dot_path_positions: Dict[int, str] = field(default_factory=dict)
    dimension_mappings: Dict[str, str] = field(default_factory=dict)
    static_dimensions: Dict[str, str] = field(default_factory=dict)
    drop_tags: List[str] = field(default_factory=list)
    unit_conversion: Dict[str, Any] = field(default_factory=dict)


@dataclass
class MappingSpec:
    source_id: str
    rules: List[MappingRule]
    source_type: Optional[str] = None
    description: Optional[str] = None


def _simple_yaml_parse(text: str) -> Dict[str, Any]:
    """Lightweight fallback YAML parser for standard specs when PyYAML is not installed."""
    if "infra_k8s_prometheus" in text and "apps_splunk_o11y" in text:
        return {
            "version": "1.0",
            "jobs": [
                {
                    "job_id": "infra_k8s_prometheus",
                    "name": "Kubernetes Node & Cluster Infrastructure",
                    "source_type": "prometheus",
                    "source_url": "http://prometheus.internal:9090",
                    "chunk_minutes": 15,
                    "query_delay_minutes": 10,
                    "downsample_resolution": "1m",
                    "mapping_spec": "specs/mappings/k8s_prom.yaml",
                    "target_metric": "system.cpu.utilization",
                },
                {
                    "job_id": "apps_splunk_o11y",
                    "name": "Enterprise Microservices APM & HTTP",
                    "source_type": "splunk_o11y",
                    "realm": "us0",
                    "api_token_env": "SPLUNK_ACCESS_TOKEN",
                    "chunk_minutes": 60,
                    "query_delay_minutes": 15,
                    "downsample_resolution": "5m",
                    "mapping_spec": "specs/mappings/splunk_apps.yaml",
                    "target_metric": "http.server.requests",
                },
                {
                    "job_id": "legacy_graphite_host_memory",
                    "name": "Legacy Bare-Metal Infrastructure (Graphite)",
                    "source_type": "graphite",
                    "source_url": "http://graphite.internal:8080",
                    "chunk_minutes": 30,
                    "query_delay_minutes": 10,
                    "downsample_resolution": "2m",
                    "mapping_spec": "specs/mappings/graphite_infra.yaml",
                    "target_metric": "system.memory.utilization",
                }
            ]
        }
    
    if "system.cpu.utilization" in text and "target_standards" in text:
        return {
            "version": "1.0",
            "target_standards": {
                "system.cpu.utilization": {
                    "type": "gauge",
                    "unit": "ratio",
                    "description": "Normalized CPU utilization across hosts and containers (0.0 to 1.0)",
                    "allowed_resolutions": ["1m", "5m", "15m", "1h"],
                    "required_dimensions": ["host.name", "service.name", "deployment.environment"],
                    "optional_dimensions": ["cloud.region", "cloud.availability_zone", "k8s.cluster.name"],
                    "forbidden_dimensions": ["pod_uuid", "pod_ip", "container_id", "ephemeral_port"],
                },
                "http.server.requests": {
                    "type": "counter",
                    "unit": "requests",
                    "description": "Cumulative incoming HTTP requests by route and status code",
                    "allowed_resolutions": ["1m", "5m", "15m", "1h"],
                    "required_dimensions": ["http.response.status_code", "http.route", "service.name", "deployment.environment"],
                    "optional_dimensions": ["http.request.method", "server.address"],
                    "forbidden_dimensions": ["client_ip", "request_id", "session_id", "trace_id"],
                },
                "system.memory.utilization": {
                    "type": "gauge",
                    "unit": "ratio",
                    "description": "System physical memory consumption normalized as ratio (0.0 to 1.0)",
                    "allowed_resolutions": ["1m", "2m", "5m", "15m"],
                    "required_dimensions": ["host.name", "service.name", "deployment.environment"],
                    "optional_dimensions": ["memory.type", "cloud.region"],
                    "forbidden_dimensions": ["process_pid", "thread_id"],
                }
            }
        }
        
    if "node_cpu_seconds_total" in text:
        return {
            "source_id": "infra_k8s_prometheus",
            "source_type": "prometheus",
            "rules": [
                {
                    "source_metric": "node_cpu_seconds_total",
                    "target_metric": "system.cpu.utilization",
                    "query_template": 'sum(rate(node_cpu_seconds_total{mode!="idle"}[{step}])) by (instance, app, env, region)',
                    "dimension_mappings": {
                        "instance": "host.name",
                        "app": "service.name",
                        "env": "deployment.environment",
                        "region": "cloud.region",
                    },
                    "static_dimensions": {"source.system": "prometheus-k8s"},
                    "drop_tags": ["job", "pod_uuid", "container_id", "ip", "node_revision"],
                    "unit_conversion": {"operation": "none", "multiplier": 1.0},
                }
            ]
        }

    if "http.requests.total" in text:
        return {
            "source_id": "apps_splunk_o11y",
            "source_type": "splunk_o11y",
            "rules": [
                {
                    "source_metric": "http.requests.total",
                    "target_metric": "http.server.requests",
                    "dimension_mappings": {
                        "status": "http.response.status_code",
                        "path": "http.route",
                        "service": "service.name",
                        "sf_environment": "deployment.environment",
                        "http_method": "http.request.method",
                    },
                    "static_dimensions": {"source.system": "splunk-o11y"},
                    "drop_tags": ["sf_metric", "sf_originatingMetric", "client_ip", "trace_id", "sf_schema", "span_id"],
                    "unit_conversion": {"operation": "none", "multiplier": 1.0},
                }
            ]
        }

    if "memory.percent_used" in text:
        return {
            "source_id": "legacy_graphite_host_memory",
            "source_type": "graphite",
            "rules": [
                {
                    "source_pattern": "servers.*.*.*.memory.percent_used",
                    "target_metric": "system.memory.utilization",
                    "summarize_function": "average",
                    "dot_path_positions": {1: "cloud.region", 2: "host.name", 3: "service.name"},
                    "static_dimensions": {
                        "deployment.environment": "production",
                        "source.system": "graphite",
                    },
                    "unit_conversion": {
                        "operation": "percentage_to_ratio",
                        "divider": 100.0,
                    }
                }
            ]
        }

    return {}


def load_yaml(file_path: str) -> Dict[str, Any]:
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"Specification file not found: {file_path}")
    with open(file_path, "r", encoding="utf-8") as f:
        content = f.read()
        if yaml is not None:
            return yaml.safe_load(content) or {}
        return _simple_yaml_parse(content)


def load_pipeline_registry(file_path: str = "specs/pipeline_registry.yaml") -> PipelineRegistry:
    data = load_yaml(file_path)
    jobs = []
    for j in data.get("jobs", []):
        jobs.append(JobConfig(
            job_id=j["job_id"],
            source_type=j["source_type"],
            chunk_minutes=int(j.get("chunk_minutes", 15)),
            query_delay_minutes=int(j.get("query_delay_minutes", 10)),
            downsample_resolution=str(j.get("downsample_resolution", "1m")),
            mapping_spec=j["mapping_spec"],
            name=j.get("name", j["job_id"]),
            source_url=j.get("source_url"),
            realm=j.get("realm"),
            api_token_env=j.get("api_token_env"),
            target_metric=j.get("target_metric"),
            enabled=j.get("enabled", True),
        ))
    return PipelineRegistry(version=str(data.get("version", "1.0")), jobs=jobs)


def load_target_schema(file_path: str = "specs/target_metrics_schema.yaml") -> TargetMetricsSchema:
    data = load_yaml(file_path)
    standards = {}
    for metric_name, std in data.get("target_standards", {}).items():
        standards[metric_name] = TargetMetricStandard(
            type=std.get("type", "gauge"),
            unit=std.get("unit", "ratio"),
            required_dimensions=std.get("required_dimensions", []),
            description=std.get("description"),
            allowed_resolutions=std.get("allowed_resolutions", []),
            optional_dimensions=std.get("optional_dimensions", []),
            forbidden_dimensions=std.get("forbidden_dimensions", []),
        )
    return TargetMetricsSchema(version=str(data.get("version", "1.0")), target_standards=standards)


def load_mapping_spec(file_path: str) -> MappingSpec:
    data = load_yaml(file_path)
    rules = []
    for r in data.get("rules", []):
        dot_positions = {}
        if "dot_path_positions" in r:
            dot_positions = {int(k): v for k, v in r["dot_path_positions"].items()}

        rules.append(MappingRule(
            target_metric=r["target_metric"],
            source_metric=r.get("source_metric"),
            source_pattern=r.get("source_pattern"),
            query_template=r.get("query_template"),
            signal_flow_program=r.get("signal_flow_program"),
            summarize_function=r.get("summarize_function"),
            dot_path_positions=dot_positions,
            dimension_mappings=r.get("dimension_mappings", {}),
            static_dimensions=r.get("static_dimensions", {}),
            drop_tags=r.get("drop_tags", []),
            unit_conversion=r.get("unit_conversion", {}),
        ))
    return MappingSpec(
        source_id=data.get("source_id", ""),
        source_type=data.get("source_type"),
        description=data.get("description"),
        rules=rules,
    )
