#!/usr/bin/env python3
"""Create a private, hash-verified listening packet for completed narration candidates."""

from __future__ import annotations

import argparse
import base64
import hashlib
import html
import json
import os
import shutil
import tempfile
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
CANDIDATE_ROOT = (
    ROOT
    / "ContentProduction"
    / "production-candidates"
    / "chatterbox-production-candidates-v2"
)
CATALOG_PATH = ROOT / "Content" / "guided" / "catalog.json"
PRIVATE_OUTPUT_ROOT = ROOT / ".evidence" / "audio"
LANGUAGES = ("en", "de")
REVIEW_GATES = (
    "fluentListening",
    "scriptAndEditorialReview",
    "pronunciationAndArtifactReview",
    "vttAlignmentReview",
    "finishedTrackApproval",
)
LIBRARY_GATES = (
    "publicRedistributionSignoff",
    "deviceCandidateApproval",
)


class PacketFailure(RuntimeError):
    pass


def load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise PacketFailure(f"invalid JSON: {path.name}") from error
    if not isinstance(value, dict):
        raise PacketFailure(f"expected JSON object: {path.name}")
    return value


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def require_regular_file(path: Path) -> None:
    if path.is_symlink() or not path.is_file():
        raise PacketFailure(f"candidate input must be a regular file: {path.name}")


def verified_file(track_root: Path, record: dict[str, Any], role: str) -> Path:
    name = record.get("name")
    expected_hash = record.get("sha256")
    expected_bytes = record.get("bytes")
    if not isinstance(name, str) or Path(name).name != name:
        raise PacketFailure(f"unsafe {role} filename")
    path = track_root / name
    require_regular_file(path)
    if path.stat().st_size != expected_bytes or sha256(path) != expected_hash:
        raise PacketFailure(f"{role} bytes do not match the candidate manifest")
    return path


def catalog_titles(catalog_path: Path) -> dict[tuple[str, str], str]:
    catalog = load_json(catalog_path)
    practices = catalog.get("practices")
    if not isinstance(practices, list):
        raise PacketFailure("catalogue practices are missing")
    titles: dict[tuple[str, str], str] = {}
    for practice in practices:
        identifier = practice.get("id")
        localized = practice.get("localized")
        if not isinstance(identifier, str) or not isinstance(localized, dict):
            raise PacketFailure("catalogue practice identity is invalid")
        for language in LANGUAGES:
            title = localized.get(language, {}).get("title")
            if not isinstance(title, str) or not title.strip():
                raise PacketFailure(f"{identifier}/{language}: title is missing")
            titles[(identifier, language)] = title
    return titles


def collect_candidates(candidate_root: Path, catalog_path: Path) -> list[dict[str, Any]]:
    titles = catalog_titles(catalog_path)
    candidates: list[dict[str, Any]] = []
    for identifier in (f"G{index:02d}" for index in range(1, 43)):
        for language in LANGUAGES:
            track_root = candidate_root / identifier / language
            manifest_path = track_root / "manifest.json"
            if not manifest_path.exists():
                continue
            require_regular_file(manifest_path)
            manifest = load_json(manifest_path)
            if (
                manifest.get("contentID") != identifier
                or manifest.get("language") != language
                or manifest.get("automatedState")
                != "production-candidate-objective-checks-passed"
                or manifest.get("productionMasterApproval") is not False
                or manifest.get("finishedTrackApproval") is not False
            ):
                raise PacketFailure(f"{identifier}/{language}: candidate state mismatch")
            files = manifest.get("files")
            if not isinstance(files, dict):
                raise PacketFailure(f"{identifier}/{language}: candidate files missing")
            delivery = verified_file(track_root, files.get("delivery", {}), "delivery")
            transcript = verified_file(track_root, files.get("transcript", {}), "transcript")
            mastering = manifest.get("mastering", {}).get("delivery", {})
            assembly = manifest.get("assembly", {})
            candidates.append(
                {
                    "id": identifier,
                    "language": language,
                    "title": titles[(identifier, language)],
                    "direction": manifest.get("direction", {}).get("id"),
                    "durationSeconds": mastering.get("durationSeconds"),
                    "speechOnlyWordsPerMinute": assembly.get("speechOnlyWordsPerMinute"),
                    "integratedLUFS": mastering.get("integratedLUFS"),
                    "truePeakDBTP": mastering.get("truePeakDBTP"),
                    "rawClippingAttention": assembly.get("rawClippingAttention"),
                    "manifestSHA256": sha256(manifest_path),
                    "deliverySHA256": files["delivery"]["sha256"],
                    "transcriptSHA256": files["transcript"]["sha256"],
                    "deliverySource": delivery,
                    "transcriptSource": transcript,
                }
            )
    return candidates


