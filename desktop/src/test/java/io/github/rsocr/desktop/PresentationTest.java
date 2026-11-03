package io.github.rsocr.desktop;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.github.rsocr.*;
import org.junit.jupiter.api.Test;
import javax.imageio.ImageIO;
import java.nio.file.Path;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class PresentationTest {
    private final ObjectMapper mapper=new ObjectMapper();
    private final Presentation presentation=new Presentation(mapper);
    private final OcrEngine engine=new OcrEngine(mapper);
    PresentationTest() throws Exception {}
    @Test void letterboxingUsesTheGameRatioWithTheSameScaleOnBothAxes() {
        var fit=Presentation.Fit.inside(800,800);assertEquals(800,fit.width());assertEquals(800*2.0/3,fit.height(),.001);assertEquals((800-fit.height())/2,fit.y(),.001);
        var wide=Presentation.Fit.inside(1000,400);assertEquals(200,wide.x());assertEquals(600,wide.width());assertEquals(400,wide.height());
    }
    @Test void battlePanelUsesNativeAllocationAndKeepsItsMenuAboveIt() throws Exception {
        // A constructed panel pair checks native allocation independently of source crop geometry.
        var prompt=new OcrEngine.Region(List.of("battle_prompt"),"battle_red",new int[]{0,112,136,48},1,"原文","recognized",List.of());
        var menu=new OcrEngine.Region(List.of("battle_action"),"standard_1",new int[]{136,112,104,48},1,"選択","recognized",List.of());
        var panels=presentation.panels(List.of(menu,prompt),null);
        assertEquals("battle_prompt",panels.getFirst().key());assertEquals(240,panels.getFirst().frame().width());assertEquals(136,panels.getFirst().clip().width());
    }
    @Test void realListKeepsAllValuesAndSelectionCoordinatesUnderItsActionMenu() throws Exception {
        var input=ImageIO.read(Path.of("../gba_testcase/Screenshot 2026-10-31 16-07-07.png").toFile());
        var image=Normalizer.normalize(input,Normalizer.preset("gba-5x",input));var regions=engine.recognize(image);
        var panels=presentation.panels(regions,image);var list=panels.stream().filter(p->p.key().equals("bag_list")).findFirst().orElseThrow();
        assertEquals(8,list.raw().lines().count());assertTrue(list.pointers().stream().anyMatch(p->p.x()==112 && p.y()==16));
        assertTrue(list.runs().stream().anyMatch(r->r.x()==224 && r.raw().equals("9")));
        assertTrue(panels.indexOf(list)<panels.indexOf(panels.stream().filter(p->p.key().equals("bag_action")).findFirst().orElseThrow()));
    }
    @Test void precomposedLabelsHaveTheirOwnDimensionsAndRawTextIsNeverRewritten() throws Exception {
        var label=new OcrEngine.CharacterResult(218,124,-1,"FEEL",List.of("FEEL"),0,-1);
        var region=new OcrEngine.Region(List.of("condition_graph"),"condition",new int[]{96,24,144,114},1,"FEEL","recognized",List.of(label));
        var panel=presentation.panels(List.of(region),null).getFirst();assertEquals(15,panel.runs().getFirst().width());assertEquals(7,panel.runs().getFirst().height());assertEquals("FEEL",panel.raw());
        assertNull(panel.frame(),"A composite graph ROI must not become an invented rectangular allocation.");
    }
    @Test void automaticProfileUsesDimensionsAndRejectsUnsupportedGeometry() {
        assertEquals("gba-5x",DesktopApplication.autoProfile(1200,800));assertEquals("ngc-capture",DesktopApplication.autoProfile(1600,1200));
        assertThrows(IllegalArgumentException.class,()->DesktopApplication.autoProfile(1280,720));
    }
    @Test void nativeBattleArrowAndMoveOutlineKeepTheActualSelection() throws Exception {
        var reference=mapper.readTree(Path.of("../reports/s3-acceptance/reference.json").toFile());
        for(String id:List.of("GBA-090","NGC-126")) {
            com.fasterxml.jackson.databind.JsonNode entry=null;
            for(var im:reference.get("images"))if(im.get("id").asText().equals(id))entry=im;
            assertNotNull(entry);
            var input=ImageIO.read(Path.of("..",entry.get("source").asText()).toFile());
            String profile=DesktopApplication.autoProfile(input.getWidth(),input.getHeight());
            var image=Normalizer.normalize(input,Normalizer.preset(profile,input));
            var panels=presentation.panels(engine.recognize(image,profile.equals("ngc-capture")?.82:.984),image);
            if(id.equals("GBA-090"))assertTrue(panels.stream().flatMap(p->p.pointers().stream()).anyMatch(p->p.x()==144 && p.y()==120));
            else assertTrue(panels.stream().flatMap(p->p.selections().stream()).anyMatch(b->b.contains(150,40)),"The first move is outlined in the actual capture.");
        }
    }
}
