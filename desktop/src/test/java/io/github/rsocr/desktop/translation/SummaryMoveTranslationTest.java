package io.github.rsocr.desktop.translation;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.github.rsocr.*;
import io.github.rsocr.desktop.*;
import io.github.rsocr.desktop.capture.*;
import java.awt.image.BufferedImage;
import java.util.*;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class SummaryMoveTranslationTest {
    private final ObjectMapper json=new ObjectMapper();
    private final OcrEngine ocr=new OcrEngine(json);
    private final TranslationEngine engine=new TranslationEngine(json);
    private final LiveLayout layout=new LiveLayout(json);
    SummaryMoveTranslationTest() throws Exception {}
    private BufferedImage image() throws Exception {
        try(var in=getClass().getResourceAsStream("/summary-move-translation.png")){return ImageIO.read(in);}
    }
    private OcrEngine.Region moves(BufferedImage image) {
        return ocr.recognize(layout.textImage(image,layout.locate(image))).stream().filter(r->r.typeCandidates().contains("summary_battle_moves")).findFirst().orElseThrow();
    }
    @Test void reportedRowsSplitIntoTypedNamesWithPpRetainedAsAField() throws Exception {
        var raw=moves(image()).rawOcr();var units=VisibleUnits.split(raw,List.of("summary_battle_moves"));
        assertEquals(9,units.size());assertEquals("おぼえているわざ",units.getFirst().raw());
        String[] types={"みず","エスパー","こおり","みず"},names={"なみのり","めいそう","れいとうビーム","ハイドロポンプ"};
        String[] pp={" PP15/15"," PP20/20"," PP10/10"," PP5/5"};
        for(int i=0;i<4;i++) {
            var type=units.get(1+i*2);var move=units.get(2+i*2);
            assertEquals("type",type.kind());assertEquals(types[i],type.searchText());
            assertEquals("move",move.kind());assertEquals(names[i],move.searchText());assertEquals(names[i]+pp[i],move.raw());
            assertEquals(List.of(new VisibleUnits.Field("current_pp",pp[i])),move.fields());
            assertEquals(type.raw(),raw.substring(type.start(),type.end()));assertEquals(move.raw(),raw.substring(move.start(),move.end()));
        }
    }
    @Test void bothGamesTranslateEveryReportedTypeAndMoveIndependently() throws Exception {
        var region=moves(image());
        for(String game:List.of("ruby","sapphire","both")) {
            var session=new TranslationSession(engine);session.configure(game,"");
            var result=session.translate(List.of(region)).regions().getFirst();
            assertEquals(region.rawOcr(),result.raw());
            assertEquals(List.of("水","冲浪","超能力","冥想","冰","冰冻光束","水","水炮"),result.units().stream().filter(TranslationEngine.Result::translated).map(TranslationEngine.Result::chinese).toList());
            assertEquals(List.of("冲浪 PP15/15","冥想 PP20/20","冰冻光束 PP10/10","水炮 PP5/5"),result.units().stream().filter(r->"move".equals(r.unit().kind())).map(TranslationEngine.Result::output).toList());
            assertTrue(result.units().stream().filter(TranslationEngine.Result::translated).allMatch(r->!r.citations().isEmpty()));
        }
    }
    private List<TranslationEngine.Result> lookup(String raw,String type) {
        return VisibleUnits.split(raw,List.of(type)).stream().map(u->engine.lookup(u,type,"both")).toList();
    }
    @Test void unknownFieldsAndChangedPpDoNotBlockOtherColumnsOrEnableOtherPages() {
        var unknownMove=lookup("みず なみの� PP0/15","summary_battle_moves");
        assertEquals("水",unknownMove.getFirst().chinese());assertNull(unknownMove.get(1).chinese());assertEquals("なみの� PP0/15",unknownMove.get(1).output());
        var unknownType=lookup("� なみのり PP1/15","summary_battle_moves");
        assertNull(unknownType.getFirst().chinese());assertEquals("冲浪 PP1/15",unknownType.get(1).output());
        for(String raw:List.of("みず　なみのり　PP０／１５","みず なみのり PP1/15 extra","みず なみのり"))
            assertTrue(lookup(raw,"summary_battle_moves").stream().noneMatch(TranslationEngine.Result::translated));
        assertTrue(lookup("みず なみのり PP15/15","summary_contest_moves").stream().noneMatch(TranslationEngine.Result::translated));
        var wrongKind=new VisibleUnits.Unit("みず",0,2,"みず","move",List.of());
        assertNull(engine.lookup(wrongKind,"summary_battle_moves","both").chinese());
    }
    @Test void translatedColumnsRespectNativeBoundsAndLeavePpRunsUntouched() throws Exception {
        var image=image();var region=moves(image);var presentation=new Presentation(json);
        var before=presentation.panels(List.of(region),image).getFirst();
        var after=new TranslationPresentation().apply(List.of(before),new TranslationSession(engine).translate(List.of(region))).getFirst();
        assertEquals(8,after.translations().size());assertEquals(before.raw(),after.raw());assertEquals(before.selections(),after.selections());
        for(var block:after.translations())assertTrue(block.box().x()+block.box().width()<=184);
        assertEquals(before.runs().stream().filter(r->r.x()>=184).toList(),after.runs().stream().filter(r->r.x()>=184).toList());
        for(var block:after.translations())if(Set.of("水","超能力","冰").contains(block.text()))assertTrue(block.box().x()+block.box().width()<=120);
    }
}