def render_index(items: list[dict[str, Any]], review: dict[str, Any]) -> str:
    review_by_track = {
        (track["id"], track["language"]): track for track in review["tracks"]
    }
    cards = []
    for item in items:
        identifier = html.escape(item["id"])
        language = html.escape(item["language"].upper())
        title = html.escape(item["title"])
        metrics = (
            f"{float(item['durationSeconds']) / 60:.1f} min · "
            f"{float(item['speechOnlyWordsPerMinute']):.1f} speech WPM · "
            f"{float(item['integratedLUFS']):.2f} LUFS-I · "
            f"{float(item['truePeakDBTP']):.2f} dBTP"
        )
        if item.get("rawClippingAttention") is True:
            metrics += " · raw-source clipping attention: listen closely for baked distortion"
        audio_name = f"assets/{identifier}.{item['language']}.m4a"
        transcript_name = f"assets/{identifier}.{item['language']}.vtt"
        reviewed = review_by_track[(item["id"], item["language"])]
        controls = []
        for gate in REVIEW_GATES:
            selected = reviewed["gates"][gate]
            options = "".join(
                f'<option value="{state}"{(" selected" if state == selected else "")}>{state}</option>'
                for state in ("pending", "approved", "rejected")
            )
            controls.append(
                f'<label>{html.escape(gate)}<select data-track="{identifier}/{item["language"]}" '
                f'data-gate="{html.escape(gate)}">{options}</select></label>'
            )
        cards.append(
            f"""<article data-review-track="{identifier}/{item['language']}"><h2>{identifier} · {language} — {title}</h2>
<p>{html.escape(metrics)}</p>
<audio controls preload="none"><source src="{audio_name}" type="audio/mp4"><track default kind="captions" srclang="{item['language']}" src="{transcript_name}"></audio>
<p><a href="{transcript_name}">Open transcript</a></p><div class="gates">{''.join(controls)}</div>
<label>Notes<textarea data-notes="{identifier}/{item['language']}">{html.escape(reviewed['notes'])}</textarea></label>
<button type="button" data-approve-track="{identifier}/{item['language']}">Approve every track gate</button></article>"""
        )
    library_controls = []
    for gate in LIBRARY_GATES:
        selected = review["libraryGates"][gate]
        options = "".join(
            f'<option value="{state}"{(" selected" if state == selected else "")}>{state}</option>'
            for state in ("pending", "approved", "rejected")
        )
        library_controls.append(
            f'<label>{html.escape(gate)}<select data-library-gate="{html.escape(gate)}">{options}</select></label>'
        )
    encoded_review = base64.b64encode(
        json.dumps(review, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).decode("ascii")
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; connect-src 'none'; img-src 'none'; media-src 'self'; object-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>Arrive Within narration review</title><style>
body{{font:16px system-ui;max-width:900px;margin:40px auto;padding:0 20px;color:#17211d;background:#f4f0e7}}article{{padding:22px 0;border-top:1px solid #aaa}}audio,textarea{{width:100%}}.gates,.library{{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:10px}}label{{display:grid;gap:4px}}select,textarea,button{{font:inherit;padding:8px}}code{{overflow-wrap:anywhere}}#progress{{font-weight:600;position:sticky;top:0;background:#f4f0e7;padding:12px 0}}
</style></head><body><h1>Private narration review packet</h1><p>This offline packet contains only completed, hash-verified production candidates and makes no network request. Listen in full before approving. Promotion into a TestFlight device candidate accepts only a complete 84-track record whose hashes, track gates, rights sign-off, and device-candidate approval all validate. iPhone/iPad audio testing follows in that build.</p><p id="progress"></p><section><h2>Library decisions</h2><div class="library">{''.join(library_controls)}</div><label>Approval notes<textarea id="approval-notes">{html.escape(review['approvalNotes'])}</textarea></label><button type="button" id="export-review">Export review-template.json</button></section>{''.join(cards)}<script>
const review=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob("{encoded_review}"),c=>c.charCodeAt(0))));
const trackMap=new Map(review.tracks.map(track=>[`${{track.id}}/${{track.language}}`,track]));
function sync(){{
  for(const select of document.querySelectorAll("select[data-track]")) trackMap.get(select.dataset.track).gates[select.dataset.gate]=select.value;
  for(const notes of document.querySelectorAll("textarea[data-notes]")) trackMap.get(notes.dataset.notes).notes=notes.value;
  for(const select of document.querySelectorAll("select[data-library-gate]")) review.libraryGates[select.dataset.libraryGate]=select.value;
  review.approvalNotes=document.getElementById("approval-notes").value;
  const trackStates=review.tracks.flatMap(track=>Object.values(track.gates));
  const libraryStates=Object.values(review.libraryGates);
  const rejected=[...trackStates,...libraryStates].some(state=>state==="rejected");
  const approved=review.tracks.length===84&&[...trackStates,...libraryStates].every(state=>state==="approved");
  review.state=approved?"approved-for-promotion":rejected?"rejected-review":"pending-human-review";
  const approvedTracks=review.tracks.filter(track=>Object.values(track.gates).every(state=>state==="approved")).length;
  document.getElementById("progress").textContent=`${{approvedTracks}}/${{review.tracks.length}} tracks fully approved · record state: ${{review.state}}`;
}}
document.addEventListener("change",sync);
for(const button of document.querySelectorAll("button[data-approve-track]")) button.addEventListener("click",()=>{{for(const select of document.querySelectorAll(`select[data-track="${{button.dataset.approveTrack}}"]`)) select.value="approved";sync();}});
document.getElementById("export-review").addEventListener("click",()=>{{sync();const blob=new Blob([JSON.stringify(review,null,2)+"\\n"],{{type:"application/json"}});const link=document.createElement("a");link.href=URL.createObjectURL(blob);link.download="review-template.json";link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);}});
sync();
</script></body></html>\n"""


def merge_state(current: str, incoming: str, label: str) -> str:
    if current == incoming or incoming == "pending":
        return current
    if current == "pending":
        return incoming
    raise PacketFailure(f"conflicting approved/rejected review decisions for {label}")


def carried_review_state(
    prior_packet: Path | None,
    review_records: list[Path] | None = None,
) -> tuple[dict[tuple[str, str], dict[str, Any]], dict[str, str], str]:
    if prior_packet is None:
        if review_records:
            raise PacketFailure("review records require a prior review packet")
        return {}, {gate: "pending" for gate in LIBRARY_GATES}, ""
    if prior_packet.is_symlink() or not prior_packet.is_dir():
        raise PacketFailure("prior review packet must be a real directory")
    prior_manifest_path = prior_packet / "manifest.json"
    require_regular_file(prior_manifest_path)
    prior_manifest = load_json(prior_manifest_path)
    items = prior_manifest.get("items")
    if not isinstance(items, list):
        raise PacketFailure("prior review packet tracks are missing")
    item_map = {
        (item.get("id"), item.get("language")): item
        for item in items
        if isinstance(item, dict)
    }
    if len(item_map) != len(items):
        raise PacketFailure("prior packet identities are incomplete or duplicated")
    allowed_states = {"pending", "approved", "rejected"}
    carried = {
        key: {
            "id": key[0],
            "language": key[1],
            **{field: item[field] for field in ("candidateManifestSHA256", "deliverySHA256", "transcriptSHA256")},
            "gates": {gate: "pending" for gate in REVIEW_GATES},
            "notes": "",
        }
        for key, item in item_map.items()
    }
    library = {gate: "pending" for gate in LIBRARY_GATES}
    approval_notes: list[str] = []
    record_paths = [prior_packet / "review-template.json", *(review_records or [])]
    for record_path in record_paths:
        require_regular_file(record_path)
        record = load_json(record_path)
        if record.get("packetManifestSHA256") != sha256(prior_manifest_path):
            raise PacketFailure("prior review record is not bound to its packet manifest")
        tracks = record.get("tracks")
        track_map = {
            (track.get("id"), track.get("language")): track
            for track in tracks
            if isinstance(track, dict)
        } if isinstance(tracks, list) else {}
        if len(track_map) != len(item_map) or set(track_map) != set(item_map):
            raise PacketFailure("prior review record identities are incomplete or duplicated")
        for key, track in track_map.items():
            item = item_map[key]
            hashes = ("candidateManifestSHA256", "deliverySHA256", "transcriptSHA256")
            if any(track.get(field) != item.get(field) for field in hashes):
                raise PacketFailure(f"{key[0]}/{key[1]}: prior review hashes do not match")
            gates = track.get("gates")
            if (
                not isinstance(gates, dict)
                or set(gates) != set(REVIEW_GATES)
                or any(state not in allowed_states for state in gates.values())
                or not isinstance(track.get("notes"), str)
            ):
                raise PacketFailure(f"{key[0]}/{key[1]}: invalid prior review decision")
            for gate in REVIEW_GATES:
                carried[key]["gates"][gate] = merge_state(
                    carried[key]["gates"][gate],
                    gates[gate],
                    f"{key[0]}/{key[1]} {gate}",
                )
            note = track["notes"].strip()
            if note and note not in carried[key]["notes"].split("\n---\n"):
                carried[key]["notes"] = "\n---\n".join(
                    value for value in (carried[key]["notes"], note) if value
                )
        prior_library = record.get("libraryGates")
        if (
            not isinstance(prior_library, dict)
            or set(prior_library) != set(LIBRARY_GATES)
            or any(state not in allowed_states for state in prior_library.values())
        ):
            raise PacketFailure("invalid prior library review decision")
        for gate in LIBRARY_GATES:
            library[gate] = merge_state(library[gate], prior_library[gate], gate)
        notes = record.get("approvalNotes")
        if not isinstance(notes, str):
            raise PacketFailure("prior approval notes must be a string")
        if notes.strip() and notes.strip() not in approval_notes:
            approval_notes.append(notes.strip())
    return carried, library, "\n---\n".join(approval_notes)


def build_packet(
    candidate_root: Path,
    catalog_path: Path,
    output: Path,
    prior_review_packet: Path | None = None,
    review_records: list[Path] | None = None,
) -> dict[str, Any]:
    private_root = PRIVATE_OUTPUT_ROOT.resolve()
    resolved_output = output.resolve()
    if resolved_output.parent != private_root or output.name.startswith("."):
        raise PacketFailure("output must be one named directory directly under .evidence/audio")
    if output.exists() or output.is_symlink():
        raise PacketFailure("review packet output already exists")
    items = collect_candidates(candidate_root, catalog_path)
    if not items:
        raise PacketFailure("no completed candidates are available")
    prior_tracks, prior_library_gates, prior_approval_notes = carried_review_state(
        prior_review_packet,
        review_records,
    )
    PRIVATE_OUTPUT_ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)
    with tempfile.TemporaryDirectory(prefix=".narration-review-", dir=PRIVATE_OUTPUT_ROOT) as temporary:
        stage = Path(temporary)
        assets = stage / "assets"
        assets.mkdir(mode=0o700)
        public_items = []
        review_tracks = []
        for item in items:
            audio_name = f"{item['id']}.{item['language']}.m4a"
            transcript_name = f"{item['id']}.{item['language']}.vtt"
            shutil.copyfile(item["deliverySource"], assets / audio_name)
            shutil.copyfile(item["transcriptSource"], assets / transcript_name)
            (assets / audio_name).chmod(0o600)
            (assets / transcript_name).chmod(0o600)
            public = {key: value for key, value in item.items() if not key.endswith("Source")}
            public["candidateManifestSHA256"] = public.pop("manifestSHA256")
            public["audio"] = f"assets/{audio_name}"
            public["transcript"] = f"assets/{transcript_name}"
            public_items.append(public)
            review_track = {
                "id": item["id"],
                "language": item["language"],
                "candidateManifestSHA256": item["manifestSHA256"],
                "deliverySHA256": item["deliverySHA256"],
                "transcriptSHA256": item["transcriptSHA256"],
                "gates": {gate: "pending" for gate in REVIEW_GATES},
                "notes": "",
            }
            prior = prior_tracks.get((item["id"], item["language"]))
            if prior is not None and all(
                prior.get(field) == review_track[field]
                for field in ("candidateManifestSHA256", "deliverySHA256", "transcriptSHA256")
            ):
                review_track["gates"] = dict(prior["gates"])
                review_track["notes"] = prior["notes"]
            review_tracks.append(review_track)
        payload = {
            "schemaVersion": 1,
            "scope": "private-completed-candidates-only-not-library-approval",
            "candidateCount": len(public_items),
            "completeByLanguage": {
                language: sum(item["language"] == language for item in public_items)
                for language in LANGUAGES
            },
            "totalDurationMinutes": round(
                sum(float(item["durationSeconds"]) for item in public_items) / 60, 3
            ),
            "items": public_items,
        }
        packet_manifest = stage / "manifest.json"
        packet_manifest.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        review_states = [
            state for track in review_tracks for state in track["gates"].values()
        ] + list(prior_library_gates.values())
        review_state = (
            "approved-for-promotion"
            if len(review_tracks) == 84 and all(state == "approved" for state in review_states)
            else "rejected-review"
            if any(state == "rejected" for state in review_states)
            else "pending-human-review"
        )
        review_document = {
            "schemaVersion": 1,
            "state": review_state,
            "packetManifestSHA256": sha256(packet_manifest),
            "tracks": review_tracks,
            "libraryGates": prior_library_gates,
            "approvalNotes": prior_approval_notes,
        }
        (stage / "review-template.json").write_text(
            json.dumps(
                review_document,
                ensure_ascii=False,
                indent=2,
                sort_keys=True,
            )
            + "\n",
            encoding="utf-8",
        )
        (stage / "index.html").write_text(
            render_index(public_items, review_document), encoding="utf-8"
        )
        for path in (stage / "manifest.json", stage / "review-template.json"):
            path.chmod(0o600)
        (stage / "index.html").chmod(0o644)
        assets.chmod(0o755)
        for path in assets.iterdir():
            path.chmod(0o644)
        os.replace(stage, output)
    output.chmod(0o755)
    return payload


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output",
        type=Path,
        required=True,
        help="A new direct child of the ignored .evidence/audio directory.",
    )
    parser.add_argument(
        "--carry-review-from",
        type=Path,
        help="An older hash-bound review packet whose exact matching decisions should carry forward.",
    )
    parser.add_argument(
        "--merge-review-record",
        type=Path,
        action="append",
        help="Additional exported review JSON for the prior packet; repeatable for parallel reviewers.",
    )
    arguments = parser.parse_args()
    payload = build_packet(
        CANDIDATE_ROOT,
        CATALOG_PATH,
        arguments.output,
        arguments.carry_review_from,
        arguments.merge_review_record,
    )
    print(
        f"Narration review packet: {payload['candidateCount']} completed candidates, "
        f"{payload['totalDurationMinutes']:.1f} minutes; every human gate remains pending."
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (PacketFailure, OSError, KeyError, TypeError, ValueError) as error:
        print(f"narration review packet failed: {error}")
        raise SystemExit(1) from error
