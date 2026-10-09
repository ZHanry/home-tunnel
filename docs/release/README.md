# nestlink 13.0.0 release evidence

The current release uses `acceptance-13.0.0.json` for reproducible installed-application integration and `components-13.0.0.json` for independent published-byte, corresponding-source and Sigstore verification. These records bind the exact 13.0.0 sources and payloads. Physical Android devices, carrier networks and long-duration media remain unverified.

The records below document historical releases and do not assert 13.0.0 acceptance.

# 10.1.0 release evidence

The 10.1.0 distribution selects Server and Client 10.1.0, with the original
compatible Android 10.0.0 files. Android source, tag, certificate, package hashes
and version remain unchanged. `distribution.json` is the only channel source;
run `python scripts/sync-distribution.py` after the accepted record is sealed.

`v10.1-evidence.json` distinguishes three measured native-worker gates from the
remaining unverified application, network, migration, Android and UI checks.
The native run used the original Windows worker, same-machine Chromium and a
production-source QA host. Its 30 connections, 7202.463-second active window and
input-release timings do not establish complete installed application or
independent endpoint acceptance. Explicit QA-host restart is not network-outage
recovery. No 24-hour result is claimed.

The record binds the candidate run and original artifact, source SHAs, exact
package hashes/sizes, frozen `api-v1.5.0`, raw native report, original worker
provenance and immutable release-document source. Each source has its own
`frozen_at`; passed gates list every runtime source they exercised. Documentation
is sealed in a later commit and cannot retime a runtime observation. The hub
publication tag is verified separately from that documentation source commit.

The machine status `accepted_with_waivers` records the explicitly disclosed
unverified gates; it never converts them into passes. Existing receipt fields
are preserved, with broader untested installed-GUI scope disclosed separately
from a passed lower-level worker test. Public descriptions use neutral coverage
language. See [release notes](../RELEASE_NOTES.md).

Before hub publication, verify only the already published components:

```bash
python scripts/verify-stable-release.py --components-only --manifest releases.json
```

That check does not claim a hub Release exists. After publication, verify all four
Releases plus the actual sealed hub documents:

```bash
python scripts/verify-stable-release.py --evidence docs/release/v10.1-evidence.json --hub-revision <reviewed-final-hub-sha>
```

`stable-10.0.0.json`, `acceptance-status-10.0.0.json`, `v10-published-evidence.json`
and `stable-9.0.0.json` preserve the previous releases. No old tag, artifact,
receipt or screenshot is retimed, rebuilt or relabeled by this promotion.

## Historical 10.0.0 record

# 10.0.0 release evidence

`distribution.json` is the only stable-versus-candidate source. 10.0.0 is promoted:
the stable channel is the 10.0.0 manifest, and the candidate record is `promoted`
with `acceptance_status` `accepted_with_waivers`. This existing machine status
is retained for compatibility; verification remains incomplete, and unrun gates
are not counted as passed. Project the site files with:

```bash
python scripts/sync-distribution.py
```

`acceptance-status.json` names the evidence record that `scripts/v10_evidence.py`
evaluates. The record binds four source SHAs, artifact digests and the immutable
`api-v1.4.0`. Gates that were run carry their measured results. Gates that were not
run retain the existing `waived` status and original receipt fields. Public
coverage descriptions call them unverified; they are never counted as passed
and cannot carry measured fields. Stale, missing and mismatched gates still fail
closed. Do not add a fixture record and call it acceptance.

Component receipts live in `validation/client/<rev>/` and `validation/android/<rev>/`.
The unverified items are listed in [release notes](../RELEASE_NOTES.md).

`stable-9.0.0.json` is the frozen record of the previous 9.0.0 stable channel.
Historical 8.0 candidate and stable verifiers remain in
`scripts/check-candidate-release.py` and `scripts/verify-stable-release.py`.

## Restored publication record (2026-09-30)

The 2026-09-29 documentation commit announced 10.0.0 but omitted the channel
projection and aggregate evidence file, leaving the machine-readable downloads
at 9.0.0. [v10-published-evidence.json](v10-published-evidence.json) restores that
record from the existing release assets and component receipts. It adds no new
runtime result: all 12 aggregate runtime gates and the incomplete UI review
remain unverified. Every copied record includes the exact original receipt
path, SHA-256 and unrun cases; the validator checks these references. Original
receipt fields and machine statuses remain unchanged.

[v10-publication-verification.json](v10-publication-verification.json) records the
independently downloaded bytes for all ten end-user artifacts, the published hub
documents and frozen API contract. Matching hashes establish artifact identity,
not runtime acceptance. The historical 9.0.0 snapshot is unchanged. This repair
does not move tags, republish releases or rebuild artifacts.
