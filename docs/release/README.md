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
