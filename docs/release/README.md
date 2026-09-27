# 10.0.0 release evidence

`distribution.json` is the only stable-versus-candidate source. While the candidate
`promotion_status` is `not_promoted`, the stable channel stays on the published
9.0.0 snapshot in `stable-9.0.0.json`. Project the site files with:

```bash
python scripts/sync-distribution.py
```

`acceptance-status.json` is a development marker. `not_submitted` means the
10.0.0 VM, network, migration, 30-repeat, 2 hour, and 24 hour gates have not
been run. It is not evidence. Do not add a fixture record and call it acceptance.

Promotion requires a real record that `scripts/v10_evidence.py` accepts: four
distinct source SHAs, artifact digests, immutable `api-v1.4.0`, full Gemini UI
coverage, and every gate in `v10-evidence.schema.json`. Unrun, stale, missing,
and mismatched gates fail closed. Historical 8.0 candidate and stable verifiers
remain in `scripts/check-candidate-release.py` and `scripts/verify-stable-release.py`.
