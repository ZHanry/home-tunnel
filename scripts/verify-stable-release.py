"""Verify the four public stable Releases and every download in releases.json."""
import argparse
from datetime import datetime, timezone
import importlib.util
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from v10_evidence import V101_ARTIFACT_NAMES
spec = importlib.util.spec_from_file_location('candidate_checks', ROOT / 'scripts/check-candidate-release.py')
checks = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checks)


def verify(value, *, components_only=False, hub_artifacts=None, expected_hub_revision=None):
    require = checks.require
    version = value.get('version', '')
    require(re.fullmatch(r'(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)', version), 'Expected a stable version')
    require(value.get('stage') == 'stable' and set(value.get('components', {})) == set(checks.REPOSITORIES), 'Expected all four stable components')
    if version == '10.1.0' and not components_only:
        require(re.fullmatch(r'[0-9a-f]{40}', expected_hub_revision or ''),
                'Full 10.1.0 verification requires the reviewed final hub revision')
    contract = value.get('contract_ref', '')
    revision = value.get('contract_revision', '')
    checksum = value.get('contract_sha256', '')
    require(re.fullmatch(r'api-v[0-9]+\.[0-9]+\.[0-9]+', contract), 'Expected a stable API contract tag')
    require(re.fullmatch(r'[0-9a-f]{40}', revision) and re.fullmatch(r'[0-9a-f]{64}', checksum), 'Contract commit and checksum are required')
    server = checks.REPOSITORIES['server']
    require(checks.tag_revision(server, contract) == revision, 'Contract tag revision differs')
    require(checks.download_hash(f'https://raw.githubusercontent.com/{server}/{revision}/contracts/openapi.v1.json') == checksum, 'Published contract checksum differs')
    report = {"schema_version": 1, "version": version,
              "scope": "components-only; hub publication not verified" if components_only else "all-four-public-releases",
              "contract_ref": contract, "contract_revision": revision, "contract_sha256": checksum,
              "verified_at": datetime.now(timezone.utc).isoformat(), "components": {}}
    expected_versions = {name: version for name in checks.REPOSITORIES}
    if version == '10.1.0':
        expected_versions['android'] = '10.0.0'
    for name, repository in checks.REPOSITORIES.items():
        if name == 'hub' and components_only:
            continue
        component = value['components'][name]
        component_version = expected_versions[name]
        tag = 'v' + component_version
        require(component.get('repository') == repository and component.get('version') == component_version and component.get('tag') == tag and component.get('prerelease') is False, 'Component identity differs: ' + name)
        actual_revision = checks.tag_revision(repository, tag)
        expected_revision = component.get('release_revision')
        if name == 'hub' and version == '10.1.0':
            expected_revision = expected_hub_revision
        # Hub manifests may omit their own revision to avoid a self-reference.
        require(name == 'hub' or re.fullmatch(r'[0-9a-f]{40}', expected_revision or ''), 'Component revision is missing')
        if expected_revision is not None:
            require(actual_revision == expected_revision, 'Product tag revision differs: ' + name)
        release = checks.github(f'repos/{repository}/releases/tags/{tag}')
        require(release.get('prerelease') is False and release.get('draft') is False, 'Release must be public and stable: ' + name)
        require(release.get('html_url') == component.get('release_url') == f'https://github.com/{repository}/releases/tag/{tag}', 'Release URL differs')
        assets = {asset['name']: asset for asset in release.get('assets', [])}
        require(bool(assets), 'Release has no actual assets: ' + name)
        downloads = component.get('downloads', [])
        if name == 'hub' and version == '10.1.0':
            require(isinstance(hub_artifacts, list) and {item.get('filename') for item in hub_artifacts} == {'DOWNLOADS.md', 'RELEASE_NOTES.md'},
                    '10.1.0 full verification requires the sealed hub document artifacts')
            downloads = hub_artifacts
        if version == '10.1.0':
            names = [item.get('filename') for item in downloads]
            require(len(names) == len(set(names)) and set(names) == V101_ARTIFACT_NAMES[name],
                    '10.1.0 requires its complete exact download set: ' + name)
        component_report = {'version': component_version, 'tag': tag, 'revision': actual_revision,
                            'release_url': release['html_url'], 'downloads': []}
        require(name == 'hub' or bool(downloads), 'Component downloads are missing')
        seen = set()
        for item in downloads:
            filename = item.get('filename', '')
            require(filename and filename not in seen and Path(filename).name == filename and '\\' not in filename, 'Invalid or duplicate download name')
            seen.add(filename)
            url = f'https://github.com/{repository}/releases/download/{tag}/{filename}'
            asset = assets.get(filename)
            require(asset is not None and asset.get('browser_download_url') == item.get('url') == url and type(asset.get('size')) is int and 0 < asset['size'] <= 4 * 1024**3, 'Release asset identity differs')
            require(item.get('size_bytes') == asset['size'], 'Release asset size differs from manifest')
            require(re.fullmatch(r'[0-9a-f]{64}', item.get('sha256', '')), 'Invalid download hash')
            require(checks.download_hash(url, asset['size']) == item['sha256'], 'Published download checksum differs: ' + filename)
            component_report['downloads'].append(dict(item))
        report['components'][name] = component_report
        print(name + ': public stable tag, assets and listed download bytes verified')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, default=ROOT / 'releases.json')
    parser.add_argument('--components-only', action='store_true', help='Verify server/client/Android only; does not establish hub publication')
    parser.add_argument('--evidence', type=Path, help='Aggregate record containing the sealed hub release documents')
    parser.add_argument('--hub-revision', help='Reviewed final hub manifest/publication commit, distinct from the document source commit')
    parser.add_argument('--report', type=Path, help='Write the exact verification scope and downloaded file identities')
    args = parser.parse_args()
    artifacts = None
    if args.evidence:
        artifacts = json.loads(args.evidence.read_text(encoding='utf-8')).get('components', {}).get('hub', {}).get('artifacts')
    result = verify(json.loads(args.manifest.read_text(encoding='utf-8')),
                    components_only=args.components_only, hub_artifacts=artifacts, expected_hub_revision=args.hub_revision)
    if args.report:
        args.report.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
