package io.github.rsocr.desktop;

import io.github.rsocr.OcrEngine;
import java.awt.image.BufferedImage;
import java.nio.file.Path;
import java.util.List;

/** UI-independent lifecycle: a new image invalidates all old geometry and text. */
public final class ImageSession {
    public enum Phase { IDLE, LOADING, RECOGNIZING, READY, STOPPED, FAILED }
    public record View(long generation,Phase phase,Path source,BufferedImage image,List<OcrEngine.Region> regions,String message,double elapsedMs) {}
    private View view=new View(0,Phase.IDLE,null,null,List.of(),"打开实机截图，查看原始日文",0);
    public synchronized View view() { return view; }
    public synchronized long begin(Path source) {
        view=new View(view.generation()+1,Phase.LOADING,source,null,List.of(),"正在读取图片…",0);return view.generation();
    }
    public synchronized boolean imageReady(long generation,BufferedImage image) {
        if(generation!=view.generation() || view.phase()!=Phase.LOADING)return false;
        view=new View(generation,Phase.RECOGNIZING,view.source(),image,List.of(),"识别中…",0);return true;
    }
    public synchronized boolean complete(long generation,List<OcrEngine.Region> regions,double elapsedMs) {
        if(generation!=view.generation() || view.phase()!=Phase.RECOGNIZING)return false;
        view=new View(generation,Phase.READY,view.source(),view.image(),List.copyOf(regions),regions.isEmpty()?"当前图片没有范围内的文字区域":"识别完成",elapsedMs);return true;
    }
    public synchronized boolean fail(long generation,String message) {
        if(generation!=view.generation() || (view.phase()!=Phase.LOADING && view.phase()!=Phase.RECOGNIZING))return false;
        view=new View(generation,Phase.FAILED,view.source(),null,List.of(),message,0);return true;
    }
    public synchronized void stop() { view=new View(view.generation()+1,Phase.STOPPED,null,null,List.of(),"已停止，结果已清除",0); }
}
