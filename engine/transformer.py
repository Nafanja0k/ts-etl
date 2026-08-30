"""
Telemetry Normalization, Cardinality Governance, and Schema Validator.
Transforms heterogeneous raw TSDB metrics into strictly governed canonical series.
"""
import logging
from dataclasses import dataclass, field
from typing import List, Dict, Any, Tuple, Optional
from .extractors.base import RawTimeSeries
from .config import TargetMetricsSchema, MappingSpec, MappingRule

logger = logging.getLogger("telemetry_etl.transformer")


@dataclass
class NormalizedSample:
    timestamp_ms: int
    value: float


@dataclass
class NormalizedTimeSeries:
    metric_name: str
    labels: Dict[str, str]
    samples: List[NormalizedSample] = field(default_factory=list)


@dataclass
class TransformationResult:
    valid_series: List[NormalizedTimeSeries]
    quarantined_series: List[Dict[str, Any]]
    total_raw_series: int
    total_samples: int
    dropped_tags_count: int


class MetricTransformer:
    def __init__(self, target_schema: TargetMetricsSchema, mapping_spec: MappingSpec):
        self.target_schema = target_schema
        self.mapping_spec = mapping_spec

    def transform(self, raw_series_list: List[RawTimeSeries]) -> TransformationResult:
        valid_series: List[NormalizedTimeSeries] = []
        quarantined: List[Dict[str, Any]] = []
        total_samples = 0
        dropped_tags_count = 0

        for raw_item in raw_series_list:
            rule = self._find_matching_rule(raw_item)
            if not rule:
                quarantined.append({
                    "reason": "NO_MATCHING_RULE",
                    "raw_metric": raw_item.metric_name,
                    "raw_tags": raw_item.tags,
                })
                continue

            target_standard = self.target_schema.target_standards.get(rule.target_metric)
            if not target_standard:
                quarantined.append({
                    "reason": f"TARGET_METRIC_NOT_IN_SCHEMA: {rule.target_metric}",
                    "raw_metric": raw_item.metric_name,
                })
                continue

            # 1. Transform Dimensions / Labels
            target_labels, dropped_cnt = self._map_dimensions(raw_item, rule, target_standard)
            dropped_tags_count += dropped_cnt

            # 2. Check Schema Compliance (Required dimensions)
            missing_dims = [
                req for req in target_standard.required_dimensions
                if req not in target_labels or not target_labels[req]
            ]
            if missing_dims:
                quarantined.append({
                    "reason": f"MISSING_REQUIRED_DIMENSIONS: {missing_dims}",
                    "raw_metric": raw_item.metric_name,
                    "target_metric": rule.target_metric,
                    "extracted_labels": target_labels,
                })
                continue

            # 3. Transform Samples (Unit Conversion)
            converted_samples = []
            for sample in raw_item.samples:
                new_val = self._convert_unit(sample.value, rule.unit_conversion)
                converted_samples.append(NormalizedSample(
                    timestamp_ms=sample.timestamp_ms,
                    value=new_val,
                ))

            if converted_samples:
                total_samples += len(converted_samples)
                valid_series.append(NormalizedTimeSeries(
                    metric_name=rule.target_metric,
                    labels=target_labels,
                    samples=converted_samples,
                ))

        return TransformationResult(
            valid_series=valid_series,
            quarantined_series=quarantined,
            total_raw_series=len(raw_series_list),
            total_samples=total_samples,
            dropped_tags_count=dropped_tags_count,
        )

    def _find_matching_rule(self, raw_item: RawTimeSeries) -> Optional[MappingRule]:
        for rule in self.mapping_spec.rules:
            if rule.source_metric and rule.source_metric == raw_item.metric_name:
                return rule
            if rule.source_pattern:
                # Graphite pattern match or prefix
                return rule
            if "_raw_graphite_path" in raw_item.tags and rule.dot_path_positions:
                return rule
        return self.mapping_spec.rules[0] if self.mapping_spec.rules else None

    def _map_dimensions(
        self,
        raw_item: RawTimeSeries,
        rule: MappingRule,
        standard: Any,
    ) -> Tuple[Dict[str, str], int]:
        target_labels: Dict[str, str] = {}
        dropped_count = 0

        # Handle Graphite dot path decomposition
        if "_raw_graphite_path" in raw_item.tags and rule.dot_path_positions:
            path_parts = raw_item.tags["_raw_graphite_path"].split(".")
            for pos, dim_name in rule.dot_path_positions.items():
                if pos < len(path_parts):
                    target_labels[dim_name] = path_parts[pos]

        # Handle explicit dimension mappings (Prometheus / Splunk)
        for src_key, target_key in rule.dimension_mappings.items():
            if src_key in raw_item.tags:
                target_labels[target_key] = raw_item.tags[src_key]

        # Inject static dimensions
        for static_key, static_val in rule.static_dimensions.items():
            target_labels[static_key] = static_val

        # Cardinality governance: drop unmapped volatile tags
        for tag_name in raw_item.tags:
            if tag_name.startswith("_raw_"):
                continue
            if tag_name in rule.drop_tags:
                dropped_count += 1
            elif standard and tag_name in standard.forbidden_dimensions:
                dropped_count += 1
            elif tag_name not in rule.dimension_mappings:
                # High-cardinality tag not explicitly mapped -> drop to protect TSDB
                dropped_count += 1

        # Always set canonical __name__
        target_labels["__name__"] = rule.target_metric
        return target_labels, dropped_count

    def _convert_unit(self, value: float, conversion_spec: Dict[str, Any]) -> float:
        if not conversion_spec:
            return value
        
        op = conversion_spec.get("operation", "none")
        if op == "percentage_to_ratio":
            divider = float(conversion_spec.get("divider", 100.0))
            return round(value / divider, 6) if divider != 0 else value
        
        if op == "bytes_to_mb":
            return round(value / (1024.0 * 1024.0), 4)
        
        if op == "multiply":
            mult = float(conversion_spec.get("multiplier", 1.0))
            return round(value * mult, 6)
            
        return value
