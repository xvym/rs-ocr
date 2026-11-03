package io.github.rsocr.desktop;

import io.github.rsocr.Normalizer;
import javafx.geometry.Insets;
import javafx.scene.canvas.Canvas;
import javafx.scene.control.*;
import javafx.scene.image.ImageView;
import javafx.scene.layout.*;
import javafx.scene.paint.Color;
import javafx.stage.Window;
import java.awt.image.BufferedImage;

/** The user selects pixels inside the captured window, never desktop coordinates. */
public final class CalibrationDialog extends Dialog<Normalizer.Viewport> {
    private final TextField left=new TextField(),top=new TextField(),width=new TextField(),height=new TextField();
    private final Canvas overlay;private final BufferedImage image;private final double scale;
    private final ButtonType accept=new ButtonType("使用此区域",ButtonBar.ButtonData.OK_DONE);
    private double anchorX,anchorY;
    public CalibrationDialog(Window owner,BufferedImage image,Normalizer.Viewport initial) {
        this.image=image;initOwner(owner);setTitle("校准游戏区域");setHeaderText("拖动框选整个游戏画面，包含边框；不要包含投屏软件或 OBS 的工具栏。");
        scale=Math.min(1,Math.min(1000.0/image.getWidth(),560.0/image.getHeight()));
        var preview=new ImageView(ResultCanvas.image(image));preview.setFitWidth(image.getWidth()*scale);preview.setFitHeight(image.getHeight()*scale);preview.setSmooth(false);
        overlay=new Canvas(image.getWidth()*scale,image.getHeight()*scale);var stack=new StackPane(preview,overlay);
        overlay.setOnMousePressed(e->{anchorX=e.getX()/scale;anchorY=e.getY()/scale;});
        overlay.setOnMouseDragged(e->{double x=Math.max(0,Math.min(image.getWidth(),e.getX()/scale)),y=Math.max(0,Math.min(image.getHeight(),e.getY()/scale));
            values((int)Math.min(anchorX,x),(int)Math.min(anchorY,y),(int)Math.abs(x-anchorX),(int)Math.abs(y-anchorY));});
        var numbers=new HBox(8,new Label("左"),left,new Label("上"),top,new Label("宽"),width,new Label("高"),height);
        for(var field:new TextField[]{left,top,width,height}){field.setPrefColumnCount(5);field.textProperty().addListener((o,a,b)->draw());}
        var body=new VBox(12,stack,numbers,new Label("可微调数值。NGC 的颜色配置请在主窗口选择“NGC／OBS 采集”。"));body.setPadding(new Insets(12));
        getDialogPane().setContent(body);getDialogPane().getButtonTypes().setAll(accept,ButtonType.CANCEL);
        setResultConverter(button->button==accept?value():null);
        if(initial==null)values(0,0,image.getWidth(),image.getHeight());else values((int)initial.x(),(int)initial.y(),(int)initial.width(),(int)initial.height());
    }
    private void values(int x,int y,int w,int h) {left.setText(""+x);top.setText(""+y);width.setText(""+w);height.setText(""+h);draw();}
    private Normalizer.Viewport value() {
        try {var v=new Normalizer.Viewport(Integer.parseInt(left.getText()),Integer.parseInt(top.getText()),Integer.parseInt(width.getText()),Integer.parseInt(height.getText()));
            return v.x()+v.width()<=image.getWidth() && v.y()+v.height()<=image.getHeight()?v:null;
        }catch(IllegalArgumentException e){return null;}
    }
    private void draw() {
        var v=value();var g=overlay.getGraphicsContext2D();g.clearRect(0,0,overlay.getWidth(),overlay.getHeight());
        var button=getDialogPane().lookupButton(accept);if(button!=null)button.setDisable(v==null);
        if(v!=null){g.setStroke(Color.web("#29a5ff"));g.setLineWidth(2);g.strokeRect(v.x()*scale,v.y()*scale,v.width()*scale,v.height()*scale);}
    }
}
