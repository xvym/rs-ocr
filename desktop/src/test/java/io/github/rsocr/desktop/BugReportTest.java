package io.github.rsocr.desktop;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.nio.file.*;
import java.time.Instant;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class BugReportTest {
    @TempDir Path root;
    private final ObjectMapper mapper=new ObjectMapper();

    @Test void preservesOriginalPixelsAndSnapshotResultsInUniqueCases() throws Exception {
        var raw=new BufferedImage(32,24,BufferedImage.TYPE_INT_ARGB);raw.setRGB(4,5,0x804321ef);
        var normalized=new BufferedImage(240,160,BufferedImage.TYPE_INT_RGB);
        var recognition=new LinkedHashMap<String,Object>();
        recognition.put("rawRegions",List.of(Map.of("rawOcr","テスト","status","pending")));recognition.put("translation",null);
        var context=new LinkedHashMap<String,Object>();context.put("frameId",123);context.put("mapping",null);
        var snapshot=new BugReport.Snapshot(Instant.now(),raw,normalized,recognition,context,"匹配说明");
        Path first=BugReport.write(root,snapshot,Map.of("polls",4));Path second=BugReport.write(root,snapshot,Map.of());
        assertNotEquals(first,second);assertEquals(root.resolve("bugreport"),first.getParent());
        var saved=ImageIO.read(first.resolve("original.png").toFile());assertEquals(32,saved.getWidth());assertEquals(24,saved.getHeight());assertEquals(raw.getRGB(4,5),saved.getRGB(4,5));
        assertEquals(240,ImageIO.read(first.resolve("normalized.png").toFile()).getWidth());
        var data=mapper.readTree(first.resolve("recognition.json").toFile());assertEquals("テスト",data.path("rawRegions").get(0).path("rawOcr").asText());assertTrue(data.path("translation").isNull());
        var meta=mapper.readTree(first.resolve("context.json").toFile());assertEquals(123,meta.path("frameId").asInt());assertTrue(meta.path("mapping").isNull());assertTrue(meta.path("originalAvailable").asBoolean());
        assertEquals("匹配说明",Files.readString(first.resolve("matching.txt")));assertTrue(Files.readString(first.resolve("threads.txt")).contains("BugReport"));
        assertFalse(Files.exists(first.resolve("INCOMPLETE.txt")));
    }
    @Test void emptyOrFailedCaptureStillProducesUsefulReport() throws Exception {
        Path folder=BugReport.write(root,new BugReport.Snapshot(Instant.now(),null,null,Map.of(),Map.of("status","capture failed"),""),Map.of());
        assertFalse(Files.exists(folder.resolve("original.png")));assertFalse(Files.exists(folder.resolve("normalized.png")));
        var meta=mapper.readTree(folder.resolve("context.json").toFile());assertFalse(meta.path("originalAvailable").asBoolean());assertEquals("capture failed",meta.path("status").asText());
        assertTrue(Files.exists(folder.resolve("README.txt")));assertTrue(Files.exists(folder.resolve("logs.json")));
    }
    @Test void copiesOnlyConfiguredProcessLogsAndBoundsTheirSize() throws Exception {
        Path source=root.resolve("process.log");byte[] bytes=new byte[1_048_600];Arrays.fill(bytes,(byte)'x');bytes[bytes.length-1]='!';Files.write(source,bytes);
        String old=System.getProperty("rsocr.log.stderr");
        try {
            System.setProperty("rsocr.log.stderr",source.toString());
            Path folder=BugReport.write(root,new BugReport.Snapshot(Instant.now(),null,null,Map.of(),Map.of(),""),Map.of());
            assertEquals(1_048_576,Files.size(folder.resolve("stderr.log")));assertTrue(Files.readString(folder.resolve("stderr.log")).endsWith("!"));
        } finally {if(old==null)System.clearProperty("rsocr.log.stderr");else System.setProperty("rsocr.log.stderr",old);}
    }
}
