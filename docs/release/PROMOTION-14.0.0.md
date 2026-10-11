# Coordinated 14.0.0 stable projection

`scripts/promote-nestlink.py` prepares the stable combination, release/image metadata, actual download hashes, update JSON projections and final Chinese/English release copy together. It does not create tags, Releases, publish a site or deploy a server.

Run it only after Server, Client and Android have each published their actual 14.0.0 Release with version-specific acceptance and signed Materials. Supply the exact **final Release tag commit**, including the acceptance record; this can differ from the payload's successful build source because only acceptance/release documentation may have been added.

```powershell
python scripts/promote-nestlink.py --server-sha SERVER_RELEASE_COMMIT --client-sha CLIENT_RELEASE_COMMIT --android-sha ANDROID_RELEASE_COMMIT --download-dir OUTSIDE_REPOSITORY_DOWNLOAD_CACHE
```

The default independently downloads and rehashes the three complete actual attachment sets, resolves exact immutable tags, verifies signed BUILD manifests and corresponding source, checks the successful original source build and allowed documentation-only source drift, verifies the accepted server image signatures, and checks the current required scenarios and fixture source combination. It then prepares all files in a temporary tree and runs distribution and site provenance policies. Current 14.0.0 original screenshots and their manifests must already be registered; 13.0.0 screenshots cannot pass promoted-site policy. A failure leaves the source channel and download pages untouched.

Inspect the verified file plan and rerun the same command with `--apply` to write the full projection. All checks are repeated. Filesystem failures restore the original files. The helper preserves `docs/release/stable-13.0.0.json` byte-for-byte, carries actual signed acceptance scopes and outstanding coverage into the final release copy, preserves Android upgrade/signing identity and frozen API v2 bytes, and records the real accepted server digests. The source hub is committed and its own version-specific acceptance is completed only after this projection and real screenshot updates are ready.

Platform signing remains explicit: Windows has no configured Authenticode publisher certificate; Android retains its original release certificate. Physical Android, carrier NAT and long-duration media remain unverified as recorded by the component acceptance. UI screenshots and preview fixtures do not establish media or remote-session success.
