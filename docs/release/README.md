# 10.0.0 release evidence

`distribution.json` is the only stable-versus-candidate source. 10.0.0 is promoted:
the stable channel is the 10.0.0 manifest, and the candidate record is `promoted`
with `acceptance_status` `accepted_with_waivers`. Project the site files with:

```bash
python scripts/sync-distribution.py
```

`acceptance-status.json` names the evidence record that `scripts/v10_evidence.py`
evaluates. The record binds four source SHAs, artifact digests and the immutable
`api-v1.4.0`. Gates that were run carry their measured results. Gates that were not
run are `waived` with `approved_by`, `approved_at`, `reason` and `disclosed_in`;
a waiver is never counted as passed and cannot carry measured fields. Stale,
missing and mismatched gates still fail closed. Do not add a fixture record and
call it acceptance.

Component receipts live in `validation/client/<rev>/` and `validation/android/<rev>/`.
The waived items are listed in [release notes](../RELEASE_NOTES.md).

`stable-9.0.0.json` is the frozen record of the previous 9.0.0 stable channel.
Historical 8.0 candidate and stable verifiers remain in
`scripts/check-candidate-release.py` and `scripts/verify-stable-release.py`.
