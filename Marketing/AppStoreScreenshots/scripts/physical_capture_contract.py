"""Shared fail-closed checks for the guarded physical marketing fixture."""

from __future__ import annotations

from datetime import datetime, timezone
import json
import re
from pathlib import Path
import uuid


REPORT_KEYS = {
    "schemaVersion", "captureID", "locale", "appearance", "namespace", "readySurface",
    "rendererReady", "journalEditorPrefilled", "bundleIdentifier", "marketingVersion",
    "buildNumber", "sourceCommit", "sourceManifestRevision", "startedAt",
    "captureLocalDate", "visibleStatusTime", "timezone", "gardenPhase",
}
CAPTURE_SURFACES = {
    "garden-seed": ("dark", "garden", True),
    "garden-hero": ("dark", "garden", True),
    "garden-day": ("light", "garden", True),
    "journey-calendar": ("light", "journey", False),
    "journey-milestones": ("light", "journey-milestones", False),
    "journal": ("light", "journal-editor", False),
}
SHA256 = re.compile(r"^[a-f0-9]{64}$")
COMMIT = re.compile(r"^[a-f0-9]{40}$")
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TIME = re.compile(r"^(?:[01]\d|2[0-3]):[0-5]\d$")


def parse_iso(value: object, field: str) -> datetime:
    if not isinstance(value, str):
        raise ValueError(f"{field} must be an ISO-8601 timestamp")
    try:
        result = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise ValueError(f"{field} must be an ISO-8601 timestamp") from error
    if result.tzinfo is None:
        raise ValueError(f"{field} must include a timezone")
    return result.astimezone(timezone.utc)


def garden_phase(status_time: str) -> str:
    if not TIME.fullmatch(status_time):
        raise ValueError("visibleStatusTime must be HH:MM")
    hour = int(status_time[:2])
    if hour < 5:
        return "night"
    if hour < 8:
        return "dawn"
    if hour < 17:
        return "day"
    if hour < 20:
        return "dusk"
    return "night"


def validate_report(
    report: object,
    *,
    expected_capture_id: str,
    expected_locale: str,
    bundle_id: str,
    marketing_version: str,
    build_number: str,
    source_commit: str,
    device_family: str,
    device_model: str,
    os_version: str,
    started_after: str,
    now: datetime | None = None,
) -> dict[str, object]:
    if not isinstance(report, dict) or set(report) != REPORT_KEYS:
        raise ValueError("physical capture report has an unknown or incomplete schema")
    if expected_capture_id not in CAPTURE_SURFACES:
        raise ValueError("expected capture id is unsupported")
    appearance, surface, needs_renderer = CAPTURE_SURFACES[expected_capture_id]
    if report.get("schemaVersion") != 1:
        raise ValueError("report schemaVersion must be 1")
    if (
        report.get("captureID") != expected_capture_id
        or report.get("locale") != expected_locale
        or expected_locale not in {"en-US", "de-DE"}
        or report.get("appearance") != appearance
        or report.get("readySurface") != surface
    ):
        raise ValueError("report fixture, locale, appearance, or ready surface does not match this profile case")
    if report.get("rendererReady") is not needs_renderer:
        raise ValueError("report renderer readiness does not match the required capture surface")
    journal_prefilled = report.get("journalEditorPrefilled")
    if journal_prefilled is not (expected_capture_id == "journal"):
        raise ValueError("journal editor readiness does not match the selected fixture")
    if (
        report.get("bundleIdentifier") != bundle_id
        or report.get("marketingVersion") != marketing_version
        or report.get("buildNumber") != build_number
        or report.get("sourceCommit") != source_commit
        or not COMMIT.fullmatch(source_commit)
    ):
        raise ValueError("report app identity or signed source commit does not match the build receipt")
    revision = report.get("sourceManifestRevision")
    if not isinstance(revision, str) or not SHA256.fullmatch(revision):
        raise ValueError("report source manifest revision is missing or invalid")
    namespace = report.get("namespace")
    if not isinstance(namespace, str):
        raise ValueError("report fixture namespace is missing")
    try:
        parsed_namespace = uuid.UUID(namespace)
    except ValueError as error:
        raise ValueError("report fixture namespace is invalid") from error
    if str(parsed_namespace) != namespace:
        raise ValueError("report fixture namespace must be canonical lowercase UUID")
    if report.get("timezone") != "Asia/Singapore":
        raise ValueError("physical marketing capture requires the device timezone Asia/Singapore")
    if not isinstance(report.get("captureLocalDate"), str) or not DATE.fullmatch(report["captureLocalDate"]):
        raise ValueError("captureLocalDate must be YYYY-MM-DD")
    try:
        datetime.strptime(report["captureLocalDate"], "%Y-%m-%d")
    except ValueError as error:
        raise ValueError("captureLocalDate is not a valid calendar date") from error
    status_time = report.get("visibleStatusTime")
    if not isinstance(status_time, str):
        raise ValueError("visibleStatusTime is missing")
    phase = garden_phase(status_time)
    if report.get("gardenPhase") != phase:
        raise ValueError("reported Garden phase does not match the actual local time")
    if expected_capture_id in {"garden-seed", "garden-hero"}:
        if phase not in {"dusk", "night"}:
            raise ValueError("dark Garden capture must occur during real local dusk or night")
    elif phase != "day":
        raise ValueError("physical App Store capture must occur during real local day (08:00–16:59)")
    if device_family != "iPad" or "iPad Pro 13-inch" not in device_model:
        raise ValueError("physical capture must use the configured 13-inch iPad route")
    if not re.fullmatch(r"\d+\.\d+(?:\.\d+)?", os_version):
        raise ValueError("physical device OS version is invalid")
    start = parse_iso(report.get("startedAt"), "startedAt")
    boundary = parse_iso(started_after, "started-after")
    observed_now = now or datetime.now(timezone.utc)
    if start <= boundary or start > observed_now.astimezone(timezone.utc):
        raise ValueError("report timestamp is not fresh and plausible")
    return {
        "status": "passed",
        "capture_id": expected_capture_id,
        "locale": expected_locale,
        "garden_phase": phase,
        "source_manifest_revision": revision,
        "device_family": device_family,
        "device_model": device_model,
        "os_version": os_version,
    }


def load_report(path: Path) -> dict[str, object]:
    if path.is_symlink() or not path.is_file():
        raise ValueError("report path must be a plain file")
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("report must be a JSON object")
    return value
