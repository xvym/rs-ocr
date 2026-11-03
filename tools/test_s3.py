"""Exercise the actual S3 gate with controlled failures in real frame output."""
from pathlib import Path
from contextlib import redirect_stdout
import copy
import hashlib
import io
import json
import sys
import tempfile
import unittest
from unittest.mock import patch
import accept_s3

ROOT=Path(__file__).resolve().parents[1]


class S3GateTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.outputs=[json.loads((ROOT/f'.tools/s3-{group}-raw.json').read_text(encoding='utf-8')) for group in ('gba','ngc')]

    def run_gate(self,change=None):
        with tempfile.TemporaryDirectory(prefix='s3-gate-',dir=ROOT/'.tools') as temp:
            work=Path(temp);out=work/'report';out.mkdir()
            for name in ['policy.json','ai-review.json','reference.json','freeze-manifest.json']:
                (out/name).write_bytes((ROOT/'reports/s3-acceptance'/name).read_bytes())
            data=copy.deepcopy(self.outputs)
            if change:change(data)
            paths=[]
            for i,value in enumerate(data):
                path=work/f'{i}.json';path.write_text(json.dumps(value,ensure_ascii=False),encoding='utf-8');paths.append(str(path))
            with patch.object(accept_s3,'OUT',out),patch.object(sys,'argv',['accept_s3.py','--results',*paths]),redirect_stdout(io.StringIO()):
                code=accept_s3.main()
            return code,json.loads((out/'evaluation.json').read_text(encoding='utf-8'))

    def test_frozen_real_outputs_pass(self):
        code,report=self.run_gate()
        self.assertEqual(0,code)
        self.assertEqual(579,report['approved']['strict_correct'])
        self.assertEqual(577,report['strict']['strict_correct'])

    def test_a_real_character_error_fails_without_being_waived(self):
        def change(data):data[0]['frames'][0]['regions'][0]['rawOcr']='誤'+data[0]['frames'][0]['regions'][0]['rawOcr'][1:]
        code,report=self.run_gate(change)
        self.assertEqual(1,code);self.assertFalse(report['s3_gate_passed'])

    def test_missing_target_fails(self):
        code,report=self.run_gate(lambda data:data[0]['frames'][0]['regions'].clear())
        self.assertEqual(1,code);self.assertTrue(report['approved']['missing_visible_regions'])

    def test_unexpected_region_fails(self):
        def change(data):data[0]['frames'][0]['regions'].append(copy.deepcopy(data[0]['frames'][0]['regions'][0]))
        code,report=self.run_gate(change)
        self.assertEqual(1,code);self.assertTrue(report['unexpected_detections'])

    def test_missing_original_is_rejected(self):
        with self.assertRaisesRegex(ValueError,'all frozen'):
            self.run_gate(lambda data:data[0]['frames'].pop())

    def test_wrong_image_or_engine_hash_is_rejected(self):
        def wrong_image(data):data[0]['frames'][0]['sourceSha256']='0'*64
        def wrong_engine(data):data[0]['engineSha256']='0'*64
        for change in (wrong_image,wrong_engine):
            with self.assertRaises(ValueError):self.run_gate(change)

    def test_negative_page_false_output_fails(self):
        def change(data):
            frame=next(f for f in data[0]['frames'] if f['source'].endswith('16-07-15.png'))
            frame['regions'].append(copy.deepcopy(data[0]['frames'][0]['regions'][0]))
        code,report=self.run_gate(change)
        self.assertEqual(1,code);self.assertTrue(report['scope_negative_false_outputs'])

    def test_even_an_empty_output_for_an_excluded_region_fails(self):
        def change(data):
            reference=json.loads((ROOT/'reports/s3-acceptance/reference.json').read_text(encoding='utf-8'))
            r=next(r for r in reference['regions'] if r['instance_id']=='GBA-027-R04')
            frame=next(f for f in data[0]['frames'] if f['source']==r['source'])
            frame['regions'].append(dict(typeCandidates=[r['region_type']],logicalBox=r['logical_box'],rawOcr='',status='recognized',characters=[]))
        code,report=self.run_gate(change)
        self.assertEqual(1,code);self.assertIn('GBA-027-R04',report['approved']['false_positive_excluded_regions'])


if __name__=='__main__':
    result=unittest.TextTestRunner(verbosity=1).run(unittest.defaultTestLoader.loadTestsFromTestCase(S3GateTest))
    report=dict(tests=result.testsRun,failures=len(result.failures),errors=len(result.errors),passed=result.wasSuccessful(),
        reference_sha256=hashlib.sha256((ROOT/'reports/s3-acceptance/reference.json').read_bytes()).hexdigest(),
        method='Real frame output with controlled character, target, extra-region, excluded-region, negative-page and identity failures; canonical acceptance reports are not overwritten.')
    (ROOT/'reports/s3-acceptance/gate-checks.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    raise SystemExit(0 if result.wasSuccessful() else 1)
