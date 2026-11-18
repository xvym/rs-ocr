package io.github.rsocr.desktop;

import com.fasterxml.jackson.databind.ObjectMapper;
import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.*;
import java.lang.management.ManagementFactory;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.*;
import java.time.format.DateTimeFormatter;
import java.util.*;

/** A report owns references to immutable published frames, never a later recapture. */
public final class BugReport {
    public record Snapshot(Instant requestedAt,BufferedImage original,BufferedImage normalized,
                           Map<String,Object> recognition,Map<String,Object> context,String matching) {}
    private static final DateTimeFormatter STAMP=DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss-SSS");

    public static Path projectRoot() {
        String configured=System.getProperty("rsocr.project.root");
        if(configured!=null && !configured.isBlank())return Path.of(configured).toAbsolutePath().normalize();
        Path cwd=Path.of("").toAbsolutePath().normalize();
        for(Path p=cwd;p!=null;p=p.getParent())if(Files.isRegularFile(p.resolve("desktop/pom.xml")))return p;
        try {
            Path location=Path.of(BugReport.class.getProtectionDomain().getCodeSource().getLocation().toURI());
            for(Path p=location.getParent();p!=null;p=p.getParent())if(Files.isRegularFile(p.resolve("desktop/pom.xml")))return p;
        } catch(Exception ignored) {}
        return cwd;
    }

    public static Path write(Path root,Snapshot snapshot,Map<String,Object> liveMetrics) throws IOException {
        Path reports=root.resolve("bugreport");Files.createDirectories(reports);
        // Atomic directory allocation also handles two presses in the same millisecond.
        Path folder=Files.createTempDirectory(reports,"case-"+STAMP.format(snapshot.requestedAt().atZone(ZoneId.systemDefault()))+"-");
        Files.writeString(folder.resolve("INCOMPLETE.txt"),"Report is still being written. If this file remains, saving failed or the application exited.\n");
        var mapper=new ObjectMapper().writerWithDefaultPrettyPrinter();
        if(snapshot.original()!=null)writeImage(folder.resolve("original.png"),snapshot.original());
        if(snapshot.normalized()!=null)writeImage(folder.resolve("normalized.png"),snapshot.normalized());
        mapper.writeValue(folder.resolve("recognition.json").toFile(),snapshot.recognition());
        var context=new LinkedHashMap<>(snapshot.context());
        context.put("schemaVersion",1);context.put("requestedAt",snapshot.requestedAt().toString());
        context.put("originalAvailable",snapshot.original()!=null);context.put("normalizedAvailable",snapshot.normalized()!=null);
        context.put("originalSize",size(snapshot.original()));context.put("normalizedSize",size(snapshot.normalized()));
        context.put("projectRoot",root.toAbsolutePath().normalize().toString());
        context.put("liveMetricsCollectedAfterRequest",liveMetrics);
        context.put("runtime",runtime());
        mapper.writeValue(folder.resolve("context.json").toFile(),context);
        Files.writeString(folder.resolve("matching.txt"),snapshot.matching(),StandardCharsets.UTF_8);
        Files.writeString(folder.resolve("threads.txt"),threads(),StandardCharsets.UTF_8);
        // The launcher provides the exact files for this JVM; never guess the newest log.
        var logs=new LinkedHashMap<String,Object>();
        for(String kind:List.of("stdout","stderr")) {
            String source=System.getProperty("rsocr.log."+kind,"");
            if(source.isBlank()){logs.put(kind,"No redirected log configured for this launch");continue;}
            try {copyTail(Path.of(source),folder.resolve(kind+".log"));logs.put(kind,Map.of("source",source,"maxBytes",1_048_576));}
            catch(IOException error){logs.put(kind,error.toString());}
        }
        mapper.writeValue(folder.resolve("logs.json").toFile(),logs);
        try(var manifest=BugReport.class.getResourceAsStream("/translation/manifest.json")) {
            if(manifest!=null)Files.copy(manifest,folder.resolve("translation-manifest.json"));
        }
        Files.writeString(folder.resolve("README.txt"),"F1 diagnostic snapshot\n"
            +"original.png: unmodified captured window/input pixels, before crop and normalization (if available).\n"
            +"normalized.png: normalized game image used for layout/OCR (if available).\n"
            +"recognition.json: OCR regions, translation results and actually displayed panels at keypress.\n"
            +"context.json: settings, frame/session IDs, mapping, stability, errors and runtime information.\n"
            +"matching.txt: translation matching explanation. threads.txt: background thread stacks at save time.\n"
            +"stdout/stderr.log: last 1 MiB of this process's redirected logs, when configured.\n"
            +"Metrics and thread stacks are collected after the keypress; frame data is the published UI snapshot.\n"
            +"Pending regions are preserved as pending; saving does not run OCR again.\n",StandardCharsets.UTF_8);
        Files.delete(folder.resolve("INCOMPLETE.txt"));return folder;
    }
    private static List<Integer> size(BufferedImage image) {return image==null?List.of():List.of(image.getWidth(),image.getHeight());}
    private static void writeImage(Path path,BufferedImage image) throws IOException {
        if(!ImageIO.write(image,"png",path.toFile()))throw new IOException("PNG encoder unavailable: "+path);
    }
    private static Map<String,Object> runtime() {
        var values=new LinkedHashMap<String,Object>();
        for(String key:List.of("java.version","java.vendor","java.home","os.name","os.version","os.arch","user.dir","rsocr.capture.dll"))values.put(key,System.getProperty(key,""));
        values.put("pid",ProcessHandle.current().pid());values.put("uptimeMs",ManagementFactory.getRuntimeMXBean().getUptime());
        values.put("processors",Runtime.getRuntime().availableProcessors());
        values.put("memory",Map.of("free",Runtime.getRuntime().freeMemory(),"total",Runtime.getRuntime().totalMemory(),"max",Runtime.getRuntime().maxMemory()));
        values.put("application",BugReport.class.getProtectionDomain().getCodeSource().getLocation().toString());
        return values;
    }
    private static String threads() {
        var text=new StringBuilder();
        Thread.getAllStackTraces().entrySet().stream().sorted(Comparator.comparing(e->e.getKey().getName())).forEach(e->{
            text.append(e.getKey().getName()).append(" ").append(e.getKey().getState()).append('\n');
            for(var frame:e.getValue())text.append("    at ").append(frame).append('\n');text.append('\n');
        });return text.toString();
    }
    private static void copyTail(Path source,Path target) throws IOException {
        try(var input=java.nio.channels.FileChannel.open(source,StandardOpenOption.READ)) {
            input.position(Math.max(0,input.size()-1_048_576));
            Files.write(target,java.nio.channels.Channels.newInputStream(input).readNBytes(1_048_576));
        }
    }
    public static String stackTrace(Throwable error) {
        var text=new StringWriter();error.printStackTrace(new PrintWriter(text));return text.toString();
    }
}
