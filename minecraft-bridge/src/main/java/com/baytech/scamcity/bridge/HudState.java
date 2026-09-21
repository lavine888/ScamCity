package com.baytech.scamcity.bridge;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * What the on-screen overlay should currently say.
 *
 * <p>Why an overlay at all: every other readout in this bridge costs world
 * entities, and the entity budget is the thing under pressure — 100 citizens
 * plus labels already, and humanoid mode multiplies that. The HUD is drawn
 * straight to the framebuffer, so headline numbers and the comparison verdict
 * cost nothing in the world and cannot be walked away from, mined, or pushed out
 * of view. That is what makes it the right surface for the verdict, which
 * previously existed in the API and the web UI but had no in-game presence at
 * all.</p>
 *
 * <p>Concurrency: instances are immutable, so publishing one reference is the
 * whole handoff. The controller builds a new state on the client thread and the
 * renderer reads whichever one it sees; a frame rendered against the previous
 * state is correct, just one tick stale.</p>
 *
 * <p>Dependency-free on purpose: formatting is where an overlay actually goes
 * wrong (stale "LIVE" labels, unlabelled synthetic numbers), so it lives here
 * where the Gradle verification source set can assert on it without Minecraft.</p>
 */
final class HudState {
    /** Colours are ARGB, matching what DrawContext expects. */
    static final int COLOR_LIVE = 0xFF5FC44A;
    static final int COLOR_DEMO = 0xFFE0A93A;
    static final int COLOR_IDLE = 0xFF9AA0A6;
    static final int COLOR_ALERT = 0xFFD03A3A;
    static final int COLOR_TEXT = 0xFFE8EAED;
    static final int COLOR_MUTED = 0xFF9AA0A6;
    static final int COLOR_VERDICT = 0xFF64D2E0;

    static final HudState EMPTY = new HudState(List.of(), false);

    /** A single overlay row. */
    record Line(String text, int color) {
    }

    private final List<Line> lines;
    private final boolean visible;

    private HudState(List<Line> lines, boolean visible) {
        this.lines = lines;
        this.visible = visible;
    }

    List<Line> lines() {
        return lines;
    }

    boolean visible() {
        return visible;
    }

    /**
     * Build the overlay for the current bridge state.
     *
     * @param synced    false before the first snapshot, so the overlay can say
     *                  "waiting" instead of implying a stale zero is real data
     * @param fromApi   distinguishes live data from the offline fallback; the
     *                  demo path must never be presentable as live
     * @param verdict   may be absent — it only exists after a comparison has run
     */
    static HudState of(boolean running, boolean synced, boolean fromApi,
                       int citizens, int scammers, int victims, String money,
                       String verdictLabel, String verdictReason, boolean verdictSynthetic,
                       String error) {
        if (!synced && error == null) {
            return new HudState(List.of(
                    new Line("SCAMCITY  待同步", COLOR_IDLE),
                    new Line("/scamcity refresh 或 /scamcity demo", COLOR_MUTED)
            ), true);
        }

        List<Line> lines = new ArrayList<>(5);
        String source = fromApi ? "LIVE" : "DEMO";
        int sourceColor = fromApi ? COLOR_LIVE : COLOR_DEMO;
        lines.add(new Line("SCAMCITY  " + source + (running ? "  同步中" : "  已暂停"), sourceColor));
        lines.add(new Line("居民 " + citizens + "   骗子 " + scammers
                + "   受害 " + victims, victims > 0 ? COLOR_ALERT : COLOR_TEXT));
        lines.add(new Line("损失 " + money, COLOR_TEXT));

        if (verdictLabel != null && !verdictLabel.isBlank()) {
            lines.add(new Line("最佳策略  " + clip(verdictLabel, 40), COLOR_VERDICT));
            if (verdictReason != null && !verdictReason.isBlank()) {
                lines.add(new Line(clip(verdictReason, 58), COLOR_MUTED));
            }
            // The audit requires every verdict to travel with its disclaimer:
            // a ranked "best" from one seed is not a general claim, and the
            // overlay is the one place a viewer sees the number without the
            // surrounding page to qualify it.
            if (verdictSynthetic) {
                lines.add(new Line("synthetic modeled outcome · 单一 seed", COLOR_MUTED));
            }
        }

        if (error != null && !error.isBlank()) {
            lines.add(new Line(clip(error, 58), COLOR_ALERT));
        }
        return new HudState(List.copyOf(lines), true);
    }

    /**
     * Longest row in characters. This is a text budget, not a pixel width: the
     * renderer measures real glyph advances with the font, because a fixed
     * per-character width is wrong for mixed CJK and ASCII. Used to assert the
     * clipping in {@link #clip} keeps rows to a sane length.
     */
    int widestLine() {
        int widest = 0;
        for (Line line : lines) {
            widest = Math.max(widest, line.text().length());
        }
        return widest;
    }

    /**
     * Truncate on a character budget.
     *
     * <p>Verdict reasons are written for a web card and run long; the overlay
     * gets one line each. Cutting here rather than letting the renderer clip
     * keeps the panel width predictable.</p>
     */
    private static String clip(String value, int budget) {
        String flattened = value.replace('\n', ' ').replace('\r', ' ').trim();
        if (flattened.length() <= budget) {
            return flattened;
        }
        return flattened.substring(0, budget - 1) + "…";
    }

    /** Thousands-separated HK$ amount, matching the in-world header. */
    static String money(double amount) {
        if (amount <= 0) {
            return "HK$0";
        }
        return "HK$" + String.format(Locale.ROOT, "%,d", Math.round(amount));
    }
}
