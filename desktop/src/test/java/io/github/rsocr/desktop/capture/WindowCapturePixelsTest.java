package io.github.rsocr.desktop.capture;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class WindowCapturePixelsTest {
    @Test void nativeArgbChannelsRowsAndExistingSnapshotsRemainCorrect() {
        int[] first={0xff102030,0xffffffff,0xff001122,0xffabcdef};
        var image=WindowCapture.fromPixels(2,2,first);
        assertArrayEquals(first,image.getRGB(0,0,2,2,null,0,2));assertEquals(0xff001122,image.getRGB(0,1));
        var next=WindowCapture.fromPixels(2,2,new int[]{0xff998877,0xff112233,0xff445566,0xffaabbcc});
        assertEquals(0xff998877,next.getRGB(0,0));assertArrayEquals(first,image.getRGB(0,0,2,2,null,0,2));
    }
}
