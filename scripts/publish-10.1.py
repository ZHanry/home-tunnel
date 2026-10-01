"""Publish the reviewed 10.1 distribution only after immutable component verification."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
REPO = 'ZHanry/home-tunnel'
TAG = 'v10.1.0'


def gh(*args):
    return subprocess.check_output(['gh', *args], text=True, timeout=180)


def api(path):
    return json.loads(gh('api', f'repos/{REPO}/{path}'))


def main():
    sha = os.environ['GITHUB_SHA']
    if (os.environ.get('GITHUB_REPOSITORY') != REPO or os.environ.get('GITHUB_REF') != 'refs/heads/main'
            or os.environ.get('EXPECTED_REVISION') != sha):
        raise SystemExit('Publication requires the reviewed exact main commit')
    runs = api('actions/runs?head_sha=' + sha + '&per_page=100')['workflow_runs']
    for name in ('Pages', 'CodeQL', 'Secret scan'):
        matches = [r for r in runs if r['name'] == name and r['head_sha'] == sha and r['event'] == 'push']
        if not matches or max(matches, key=lambda r:r['id'])['conclusion'] != 'success':
            raise SystemExit(f'{name} must first pass on the exact published source')
    stable = json.loads((ROOT / 'releases.json').read_text())
    if stable['version'] != '10.1.0' or stable['components']['android']['version'] != '10.0.0':
        raise SystemExit('Unexpected distribution component versions')
    spec = importlib.util.spec_from_file_location('stable_release_verifier', ROOT / 'scripts/verify-stable-release.py')
    verifier = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(verifier)
    # Full component tags, Releases and downloaded bytes are verified before
    # creating the hub Release. The same verifier checks all four afterward.
    verifier.verify(stable, components_only=True)
    record = json.loads((ROOT / 'docs/release/v10.1-evidence.json').read_text())
    hub = record['components']['hub']
    sealed = {a['filename']: a for a in hub['artifacts']}
    output = ROOT / 'release-10.1'
    output.mkdir(exist_ok=False)
    for name in ('DOWNLOADS.md', 'RELEASE_NOTES.md'):
        data = (ROOT / 'docs' / name).read_bytes()
        item = sealed[name]
        if hashlib.sha256(data).hexdigest() != item['sha256'] or len(data) != item['size_bytes']:
            raise SystemExit('Hub document differs from the accepted immutable bytes: ' + name)
        (output / name).write_bytes(data)
    (output / 'releases.json').write_bytes((ROOT / 'releases.json').read_bytes())
    (output / 'SHA256SUMS.txt').write_text(''.join(f'{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.name}\n' for p in sorted(output.iterdir())))
    existing = [r for r in api('git/matching-refs/tags/' + TAG) if r['ref'] == 'refs/tags/' + TAG]
    if existing:
        raise SystemExit('Stable tag already exists; inspect instead of changing or republishing it')
    gh('api', '--method', 'POST', f'repos/{REPO}/git/refs', '-f', 'ref=refs/tags/' + TAG, '-f', 'sha=' + sha)
    gh('release', 'create', TAG, '--repo', REPO, '--verify-tag', '--target', sha, '--draft',
       '--title', 'Home Tunnel 10.1.0', '--notes-file', str(output / 'RELEASE_NOTES.md'))
    gh('release', 'upload', TAG, '--repo', REPO, *[str(p) for p in sorted(output.iterdir())])
    gh('release', 'edit', TAG, '--repo', REPO, '--draft=false', '--latest=true')
    verifier.verify(stable, hub_artifacts=hub['artifacts'], expected_hub_revision=sha)
    print('Verified public stable distribution:', f'https://github.com/{REPO}/releases/tag/{TAG}')


if __name__ == '__main__':
    main()
