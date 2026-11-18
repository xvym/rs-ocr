package io.github.rsocr.desktop.translation;

import io.github.rsocr.desktop.Presentation.Panel;
import java.util.*;

/** Human-readable explanations of existing lookup results, without translating again. */
public final class TranslationDiagnostics {
    private record Explanation(String reason,String action) {}
    private static Explanation explanation(String reason) {
        return switch(Objects.toString(reason,"")) {
            case "outside_first_edition" -> new Explanation("当前窗口类型尚未纳入中文翻译范围。","需要补充该窗口的翻译支持；继续查中文候选不会让当前窗口自动启用。");
            case "invalid_or_unknown_input" -> new Explanation("识别文本含未知字符或无法用于匹配的控制符，或查找文本无效。","先对照原图核对日文，尤其是“�”；如原文无误，再检查文本拆分。");
            case "no_reviewed_visible_window" -> new Explanation("当前窗口和日文未命中可输出的窗口规则、变量模板或完整词条。","先核对下面的识别原文和实际查找文本；若均正确，需要补充对应规则。本结果不能说明原汉化资料没有中文。");
            case "current_variable_binding_not_verified" -> new Explanation("已登记变量模板，但当前文本未能完成匹配、变量校验或规则族校验。","核对句子是否显示完整，以及姓名、招式、数值和换行是否识别正确；原文正确时需检查模板绑定。");
            case "required_variable_not_yet_visible" -> new Explanation("译文所需的变量尚未出现在当前可见文本中。","等待文字显示完整；不要用其他画面的值补齐。");
            case "incomplete_visible_semantic_unit" -> new Explanation("当前可见文本不足以对应已登记的完整语义单元。","等待文字显示完整；若画面本就只显示这一段，需要补充该可见片段的对应规则。");
            case "original_rsc_context_required" -> new Explanation("找到词条，但现有中文结果不唯一，或仍含未处理的控制符。","核对游戏版本和字段类别，再检查该词条的原中文候选及打印规则。");
            case "original_source_record_conflict" -> new Explanation("已命中完整原文，但有多个不同的适用原译文。","核对当前游戏和同一画面的名称等字段；无法唯一确定时继续保留日文。");
            case "original_source_game_missing" -> new Explanation("完整原文已登记，但未指定游戏时缺少两作一致的对应。","请选择当前实际使用的红宝石或蓝宝石版本。");
            case "original_game_or_wording_conflict" -> new Explanation("当前游戏版本缺少一致的原译文引用，或引用存在措辞冲突。","确认红宝石／蓝宝石选择是否正确；版本正确时需核对引用来源。");
            case "original_semantic_output_conflict" -> new Explanation("语义单元已有登记，但当前游戏下未取得唯一的原中文结果。","核对游戏版本；若仍失败，需要检查该语义单元的中文引用。");
            case "semantic_unit_source_conflict" -> new Explanation("窗口规则指定的语义单元与当前命中的计划不一致。","需要检查窗口规则与语义单元的关联，不能直接选择任一译文。");
            case "binding_search_incomplete" -> new Explanation("变量模板匹配达到搜索上限，未完成可靠判断。","先检查日文和文本拆分；原文正确时需缩小或完善模板约束。");
            case "incomplete_or_unmapped_source" -> new Explanation("当前文本的原汉化来源或可见范围对应尚未完整确认。","需要补充日文到原中文来源的关联；仅有中文候选还不能直接输出。");
            case "native_title_correspondence_unverified" -> new Explanation("该原生标题的日中对应尚未确认。","需要补充标题对应规则。");
            case "invariant_raw_label" -> new Explanation("这是按规则保留原样的固定标签。","无需处理；保留原文是预期行为。");
            default -> new Explanation("当前规则保留原文，尚未提供该原因的中文说明。","复制本说明中的原文、窗口和原因代码进行核对。");
        };
    }
    public static String describe(TranslationSession.Frame frame,List<Panel> panels,TranslationEngine engine) {
        if(frame==null)return "等待识别结果。识别完成后，这里会列出保留原文的原因。";
        if(frame.regions().isEmpty())return "当前画面未检测到可翻译文字区域。请先核对原图和游戏区域校准。";
        long translated=frame.regions().stream().flatMap(r->r.units().stream()).filter(TranslationEngine.Result::translated).count();
        long retained=frame.regions().stream().flatMap(r->r.units().stream()).filter(r->!r.translated()).count();
        String game=switch(frame.game()){case "ruby"->"红宝石";case "sapphire"->"蓝宝石";default->"未指定（同时检查两作）";};
        var text=new StringBuilder("游戏：").append(game).append("\n已匹配输出：").append(translated).append(" 项；保留原文：").append(retained).append(" 项\n");
        for(var region:frame.regions()) {
            var panel=panels.stream().filter(p->(region.key().equals(p.key())||region.key().startsWith(p.key()+"|"))&&region.raw().equals(p.raw())).findFirst().orElse(null);
            String heading=panel==null?region.key():panel.name()+"（"+region.key()+"）";
            if(region.units().isEmpty()) {
                text.append("\n区域：").append(heading).append("\n");
                text.append(panel!=null&&panel.status().equals("pending")?"等待文字稳定并完成识别。\n":"尚无可用于翻译的日文，请先核对识别结果。\n");
            }
            int index=0;
            for(var result:region.units()) {
                index++;
                if(result.translated()) {
                    if(panel!=null&&panel.translations().stream().noneMatch(b->b.text().equals(result.chinese())))
                        text.append("\n区域：").append(heading).append("\n已匹配中文，但未生成对应显示文本块，请检查文字位置映射。\n识别原文：").append(result.unit().raw()).append("\n中文结果：").append(result.chinese()).append("\n");
                    continue;
                }
                var explanation=explanation(result.reason());
                text.append("\n区域：").append(heading).append(" · 第 ").append(index).append(" 项\n原因：").append(explanation.reason()).append("\n识别原文：").append(result.unit().raw())
                    .append("\n实际查找：").append(result.unit().searchText()).append("\n字段类别：").append(Objects.toString(result.unit().kind(),"未限定"))
                    .append("\n下一步：").append(explanation.action()).append("\n");
                for(var hint:engine.diagnosticHints(result,region.key().split("\\|",2)[0],frame.game()))text.append("核对线索：").append(hint).append("\n");
                if(result.ruleId()!=null)text.append("规则编号：").append(result.ruleId()).append("\n");
                text.append("原因代码：").append(result.reason()).append("\n");
            }
        }
        if(retained==0&&translated>0)text.append("\n本次所有文本单元均已匹配输出；若画面显示异常，请核对原图和结果区。\n");
        return text.toString();
    }
}
