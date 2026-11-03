"""Check desktop packaging against the untouched S3 frozen engine and inputs."""
from pathlib import Path
import hashlib,json,zipfile,xml.etree.ElementTree as ET,argparse

ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser();parser.add_argument('--output',default='reports/s5-live/artifact-checks.json');args=parser.parse_args()
sha=lambda data:hashlib.sha256(data).hexdigest()
frozen=json.loads((ROOT/'reports/s3-acceptance/freeze-manifest.json').read_text(encoding='utf-8'))
for path,expected in frozen['files'].items():
    assert sha((ROOT/path).read_bytes())==expected,f'Frozen input changed: {path}'
core=ROOT/'target/rs-ocr-0.1.0.jar'
assert sha(core.read_bytes())==frozen['runtime_jar_sha256'],'S3 engine JAR changed'
desktop=ROOT/'desktop/target/rs-ocr-desktop-0.1.0.jar'
with zipfile.ZipFile(core) as source,zipfile.ZipFile(desktop) as app:
    entries=[n for n in source.namelist() if (n.startswith('io/github/rsocr/') and n.endswith('.class')) or (n.startswith('ocr/') and n.endswith('.json'))]
    for name in entries:assert source.read(name)==app.read(name),f'Embedded engine differs: {name}'
    assert not any(n.endswith('.gba') or 'ground_truth' in n or n.startswith(('reports/','gba_testcase/','ngc_testcase/')) for n in app.namelist())
tests=[]
for path in sorted((ROOT/'desktop/target/surefire-reports').glob('TEST-*.xml')):
    suite=ET.parse(path).getroot()
    assert suite.get('errors')=='0' and suite.get('failures')=='0'
    tests.append(dict(suite=suite.get('name'),tests=int(suite.get('tests'))))
assert sum(t['tests'] for t in tests)>=9
report=dict(s3FrozenFilesVerified=len(frozen['files']),s3EngineSha256=frozen['runtime_jar_sha256'],
            embeddedEngineEntriesIdentical=len(entries),desktopJarSha256=sha(desktop.read_bytes()),
            noRomScreenshotsOrAnswersInJar=True,tests=tests)
out=ROOT/args.output
out.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(report,ensure_ascii=False))
