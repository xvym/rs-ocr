"""Guard the visual-equivalence boundary against masking genuine OCR errors."""
import unittest
from evaluate_ocr import font3_equivalent


class EquivalenceBoundaryTest(unittest.TestCase):
    pairs={frozenset(('へ','ヘ')),frozenset(('0','O'))}

    def prediction(self,**changes):
        character=dict(raw='へ',font=3,distance=0,candidates=['へ','ヘ'])
        character.update(changes)
        return dict(rawOcr='へ',characters=[character])

    def test_exact_native_observation_retains_both_candidates(self):
        self.assertTrue(font3_equivalent('ヘ',self.prediction(),self.pairs))

    def test_different_font_is_not_equivalent(self):
        self.assertFalse(font3_equivalent('ヘ',self.prediction(font=4),self.pairs))

    def test_damaged_pixel_cannot_be_waived(self):
        self.assertFalse(font3_equivalent('ヘ',self.prediction(distance=1),self.pairs))

    def test_candidate_must_be_observed(self):
        self.assertFalse(font3_equivalent('ヘ',self.prediction(candidates=['へ']),self.pairs))

    def test_whitespace_and_other_codepoints_remain_strict(self):
        for text in ('ヘ ','ヘ\n','べ','ヘヘ'):
            self.assertFalse(font3_equivalent(text,self.prediction(),self.pairs))

    def test_a_precomposed_label_does_not_shift_character_alignment(self):
        prediction=dict(rawOcr='FEEL へ\n0',characters=[
            dict(raw='FEEL',font=-1,distance=0,candidates=['FEEL']),
            self.prediction()['characters'][0],
            dict(raw='0',font=3,distance=0,candidates=['0','O'])])
        self.assertTrue(font3_equivalent('FEEL ヘ\nO',prediction,self.pairs))
        self.assertFalse(font3_equivalent('FEEL ヘ O',prediction,self.pairs))

    def test_bitmap_label_is_never_a_font3_observation(self):
        self.assertFalse(font3_equivalent('ヘ',self.prediction(font=-1),self.pairs))


if __name__=='__main__':unittest.main()
