"""Check the built artifact, renamed-image isolation and review artifacts.

This is development validation, not the S3 accuracy gate. Run the full image
evaluation first; its incomplete result is preserved explicitly in checks.json.
"""
from pathlib import Path
import argparse
import hashlib
from html.parser import HTMLParser
import json
import os
import re
import shutil
import subprocess
import xml.etree.ElementTree as ET
from zipfile import ZipFile

ROOT=Path(__file__).resolve().parents[1]
REPORT=ROOT/'reports/ocr-development'


def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--java',default=str(Path(os.environ['JAVA_HOME'])/'bin/java.exe') if os.environ.get('JAVA_HOME') else 'java')
    args=parser.parse_args()
    jar=ROOT/'target/rs-ocr-0.1.0.jar'
    evaluation=json.loads((REPORT/'evaluation.json').read_text(encoding='utf-8'))
    assert evaluation['runtime_jar_sha256']==sha(jar),'Evaluation belongs to another build.'
    suite=ET.parse(ROOT/'target/surefire-reports/TEST-io.github.rsocr.OcrEngineTest.xml').getroot()
    assert int(suite.attrib['failures'])==0 and int(suite.attrib['errors'])==0
    with ZipFile(jar) as archive:
        forbidden=[n for n in archive.namelist() if n.endswith(('.gba','.sav')) or 'ground_truth' in n or 'testcase' in n]
        assert not forbidden,forbidden
        resources=[n for n in archive.namelist() if n.startswith('ocr/') and n.endswith('.json')]
        assert sorted(resources)==['ocr/fonts.json','ocr/labels.json','ocr/regions.json','ocr/sprites.json']
        for name in resources:
            data=archive.read(name)
            assert data==(ROOT/'src/main/resources'/name).read_bytes(),f'Stale resource: {name}'
            assert not re.search(rb'GBA-\d{3}|NGC-\d{3}|Screenshot 2026|ground_truth|transcriptions\.json',data),name

    # Keep the small smoke directory under the workspace; do not change or
    # temporarily move the user's ROMs, originals or reference annotations.
    capsule=ROOT/'.tools/offline-smoke'
    capsule.mkdir(parents=True,exist_ok=True)
    shutil.copyfile(jar,capsule/'app.jar')
    baseline=json.loads((REPORT/'gba-raw.json').read_text(encoding='utf-8'))['frames'][0]
    shutil.copyfile(ROOT/baseline['source'],capsule/'任意名称.png')
    result=subprocess.run([args.java,'-jar','app.jar','--image','任意名称.png','--profile','gba-5x','--out','result.json'],
        cwd=capsule,capture_output=True,text=True,encoding='utf-8',errors='replace')
    assert result.returncode==0,result.stderr
    isolated=json.loads((capsule/'result.json').read_text(encoding='utf-8'))
    assert isolated['engineSha256']==sha(jar)
    assert isolated['frames'][0]['regions']==baseline['regions'],'Renaming/moving the input changed recognition.'
    assert isolated['frames'][0]['sourceSha256']==baseline['sourceSha256']

    class Review(HTMLParser):
        def __init__(self):super().__init__();self.images=[];self.articles=0
        def handle_starttag(self,tag,attrs):
            if tag=='article':self.articles+=1
            if tag=='img':self.images.append(dict(attrs)['src'])
    review=Review();review.feed((REPORT/'review.html').read_text(encoding='utf-8'))
    assert review.articles==evaluation['total_scope_records']==574
    assert all((REPORT/path).is_file() for path in review.images)
    report=dict(check_kind='development_structure_and_isolated_runtime_smoke',
        runtime_jar_sha256=sha(jar),unit_tests=int(suite.attrib['tests']),unit_failures=0,unit_errors=0,
        jar_resources=resources,forbidden_test_or_rom_entries=forbidden,
        runtime_resources_have_no_testcase_identity_or_answers=True,
        isolated_jar_with_unicode_renamed_input_matches=True,review_regions=review.articles,review_images_exist=True,
        evaluated_input_frames=evaluation['evaluated_frames'],strict_correct=evaluation['strict_correct'],
        scope_records=evaluation['total_scope_records'],excluded_false_outputs=evaluation['false_positive_excluded_regions'],
        s3_gate_passed=False,reference_status=evaluation['reference_freeze_status'],
        warning='These checks do not freeze annotations, remove OCR failures, establish a holdout set or validate capture/timing.')
    (REPORT/'checks.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(report,ensure_ascii=True,indent=2))


if __name__=='__main__':main()
