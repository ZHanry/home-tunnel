"""Verify the four public stable Releases and every download in releases.json."""
import importlib.util
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('candidate_checks', ROOT / 'scripts/check-candidate-release.py')
checks = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checks)


def verify(value):
    require = checks.require
    version = value.get('version', '')
    require(re.fullmatch(r'(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)', version), 'Expected a stable version')
    require(value.get('stage') == 'stable' and set(value.get('components', {})) == set(checks.REPOSITORIES), 'Expected all four stable components')
    contract = value.get('contract_ref', '')
    revision = value.get('contract_revision', '')
    checksum = value.get('contract_sha256', '')
    require(re.fullmatch(r'api-v[0-9]+\.[0-9]+\.[0-9]+', contract), 'Expected a stable API contract tag')
    require(re.fullmatch(r'[0-9a-f]{40}', revision) and re.fullmatch(r'[0-9a-f]{64}', checksum), 'Contract commit and checksum are required')
    server = checks.REPOSITORIES['server']
    require(checks.tag_revision(server, contract) == revision, 'Contract tag revision differs')
    require(checks.download_hash(f'https://raw.githubusercontent.com/{server}/{revision}/contracts/openapi.v1.json') == checksum, 'Published contract checksum differs')
    for name, repository in checks.REPOSITORIES.items():
        component = value['components'][name]
        tag = 'v' + version
        require(component.get('repository') == repository and component.get('version') == version and component.get('tag') == tag and component.get('prerelease') is False, 'Component identity differs: ' + name)
        actual_revision = checks.tag_revision(repository, tag)
        expected_revision = component.get('release_revision')
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
        require(name == 'hub' or bool(downloads), 'Component downloads are missing')
        seen = set()
        for item in downloads:
            filename = item.get('filename', '')
            require(filename and filename not in seen and Path(filename).name == filename and '\\' not in filename, 'Invalid or duplicate download name')
            seen.add(filename)
            url = f'https://github.com/{repository}/releases/download/{tag}/{filename}'
            asset = assets.get(filename)
            require(asset is not None and asset.get('browser_download_url') == item.get('url') == url and type(asset.get('size')) is int and 0 < asset['size'] <= 4 * 1024**3, 'Release asset identity differs')
            require(re.fullmatch(r'[0-9a-f]{64}', item.get('sha256', '')), 'Invalid download hash')
            require(checks.download_hash(url, asset['size']) == item['sha256'], 'Published download checksum differs: ' + filename)
        print(name + ': public stable tag, assets and listed download bytes verified')


if __name__ == '__main__':
    verify(json.loads((ROOT / 'releases.json').read_text(encoding='utf-8')))
