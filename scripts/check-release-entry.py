"""Prevent product version, download and local documentation link drift."""
from pathlib import Path
import json,re
from urllib.parse import unquote
root=Path(__file__).resolve().parents[1]
manifest=json.loads((root/'releases.json').read_text(encoding='utf-8'))
version=(root/'VERSION').read_text().strip()
assert re.fullmatch(r'\d+\.\d+\.\d+',version)
assert manifest['version']==version and manifest['stage']=='stable'
assert all(x['version']==version and x['tag']=='v'+version and x['prerelease'] is False for x in manifest['components'].values())
assert all(x==version for x in manifest['tested_combination'].values())
assert json.loads((root/'docs/site/releases.json').read_text(encoding='utf-8'))==manifest
for path in (root/'docs/site/index.html',root/'docs/site/en/index.html'):
    text=path.read_text(encoding='utf-8')
    assert '"softwareVersion": "'+version+'"' in text
    for component in ('server','client','android'):
        assert f'https://github.com/ZHanry/home-tunnel-{component}/releases/latest' in text
    for required in ('rel="canonical"','hreflang="en"','application/ld+json','og:image'):
        assert required in text
errors=[]
for path in [*root.glob('README*.md'),*(root/'docs').rglob('*.md')]:
    text=path.read_text(encoding='utf-8')
    for target in re.findall(r'!?\[[^\]]*\]\(([^)]+)\)',text):
        if target.startswith(('https:','http:','#','mailto:')):continue
        target=unquote(target.split('#',1)[0].split('?',1)[0])
        if target and not (path.parent/target).exists():errors.append(f'{path.relative_to(root)} -> {target}')
assert not errors,'Broken local links: '+', '.join(errors)
print('Stable version matrix, site download entries and local documentation links passed')
