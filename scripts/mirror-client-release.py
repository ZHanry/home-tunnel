"""Keep the original updater URL usable while clients move to their own repository."""
from pathlib import Path
import hashlib
import json
import os
import re
import shutil
import subprocess

def run(*args, capture=False):
    return subprocess.run(args, check=True, text=True, stdout=subprocess.PIPE if capture else None).stdout

version=os.environ['CLIENT_RELEASE_VERSION']
if not re.fullmatch(r'\d+\.\d+\.\d+',version) or tuple(map(int,version.split('.'))) <= (5,0,0):
    raise SystemExit('Select a new stable client version greater than 5.0.0')
source='ZHanry/home-tunnel-client'
destination='ZHanry/home-tunnel'
tag='v'+version
status=json.loads(run('gh','release','view',tag,'--repo',source,'--json','isDraft,isPrerelease',capture=True))
if status['isDraft'] or status['isPrerelease']:
    raise SystemExit('Only published stable client releases may be mirrored')
current=Path('.mirror/current'); legacy=Path('.mirror/legacy'); output=Path('.mirror/publish')
for directory in (current,legacy,output): directory.mkdir(parents=True,exist_ok=True)
run('gh','release','download',tag,'--repo',source,'--dir',str(current))
manifest=json.loads((current/'release-manifest.json').read_text())
revision=json.loads(run('gh','api',f'repos/{source}/commits/{tag}',capture=True))['sha']
if any(manifest.get(k)!=v for k,v in {'repository':source,'component':'client','version':version,'revision':revision}.items()):
    raise SystemExit('Upstream release identity mismatch')
rc_tag=manifest['rc_tag']
if not re.fullmatch(re.escape(tag)+r'-rc\.\d+',rc_tag):
    raise SystemExit('Unexpected upstream RC identity')
run('cosign','verify-blob','--bundle',str(current/'SHA256SUMS.txt.sigstore.json'),
    '--certificate-identity',f'https://github.com/{source}/.github/workflows/release.yml@refs/tags/{rc_tag}',
    '--certificate-oidc-issuer','https://token.actions.githubusercontent.com',str(current/'SHA256SUMS.txt'))
listed=set()
for line in (current/'SHA256SUMS.txt').read_text().splitlines():
    digest,name=line.split('  ',1)
    if Path(name).name!=name or hashlib.sha256((current/name).read_bytes()).hexdigest()!=digest:
        raise SystemExit('Upstream asset checksum mismatch')
    listed.add(name)
if listed != {p.name for p in current.iterdir() if p.is_file()}-{'SHA256SUMS.txt','SHA256SUMS.txt.sigstore.json'}:
    raise SystemExit('Unsealed upstream asset')
for path in current.iterdir():
    name='source-client-'+path.name if path.name.startswith('SHA256SUMS.txt') else path.name
    shutil.copyfile(path,output/name)

# Preserve fixed 5.0.0 filenames still linked by already deployed server landing pages.
baseline=json.loads(run('gh','api',f'repos/{destination}/releases/tags/v5.0.0',capture=True))
run('gh','release','download','v5.0.0','--repo',destination,'--dir',str(legacy))
pattern=re.compile(r'^(?:HomeTunnel-(?:Setup|Windows|Android)-5\.0\.0(?:-|\.)|home-tunnel-(?:linux|macos)-5\.0\.0-)')
for asset in baseline['assets']:
    name=asset['name']
    if not pattern.match(name): continue
    if Path(name).name!=name: raise SystemExit('Invalid legacy asset name')
    expected=asset.get('digest')
    if not expected or expected != 'sha256:'+hashlib.sha256((legacy/name).read_bytes()).hexdigest():
        raise SystemExit('Legacy asset digest unavailable or mismatched: '+name)
    shutil.copyfile(legacy/name,output/name)
(output/'mirror-manifest.json').write_text(json.dumps({'version':version,'source_repository':source,'source_tag':tag,'source_revision':revision,'legacy_baseline':'ZHanry/home-tunnel@v5.0.0'},indent=2)+'\n')
(output/'SHA256SUMS.txt').write_text(''.join(f'{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.name}\n' for p in sorted(output.iterdir()) if p.is_file()))
run('cosign','sign-blob','--yes','--bundle',str(output/'SHA256SUMS.txt.sigstore.json'),str(output/'SHA256SUMS.txt'))
notes=Path('.mirror/notes.md')
notes.write_text(f'Compatibility mirror of [Home Tunnel client {version}](https://github.com/{source}/releases/tag/{tag}).\n\nThe new client uses its own update channel. These are the identical verified upstream binaries. Legacy 5.0.0 downloads remain attached for existing server links; they are not newer component releases. Server and Android releases are maintained independently.\n\nThe combined checksum manifest is signed by the hub mirror workflow. Original client checksum/signature files are retained as source-client-SHA256SUMS.txt and its bundle.\n')
created=False
try:
    run('gh','release','create',tag,'--repo',destination,'--target',os.environ['GITHUB_SHA'],'--draft','--title',f'Home Tunnel client {version} — update compatibility mirror','--notes-file',str(notes))
    created=True
    run('gh','release','upload',tag,'--repo',destination,*[str(p) for p in sorted(output.iterdir())])
    run('gh','release','edit',tag,'--repo',destination,'--draft=false','--latest=true')
except BaseException:
    if created:
        state=json.loads(run('gh','release','view',tag,'--repo',destination,'--json','isDraft',capture=True))
        if state['isDraft']: run('gh','release','delete',tag,'--repo',destination,'--yes')
    raise
