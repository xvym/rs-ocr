package io.github.rsocr.desktop;

import io.github.rsocr.OcrEngine;
import org.junit.jupiter.api.Test;
import java.awt.image.BufferedImage;
import java.nio.file.Path;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class ImageSessionTest {
    private final BufferedImage image=new BufferedImage(240,160,BufferedImage.TYPE_INT_RGB);
    private final OcrEngine.Region text=new OcrEngine.Region(List.of("field_dialog"),"dialogue_jp",new int[]{8,112,224,48},1,"古い結果","recognized",List.of());
    @Test void switchingImageRemovesOldTextBeforeLoadingAndRejectsLateCompletion() {
        var session=new ImageSession();long first=session.begin(Path.of("one.png"));session.imageReady(first,image);session.complete(first,List.of(text),1);
        long next=session.begin(Path.of("two.png"));assertTrue(session.view().regions().isEmpty());assertNull(session.view().image());
        assertFalse(session.imageReady(first,image));assertFalse(session.complete(first,List.of(text),2));assertFalse(session.fail(first,"late failure"));
        assertTrue(session.imageReady(next,image));assertTrue(session.complete(next,List.of(),3));assertTrue(session.view().regions().isEmpty());
    }
    @Test void stoppingAndFailureDoNotResurrectPriorResults() {
        var session=new ImageSession();long generation=session.begin(Path.of("one.png"));session.imageReady(generation,image);
        session.stop();assertFalse(session.complete(generation,List.of(text),1));assertNull(session.view().image());
        generation=session.begin(Path.of("bad.png"));assertTrue(session.fail(generation,"invalid image"));
        assertFalse(session.imageReady(generation,image));assertEquals(ImageSession.Phase.FAILED,session.view().phase());assertTrue(session.view().regions().isEmpty());
    }
    @Test void anObservableEmptyPanelRemainsAPanelRatherThanDisappearing() {
        var session=new ImageSession();long generation=session.begin(Path.of("empty.png"));session.imageReady(generation,image);
        var empty=new OcrEngine.Region(text.typeCandidates(),text.variant(),text.logicalBox(),1,"","recognized",List.of());
        session.complete(generation,List.of(empty),1);assertEquals(1,session.view().regions().size());assertEquals("",session.view().regions().getFirst().rawOcr());
    }
}
