package io.github.rsocr;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.nio.file.Path;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class OcrEngineTest {
    private final OcrEngine engine=new OcrEngine(new ObjectMapper());
    OcrEngineTest() throws Exception {}

    private BufferedImage capture(String path,String profile) throws Exception {
        var image=ImageIO.read(Path.of(path).toFile());
        return Normalizer.normalize(image,Normalizer.preset(profile,image));
    }

    private OcrEngine.Region region(List<OcrEngine.Region> results,String type) {
        return results.stream().filter(r->r.typeCandidates().contains(type)).findFirst().orElseThrow();
    }

    @Test void readsJapaneseFromGbaPixelsWithPunctuationAndLineBreaks() throws Exception {
        var image=capture("gba_testcase/Screenshot 2026-10-31 15-38-28.png","gba-5x");
        var result=region(engine.recognize(image),"field_dialog");
        assertEquals("ポケモンの とくせいに よっては\nわざの いりょくが かわったり",result.rawOcr());
        assertEquals("recognized",result.status());
    }

    @Test void readsNgcWithIndependentColorAndViewportCalibration() throws Exception {
        var image=capture("ngc_testcase/Screenshot 2026-11-01 14-57-46.png","ngc-capture");
        var result=region(engine.recognize(image,.82),"boot_dialog");
        assertEquals("とけいに かんけいする できごとは おきませんが\nゲームを つづけて あそぶことは できます",result.rawOcr());
    }

    @Test void alteredCharacterStaysUnknownInsteadOfBeingCorrectedFromAWord() throws Exception {
        var image=capture("gba_testcase/Screenshot 2026-10-31 15-38-28.png","gba-5x");
        image.setRGB(32,120,0x222222);
        var result=region(engine.recognize(image),"field_dialog");
        assertTrue(result.rawOcr().startsWith("�"));
        assertEquals("unknown_glyph",result.status());
        assertEquals(1,result.characters().getFirst().distance());
        assertTrue(result.characters().getFirst().candidates().contains("ポ"));
    }

    @Test void retainsTheCompleteListWhenAnActionMenuCoversOnlyItsFrame() throws Exception {
        var image=capture("gba_testcase/Screenshot 2026-10-31 16-07-07.png","gba-5x");
        var result=region(engine.recognize(image),"bag_list");
        assertEquals("No01クラボのみ × 9\nNo02カゴのみ × 7\nNo03モモンのみ × 14\nNo04チーゴのみ × 6\nNo05ナナシのみ × 8\nNo06ヒメリのみ × 6\nNo07オレンのみ × 3\nNo08キーのみ × 9",result.rawOcr());
    }

    @Test void doesNotOutputTheHiddenPartyPromptBehindRecoveryMessage() throws Exception {
        var image=capture("gba_testcase/Screenshot 2026-10-31 15-58-25.png","gba-5x");
        var results=engine.recognize(image);
        assertTrue(results.stream().noneMatch(r->r.typeCandidates().contains("party_prompt")));
        assertEquals("カイオーガの たいりょくが\n17 かいふくした",region(results,"party_recovery").rawOcr());
    }

    @Test void dialogueDoesNotBecomeExtraBagListRowsAndDoesNotLeaveAClippedLayout() throws Exception {
        for(String source:List.of("15-42-31","15-42-33")) {
            var image=capture("gba_testcase/Screenshot 2026-10-31 "+source+".png","gba-5x");
            var results=engine.recognize(image);
            assertEquals("はいぶくろ\nゴーゴーゴーグル\nツメのカセキ\nちかのカギ\nいいつりざお\nデボンスコープ",region(results,"bag_list").rawOcr());
            assertFalse(region(results,"field_dialog").rawOcr().isEmpty());
        }
        // The next input must still read all eight slots when no dialogue owns them.
        var restored=capture("gba_testcase/Screenshot 2026-10-31 16-07-07.png","gba-5x");
        assertEquals(8,region(engine.recognize(restored),"bag_list").rawOcr().lines().count());
    }

    @Test void readsFeelFromNativeSpriteButDoesNotInventItAfterPixelDamage() throws Exception {
        var image=capture("ngc_testcase/Screenshot 2026-11-01 15-07-37.png","ngc-capture");
        assertEquals("かっこよさ\nたくましさ うつくしさ\nかしこさ かわいさ\nFEEL",region(engine.recognize(image,.82),"condition_graph").rawOcr());
        for(int x=218;x<222;x++)image.setRGB(x,124,0x222222);
        var damaged=region(engine.recognize(image,.82),"condition_graph");
        assertTrue(damaged.rawOcr().endsWith("�"));
        assertEquals("unknown_glyph",damaged.status());
    }

    @Test void uniformFramesDoNotBecomeTextAndNoResultLeaksAcrossCalls() throws Exception {
        engine.recognize(capture("gba_testcase/Screenshot 2026-10-31 15-38-28.png","gba-5x"));
        for(int color:new int[]{0x000000,0xFFFFFF,0x777777}) {
            var image=new BufferedImage(240,160,BufferedImage.TYPE_INT_RGB);
            for(int y=0;y<160;y++)for(int x=0;x<240;x++)image.setRGB(x,y,color);
            assertTrue(engine.recognize(image).isEmpty());
        }
    }

    @Test void invalidCalibrationFailsExplicitly() {
        assertThrows(IllegalArgumentException.class,()->new Normalizer.Viewport(Double.NaN,0,1200,800));
        assertThrows(IllegalArgumentException.class,()->new Normalizer.Viewport(0,0,0,0));
        var image=new BufferedImage(1200,800,BufferedImage.TYPE_INT_RGB);
        assertThrows(IllegalArgumentException.class,()->Normalizer.preset("ngc-capture",image));
        assertThrows(IllegalArgumentException.class,()->Normalizer.normalize(image,new Normalizer.Viewport(20,0,1200,800)));
    }

    @Test void readsNativeTypeBadgesAndPpWithoutUsingMoveNamesAsHints() throws Exception {
        var image=capture("gba_testcase/Screenshot 2026-11-01 20-59-19.png","gba-5x");
        assertEquals("おぼえているわざ\nかくとう ビルドアップ PP20/20\nひこう つつく PP35/35\nかくとう にどげり PP30/30\nほのお ひのこ PP25/25\nもどる",
                region(engine.recognize(image),"summary_battle_moves").rawOcr());
    }

    @Test void selectionHighlightDoesNotHideTheExpandedMovePanel() throws Exception {
        var image=capture("ngc_testcase/Screenshot 2026-11-01 21-17-10.png","ngc-capture");
        assertEquals("おぼえているわざ\nじめん マッドショット PP15/15\nこおり れいとうビーム PP10/10\nみず たきのぼり PP15/15\nじめん どろかけ PP9/10\nもどる",
                region(engine.recognize(image,.82),"summary_battle_moves").rawOcr());
    }

    @Test void aWhitePcDescriptionDoesNotBecomeABerryOrPokeblockPage() throws Exception {
        var image=capture("ngc_testcase/Screenshot 2026-11-01 14-58-56.png","ngc-capture");
        var results=engine.recognize(image,.82);
        assertNotNull(region(results,"pc_item_list"));
        assertTrue(results.stream().noneMatch(r->r.typeCandidates().contains("berry_tag_description") || r.typeCandidates().contains("block_flavors")));
    }
}
