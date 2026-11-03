package io.github.rsocr.desktop.capture;

import java.awt.image.BufferedImage;
import java.awt.image.DataBufferInt;
import java.awt.image.DirectColorModel;
import java.awt.image.Raster;
import java.nio.file.Path;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.ArrayList;
import java.util.List;

/** JNI/WGC ownership is confined to one worker thread; no desktop capture fallback. */
public final class WindowCapture implements AutoCloseable {
    public enum Status { WAITING, RUNNING, MINIMIZED, CLOSED, ERROR }
    public record Window(long hwnd, int pid, String title) {
        @Override public String toString() { return title + " [PID " + pid + "]"; }
    }
    /** Client rectangles are geometric hypotheses until image evidence confirms them. */
    public record Bounds(int x, int y, int width, int height) {}
    public record Poll(Status status, String detail, long revision, long frameId, long frameArrivalNanos,
                       long sampleTimeNanos, long javaSampleTimeNanos, BufferedImage image, List<Bounds> clientHints, int dpi) {}
    private record NativeSnapshot(int status, String detail, long revision, long frameId, long frameArrivalNanos,
                                  long sampleTimeNanos, int width, int height, int[] pixels, int[] clientHints, int dpi) {}

    // Lazy loading lets the existing offline CLI run without a capture DLL.
    private static final class Library {
        static {
            try {
                String configured=System.getProperty("rsocr.capture.dll");
                if(configured!=null)System.load(Path.of(configured).toAbsolutePath().toString());
                else try(var in=WindowCapture.class.getResourceAsStream("/native/windows-x64/rscapture.dll")) {
                    if(in==null)throw new IllegalStateException("缺少实时捕获组件，请先构建捕获组件和桌面程序。");
                    byte[] bytes=in.readAllBytes();String hash=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
                    Path dir=Path.of(System.getProperty("java.io.tmpdir"),"rs-ocr-capture",hash);Files.createDirectories(dir);
                    Path dll=dir.resolve("rscapture.dll");
                    if(!Files.exists(dll)) {
                        Path temp=Files.createTempFile(dir,"rscapture-",".tmp");
                        try {Files.write(temp,bytes);try{Files.move(temp,dll);}catch(java.nio.file.FileAlreadyExistsException concurrent){}}
                        finally{Files.deleteIfExists(temp);}
                    }
                    if(!MessageDigest.isEqual(bytes,Files.readAllBytes(dll)))throw new IllegalStateException("捕获组件缓存不一致。");
                    System.load(dll.toAbsolutePath().toString());
                }
            } catch(Exception e) {throw new ExceptionInInitializerError(e);}
        }
        static void load() {}
    }

    private long handle;
    private long revision = -1;
    private long frameId = -1;
    private BufferedImage image;

    public static List<Window> windows() { Library.load(); return List.of(windows0()); }

    public WindowCapture(Window window) {
        Library.load();
        handle = open0(window.hwnd(), window.pid());
    }

    public Poll poll() {
        NativeSnapshot snapshot = poll0(handle, revision, frameId);
        long javaSampled=System.nanoTime();
        Status status = Status.values()[snapshot.status()];
        if (snapshot.revision() != revision || status != Status.RUNNING) image = null;
        if (snapshot.pixels() != null) {
            image = fromPixels(snapshot.width(),snapshot.height(),snapshot.pixels());
        }
        revision = snapshot.revision();
        frameId = snapshot.frameId();
        List<Bounds> hints = new ArrayList<>();
        for (int i = 0; i < snapshot.clientHints().length; i += 4) {
            int[] rect = snapshot.clientHints();
            Bounds bounds = new Bounds(rect[i], rect[i + 1], rect[i + 2], rect[i + 3]);
            if (bounds.width() > 0 && bounds.height() > 0 && !hints.contains(bounds)) hints.add(bounds);
        }
        return new Poll(status, snapshot.detail(), revision, frameId, snapshot.frameArrivalNanos(),
                snapshot.sampleTimeNanos(), javaSampled, image, List.copyOf(hints), snapshot.dpi());
    }

    /** NativeSnapshot owns a fresh immutable array; wrapping it avoids a second full-window copy. */
    static BufferedImage fromPixels(int width,int height,int[] pixels) {
        int[] masks={0x00ff0000,0x0000ff00,0x000000ff,0xff000000};
        var raster=Raster.createPackedRaster(new DataBufferInt(pixels,pixels.length),width,height,width,masks,null);
        return new BufferedImage(new DirectColorModel(32,masks[0],masks[1],masks[2],masks[3]),raster,false,null);
    }

    @Override public void close() {
        if (handle != 0) { close0(handle); handle = 0; image = null; }
    }

    private static native Window[] windows0();
    private static native long open0(long hwnd, int pid);
    private static native NativeSnapshot poll0(long handle, long previousRevision, long previousFrameId);
    private static native void close0(long handle);
}
