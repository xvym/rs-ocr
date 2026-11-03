package io.github.rsocr.desktop;

import javafx.scene.canvas.Canvas;
import javafx.scene.canvas.GraphicsContext;
import javafx.scene.image.*;
import javafx.scene.layout.Region;
import javafx.scene.paint.Color;
import javafx.scene.text.Font;
import javafx.scene.text.TextAlignment;
import java.util.List;
import java.util.Objects;

/** Both boards share exactly the same 240x160 letterboxed transform. */
public final class ResultCanvas extends Region {
    private final Canvas canvas=new Canvas();
    private final boolean source;
    private List<Presentation.Panel> panels=List.of();
    private Image image;
    private String message="";
    public ResultCanvas(boolean source) { this.source=source;getChildren().add(canvas);setMinSize(0,0);setPrefSize(720,480); }
    public void show(Image image,List<Presentation.Panel> panels,String message) {
        if(this.image==image && this.panels.equals(panels) && Objects.equals(this.message,message))return;
        this.image=image;this.panels=List.copyOf(panels);this.message=message;draw();
    }
    public List<Presentation.Panel> panels() { return panels; }
    public Presentation.Fit fit() { return Presentation.Fit.inside(getWidth(),getHeight()); }
    @Override protected void layoutChildren() {
        if(canvas.getWidth()==getWidth() && canvas.getHeight()==getHeight())return;
        canvas.setWidth(getWidth());canvas.setHeight(getHeight());draw();
    }
    private void draw() {
        var g=canvas.getGraphicsContext2D();g.setTransform(1,0,0,1,0,0);
        g.setFill(Color.web("#e5ebf3"));g.fillRect(0,0,canvas.getWidth(),canvas.getHeight());
        var fit=fit();if(fit.scale()<=0)return;
        g.translate(fit.x(),fit.y());g.scale(fit.scale(),fit.scale());
        g.setFill(source?Color.web("#111d30"):Color.web("#fafcff"));g.fillRect(0,0,240,160);
        if(source && image!=null) { g.setImageSmoothing(false);g.drawImage(image,0,0,240,160); }
        if(!source)for(var panel:panels)drawPanel(g,panel);
        if((source?image==null:panels.isEmpty()) && !message.isBlank()) {
            g.setFill(source?Color.web("#ccd9ec"):Color.web("#64758d"));g.setFont(Font.font("Microsoft YaHei",5.3));g.setTextAlign(TextAlignment.CENTER);
            g.fillText(message,120,82,210);g.setTextAlign(TextAlignment.LEFT);
        }
    }
    private void drawPanel(GraphicsContext g,Presentation.Panel panel) {
        if(panel.frame()!=null) {
            var b=panel.frame();g.setFill(Color.web("#eef3fc"));g.fillRoundRect(b.x()+.4,b.y()+.4,b.width()-.8,b.height()-.8,2,2);
            g.setStroke(Color.web("#9bacc6"));g.setLineWidth(.55);g.strokeRoundRect(b.x()+.4,b.y()+.4,b.width()-.8,b.height()-.8,2,2);
        }
        for(var selection:panel.selections()) {
            g.setFill(Color.web("#dbe8ff"));g.fillRect(selection.x(),selection.y(),selection.width(),selection.height());
            g.setStroke(Color.web("#3469c6"));g.setLineWidth(.65);g.strokeRect(selection.x(),selection.y(),selection.width(),selection.height());
        }
        g.save();var clip=panel.clip();g.beginPath();g.rect(clip.x(),clip.y(),clip.width(),clip.height());g.clip();
        // Every glyph/label stays at its observed position; gaps preserve columns and values.
        for(var run:panel.runs()) {
            g.save();g.beginPath();g.rect(run.x(),run.y(),run.width(),run.height());g.clip();
            g.setFill(run.unknown()?Color.web("#b42337"):Color.web("#152f52"));
            double size=run.height()>=16?12:Math.min(10,run.height()+.2);
            g.setFont(Font.font("Microsoft YaHei",size));
            g.fillText(run.raw(),run.x(),run.y()+(run.height()>=16?12:run.height()-.6),run.width());g.restore();
        }
        for(var pointer:panel.pointers()) {
            g.setFill(Color.web("#3469c6"));g.fillPolygon(new double[]{pointer.x()+1,pointer.x()+6,pointer.x()+1},new double[]{pointer.y()+3,pointer.y()+8,pointer.y()+13},3);
        }
        if(panel.status().equals("pending")) {g.setFill(Color.web("#64758d"));g.setFont(Font.font("Microsoft YaHei",6));g.fillText("等待文字稳定…",clip.x()+3,clip.y()+10,Math.max(1,clip.width()-6));}
        g.restore();
    }
    public static WritableImage image(java.awt.image.BufferedImage source) {
        if(source==null)return null;
        var result=new WritableImage(source.getWidth(),source.getHeight());
        int[] pixels=source.getRGB(0,0,source.getWidth(),source.getHeight(),null,0,source.getWidth());
        result.getPixelWriter().setPixels(0,0,source.getWidth(),source.getHeight(),PixelFormat.getIntArgbInstance(),pixels,0,source.getWidth());return result;
    }
}
