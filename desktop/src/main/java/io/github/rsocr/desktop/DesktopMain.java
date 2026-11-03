package io.github.rsocr.desktop;

/** A regular launcher keeps the JavaFX application separate from the offline CLI. */
public final class DesktopMain {
    public static void main(String[] args) {
        // Native libraries need a writable cache even when user.home is unavailable.
        if(System.getProperty("javafx.cachedir")==null)System.setProperty("javafx.cachedir",java.nio.file.Path.of(System.getProperty("java.io.tmpdir"),"rs-ocr-javafx-cache").toString());
        javafx.application.Application.launch(DesktopApplication.class,args);
    }
}
