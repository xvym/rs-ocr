package io.github.rsocr.desktop;

import javafx.scene.control.TextArea;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/** A selectable copy of the text currently drawn on the result board. */
public final class ResultText extends TextArea {
    private record Part(double x,double y,double width,String text) {}

    public ResultText() {
        setEditable(false);setWrapText(true);setPrefRowCount(4);
        setMinHeight(80);setMaxHeight(130);
        setPromptText("识别完成后，可在此选择并复制结果文本");
        setAccessibleText("结果文本（可选中复制）");
        getStyleClass().add("result-text");
    }

    public void show(List<Presentation.Panel> panels) {
        var sections=new ArrayList<String>();
        for(var panel:panels.stream().sorted(Comparator.comparingInt(Presentation.Panel::order)).toList()) {
            if(panel.status().equals("pending"))continue;
            var parts=new ArrayList<Part>();
            for(var run:panel.runs())parts.add(new Part(run.x(),run.y(),run.width(),run.raw()));
            for(var block:panel.translations())parts.add(new Part(block.box().x(),block.box().y(),block.box().width(),block.text()));
            parts.sort(Comparator.comparingDouble(Part::y).thenComparingDouble(Part::x));
            var text=new StringBuilder();Part previous=null;
            for(var part:parts) {
                if(part.text().isEmpty())continue;
                if(previous!=null) {
                    if(part.y()!=previous.y())text.append('\n');
                    else if(part.x()>previous.x()+previous.width()+1)text.append('\t');
                }
                text.append(part.text());previous=part;
            }
            if(!text.isEmpty())sections.add(text.toString());
        }
        String text=String.join("\n\n",sections);
        // Capture and cursor updates must not discard an active text selection.
        if(!text.equals(getText())) {setText(text);positionCaret(0);setScrollTop(0);setScrollLeft(0);}
    }
}
