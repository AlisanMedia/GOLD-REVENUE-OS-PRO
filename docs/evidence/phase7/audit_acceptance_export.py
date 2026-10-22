"""Read-only audit of exported, conversation-scoped acceptance evidence."""
import json
import statistics
import sys
from collections import Counter

data = json.load(open(sys.argv[1], encoding="utf-8"))
rows = data["rows"]
details = {item["run_id"]: item for item in data["details"]}
sent = [row for row in rows if row.get("reply_provider")]
latencies = sorted(float(row["seconds"]) for row in sent)
stages = [stage["evidence"] for item in details.values() for stage in item.get("stages") or []]
calls = [call for item in details.values() for call in item.get("invocations") or []]
deliveries = [attempt for item in details.values() for attempt in item.get("delivery") or []]
anchor_errors = []
wire_errors = []
for row in rows:
    manifest = details[row["run_id"]]["context_manifest"]
    if (manifest["source_message_id"] != row["source_id"]
            or manifest["source_event_id"] != row["event_id"]
            or manifest["context_version"] != 3
            or manifest["included_message_ids"][-1] != row["source_id"]):
        anchor_errors.append(row["source_provider"])
for stage in stages:
    resolution = stage["authoritative_evidence_resolution"]
    registry = {item["handle"]: item for item in resolution["registry"]}
    wire = resolution["wireOutput"]
    for claim in wire["claims"]:
        for ref in claim["evidence_refs"]:
            if ref not in registry or (claim["grounding"] == "CUSTOMER_REPORTED"
                                       and registry[ref]["direction"] != "inbound"):
                wire_errors.append(ref)
    for proposal in wire["memory_proposals"]:
        for ref in proposal["provenance_evidence_refs"]:
            if ref not in registry or registry[ref]["direction"] != "inbound":
                wire_errors.append(ref)

summary = {
    "cases": len(rows), "runs": len(details), "sent": len(sent),
    "qa_actions": dict(Counter(row["qa_action"] for row in rows)),
    "qa_versions": dict(Counter(row["qa_version"] for row in rows)),
    "stage_versions": dict(Counter(json.dumps(stage["versions"], sort_keys=True) for stage in stages)),
    "model_calls": len(calls), "failed_model_calls": sum(call["status"] != "SUCCEEDED" for call in calls),
    "rewrite_sources": [row["source_provider"] for row in rows if row["rewrite_count"]],
    "successful_single_rewrite_sources": [row["source_provider"] for row in sent if row["rewrite_count"] == 1],
    "provider_delivery_attempts": len(deliveries),
    "delivery_statuses": dict(Counter(str(attempt["provider_status"]) for attempt in deliveries)),
    "delivery_errors": [attempt["error_code"] for attempt in deliveries if attempt["error_code"]],
    "human_reviewed": sum(row["reviewed_by"] is not None for row in rows),
    "sent_actor_types": dict(Counter(row["actor_type"] for row in sent)),
    "blocked_sent": [row["source_provider"] for row in rows if row["qa_action"] != "approve" and row["reply_provider"]],
    "reply_link_errors": [row["source_provider"] for row in sent if row["reply_to_provider_message_id"] != row["source_provider"]],
    "duplicate_reply_provider_ids": len(sent) - len({row["reply_provider"] for row in sent}),
    "anchor_errors": anchor_errors, "wire_reference_errors": wire_errors,
    "memory_accepted": sum(len(stage["memory_validation"]["accepted"]) for stage in stages),
    "memory_rejected": sum(len(stage["memory_validation"]["rejected"]) for stage in stages),
    "original_rendered_changes": sum(stage["original_output"]["proposed_response"] != stage["rendered_output"]["proposed_response"] for stage in stages),
    "receive_to_send_seconds": {"sample_size": len(latencies), "minimum": min(latencies) if latencies else None,
        "median": statistics.median(latencies) if latencies else None,
        "p95_linear_interpolation": statistics.quantiles(latencies, n=100, method="inclusive")[94] if len(latencies) >= 20 else None,
        "maximum": max(latencies) if latencies else None},
    "model_call_ms": {"median": statistics.median(call["latency_ms"] for call in calls) if calls else None,
        "maximum": max(call["latency_ms"] for call in calls) if calls else None},
}
print(json.dumps(summary, ensure_ascii=False, indent=2))
