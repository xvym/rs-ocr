package io.github.rsocr.desktop.translation;

import com.fasterxml.jackson.databind.*;
import io.github.rsocr.*;
import io.github.rsocr.desktop.*;
import io.github.rsocr.desktop.capture.LiveLayout;
import java.nio.file.*;
import java.util.*;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class MoveDescriptionTranslationTest {
    private static final ObjectMapper JSON=new ObjectMapper();
    private final TranslationEngine engine=new TranslationEngine(JSON);
    private final JsonNode data=JSON.readTree(getClass().getResourceAsStream("/translation/runtime.json"));
    private static final String BODY="いきおいをつけて　てきに　たいあたり\nじぶんもすこし　ダメージをうける";
    private static final String CHINESE="以惊人的气势撞向对手。\n自己也会受到少许伤害。";
    MoveDescriptionTranslationTest() throws Exception {}

    @Test void takeDownHeadingAndBodyAreIndependentInBothGames() {
        for(String game:List.of("ruby","sapphire","both"))for(String body:List.of(BODY,BODY.replace('　',' '),BODY.replace('　','\t'),BODY+" ")) {
            String raw="せつめい\n"+body;
            var units=VisibleUnits.split(raw,List.of("summary_move_description"));
            assertEquals(2,units.size());assertEquals("せつめい",units.getFirst().raw());
            assertEquals(body,units.get(1).raw());assertEquals("move_description",units.get(1).kind());
            assertEquals(body,raw.substring(units.get(1).start(),units.get(1).end()));
            var result=engine.lookup(units.get(1),"summary_move_description",game);
            assertEquals(CHINESE,result.chinese());assertEquals(body,result.unit().raw());
            assertEquals(List.of("rs.common.move_descriptions.MoveDescription_TakeDown"),result.sourceQids());
            assertTrue(result.citations().stream().allMatch(c->c.path("sourceLine").asText().equals("6244")));
        }
        assertEquals(CHINESE,engine.lookup(VisibleUnits.split(BODY,List.of("summary_move_description")).getFirst(),"summary_move_description","both").chinese());
    }
    @Test void titleOnlyPrefixesUnknownGlyphsAndArbitraryLeadingTextStayRaw() {
        var heading=VisibleUnits.split("せつめい",List.of("summary_move_description"));
        assertEquals(1,heading.size());assertNull(heading.getFirst().kind());
        for(String raw:List.of("せつめい\n"+BODY.substring(0,BODY.length()-1),"せつめい\n"+BODY+"�","ほかの項目\n"+BODY))
            assertTrue(VisibleUnits.split(raw,List.of("summary_move_description")).stream().noneMatch(u->engine.lookup(u,"summary_move_description","both").translated()));
    }
    @Test void actualMoveDescriptionScreenshotsTranslateOnlyTheirBody() throws Exception {
        var reference=JSON.readTree(Path.of("../corpus/visible-windows/reference.json").toFile());
        var symbols=Map.of("GBA-306-R05","DoubleKick","GBA-307-R05","DoubleKick","GBA-313-R05","WingAttack","NGC-126-R05","MudShot","NGC-127-R05","Waterfall","NGC-134-R05","Thunderbolt","NGC-135-R05","Thunderbolt","NGC-136-R05","Thunder","NGC-137-R05","Thunder");
        var ocr=new OcrEngine(JSON);var layout=new LiveLayout(JSON);var presentation=new Presentation(JSON);var checks=new ArrayList<Map<String,Object>>();
        for(var fixture:reference.path("regions"))if(fixture.path("typeCandidates").size()==1&&fixture.path("typeCandidates").get(0).asText().equals("summary_move_description")) {
            String id=fixture.path("id").asText();var input=ImageIO.read(Path.of("..",fixture.path("source").asText()).toFile());
            String preset=DesktopApplication.autoProfile(input.getWidth(),input.getHeight());double gain=preset.equals("ngc-capture")?.82:.984;
            var image=Normalizer.normalize(input,Normalizer.preset(preset,input));
            var region=ocr.recognize(layout.textImage(image,layout.locate(image,gain),gain),gain).stream().filter(r->r.typeCandidates().contains("summary_move_description")).findFirst().orElseThrow(()->new AssertionError("Missing description region: "+id));
            assertEquals(fixture.path("japanese").asText(),region.rawOcr(),id);
            var frame=new TranslationSession(engine).translate(List.of(region));
            var units=frame.regions().getFirst().units();
            if(symbols.containsKey(id)) {
                String qid="rs.common.move_descriptions.MoveDescription_"+symbols.get(id);JsonNode source=null;
                for(var r:data.path("sourceRecords"))if(r.path("qid").asText().equals(qid)){source=r;break;}
                assertNotNull(source,id);assertEquals(2,units.size(),id);
                assertEquals(source.path("outputText").asText(),units.get(1).chinese(),id);
                var before=presentation.panels(List.of(region),image).getFirst();
                var after=new TranslationPresentation().apply(List.of(before),frame).getFirst();
                assertEquals(1,after.translations().size(),id);
                assertTrue(after.runs().stream().anyMatch(r->r.raw().equals("せつめい")),id);
                assertTrue(after.translations().getFirst().box().y()>before.runs().stream().filter(r->r.raw().equals("せつめい")).findFirst().orElseThrow().y(),id);
            }else assertTrue(units.stream().noneMatch(TranslationEngine.Result::translated),id);
            checks.add(Map.of("id",id,"raw",region.rawOcr(),"bodyTranslated",units.stream().anyMatch(TranslationEngine.Result::translated)));
        }
        assertEquals(12,checks.size());
        Files.createDirectories(Path.of("../reports/move-description"));JSON.writerWithDefaultPrettyPrinter().writeValue(Path.of("../reports/move-description/screenshot-checks.json").toFile(),Map.of("passed",true,"checks",checks,"scope","Actual frozen screenshots through OCR, region splitting, translation and text-block geometry; no Take Down screenshot or continuous-device run claimed"));
    }
}
