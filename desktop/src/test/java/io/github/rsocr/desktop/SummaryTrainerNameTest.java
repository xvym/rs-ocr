package io.github.rsocr.desktop;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.github.rsocr.*;
import io.github.rsocr.desktop.capture.*;
import io.github.rsocr.desktop.translation.*;
import java.awt.image.BufferedImage;
import java.util.*;
import java.util.concurrent.atomic.AtomicLong;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class SummaryTrainerNameTest {
    private final ObjectMapper json=new ObjectMapper();
    private final OcrEngine engine=new OcrEngine(json);
    private final LiveLayout layout=new LiveLayout(json);
    SummaryTrainerNameTest() throws Exception {}
    private BufferedImage source() throws Exception {
        try(var in=getClass().getResourceAsStream("/summary-trainer-name.png")){return ImageIO.read(in);}
    }
    private OcrEngine.Region personal(List<OcrEngine.Region> regions) {
        return regions.stream().filter(r->r.typeCandidates().contains("summary_personal")).findFirst().orElseThrow();
    }
    private List<OcrEngine.Region> recognize(BufferedImage image,double gain) {
        return engine.recognize(layout.textImage(image,layout.locate(image,gain),gain),gain);
    }
    @Test void reportedPinkNameIsReadWithoutChangingTheSourceOrOtherFields() throws Exception {
        var image=source();int[] original=image.getRGB(0,0,240,160,null,0,240);
        var before=engine.recognize(image);assertTrue(personal(before).rawOcr().contains("おや/��� IDNo58333"));
        var after=recognize(image,.984);var owner=personal(after);
        assertEquals("recognized",owner.status());assertTrue(owner.rawOcr().contains("おや/ハルカ IDNo58333"));
        assertTrue(owner.rawOcr().endsWith("タイプ/みず じめん"));
        for(var region:before)if(!region.typeCandidates().contains("summary_personal"))
            assertEquals(region.rawOcr(),after.stream().filter(r->r.typeCandidates().equals(region.typeCandidates())).findFirst().orElseThrow().rawOcr());
        assertArrayEquals(original,image.getRGB(0,0,240,160,null,0,240));
        assertSame(image,layout.textImage(image,List.of(),.984),"Only a detected personal panel enables the name adapter.");
        var translated=new TranslationSession(new TranslationEngine(json)).translate(after);
        assertTrue(translated.regions().stream().flatMap(r->r.units().stream()).anyMatch(u->"小遥".equals(u.chinese())));
        assertNull(translated.player(),"An original trainer is not necessarily the current player.");
    }
    private BufferedImage name(String name,double gain) throws Exception {
        var image=source();double ratio=gain/.984;
        for(int y=0;y<160;y++)for(int x=0;x<240;x++) {
            int rgb=image.getRGB(x,y),scaled=0;
            for(int shift:new int[]{16,8,0})scaled|=(int)Math.round(((rgb>>shift)&255)*ratio)<<shift;
            image.setRGB(x,y,scaled);
        }
        int background=image.getRGB(112,32);
        for(int y=32;y<48;y++)for(int x=112;x<152;x++)image.setRGB(x,y,background);
        var masks=new ArrayList<int[]>();
        try(var in=OcrEngine.class.getResourceAsStream("/ocr/fonts.json")) {
            var glyphs=json.readTree(in).get("glyphs");
            for(int i=0;i<name.length();i++)for(var glyph:glyphs)
                if(glyph.get("font").asInt()==3 && glyph.get("text").asText().equals(name.substring(i,i+1))) {
                    int[] rows=new int[16];for(int y=0;y<16;y++)rows[y]=glyph.get("rows").get(y).asInt();masks.add(rows);break;
                }
        }
        assertEquals(name.length(),masks.size());
        for(int layer=0;layer<2;layer++) {
            int[] color=layer==0?new int[]{212,115,107}:new int[]{249,184,176};int rgb=0;
            for(int c=0;c<3;c++)rgb|=(int)Math.round(color[c]*ratio)<<(16-8*c);
            int offset=layer==0?1:0;
            for(int i=0;i<masks.size();i++)for(int y=0;y<16-offset;y++)for(int x=0;x<8;x++)
                if((masks.get(i)[y]&(1<<(7-x)))!=0 && 112+i*8+x+offset<152)
                    image.setRGB(112+i*8+x+offset,32+y+offset,rgb);
        }
        return image;
    }
    @Test void otherNamesAndBothCaptureGainsUsePixelsInsteadOfGuessingHaruka() throws Exception {
        for(double gain:new double[]{.984,.82})for(String name:List.of("アオイ","ミズゴロウ")) {
            var result=personal(recognize(name(name,gain),gain));
            assertEquals("recognized",result.status());assertTrue(result.rawOcr().contains("おや/"+name+" IDNo58333"),result.rawOcr());
        }
    }
    @Test void damagedLettersStayUnknownAndAChangedTrainerRejectsThePriorName() throws Exception {
        var broken=source();broken.setRGB(113,35,broken.getRGB(112,32));
        assertTrue(personal(recognize(broken,.984)).rawOcr().contains("おや/�ルカ"));
        var clock=new AtomicLong();var state=new LiveState(layout,clock::get);state.newSession(1);
        state.observe(source(),.984,1);clock.set(LiveState.STABILITY_NANOS);var old=state.job();assertNotNull(old);
        var next=name("アオイ",.984);state.observe(next,.984,2);state.complete(old,engine.recognize(old.image(),old.gain()));
        assertEquals("pending",personal(state.snapshot().regions()).status());
        clock.addAndGet(LiveState.STABILITY_NANOS);var current=state.job();assertNotNull(current);
        state.complete(current,engine.recognize(current.image(),current.gain()));
        assertTrue(personal(state.snapshot().regions()).rawOcr().contains("おや/アオイ"));
    }
}
