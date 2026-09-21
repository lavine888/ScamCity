package com.baytech.scamcity.bridge;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Random;

/** Dependency-free regression checks, executed by Gradle check. */
public final class BridgeLifecycleTest {
    private static void check(boolean value, String message) {
        if (!value) throw new AssertionError(message);
    }

    private static List<String> drain(SceneQueue queue) {
        List<String> result = new ArrayList<>();
        String command;
        while ((command = queue.poll()) != null) result.add(command);
        return result;
    }

    /** One command per slot keeps the expected command streams readable. */
    private static Scene scene(Map<String, String> slotLabels, String trailing) {
        Scene.Builder builder = Scene.builder();
        for (Map.Entry<String, String> entry : slotLabels.entrySet()) {
            builder.slot(entry.getKey(), List.of("summon " + entry.getKey() + " " + entry.getValue()));
        }
        builder.trailing("title " + trailing);
        return builder.build();
    }

    private static Map<String, String> slots(String... pairs) {
        Map<String, String> map = new LinkedHashMap<>();
        for (int i = 0; i < pairs.length; i += 2) map.put(pairs[i], pairs[i + 1]);
        return map;
    }

    private static final String KILL_ALL = "kill @e[tag=scamcity]";

    public static void main(String[] args) {
        Object world = new Object(), network = new Object();
        RequestEpoch requests = new RequestEpoch();
        check(requests.bind(world, network), "first world bind");
        check(!requests.bind(world, network), "same world must preserve request");
        long old = requests.begin();
        requests.invalidate();
        long current = requests.begin();
        check(!requests.finish(old, world, network), "invalidated response rejected");
        check(requests.busy(), "old response cannot unlock new request");
        check(requests.finish(current, world, network), "current response accepted");
        old = requests.begin();
        check(!requests.finish(old, new Object(), network), "world change rejected before tick");
        check(requests.bind(null, null), "disconnect invalidates");
        check(!requests.busy(), "disconnect releases busy state");
        check(!requests.finish(old, world, network), "disconnected response rejected");

        // --- Scene diffing (acceptance matrix A-12) ---
        // A frame is addressed by slot, so an unchanged slot must emit nothing.
        Scene a = scene(slots("t1", "A", "t2", "A"), "A");
        Scene b = scene(slots("t1", "A", "t2", "B"), "B");
        check(a.fullSync().equals(List.of(KILL_ALL, "summon t1 A", "summon t2 A", "title A")),
                "full sync rebuilds every slot behind one sweep");
        check(a.deltaFrom(null).equals(a.fullSync()), "unknown rendered state falls back to full sync");
        check(a.deltaFrom(a).isEmpty(), "an identical frame emits nothing");
        check(b.deltaFrom(a).equals(List.of("kill @e[tag=t2]", "summon t2 B", "title B")),
                "only the changed slot is replaced");

        Scene trailingOnly = scene(slots("t1", "A", "t2", "A"), "C");
        check(trailingOnly.deltaFrom(a).equals(List.of("title C")),
                "a metric-only change touches no entity");

        Scene shrunk = scene(slots("t1", "A"), "A");
        check(shrunk.deltaFrom(a).equals(List.of("kill @e[tag=t2]", "title A")),
                "a removed slot is killed so no marker is left behind");
        Scene grown = scene(slots("t1", "A", "t2", "A", "t3", "A"), "A");
        check(grown.deltaFrom(a).equals(List.of("summon t3 A", "title A")),
                "a new slot is summoned without a redundant kill");

        // The flicker claim, stated as a number: one citizen changing status in a
        // full 100-cell city costs three commands, not a teardown of all 100.
        Map<String, String> city = new LinkedHashMap<>();
        for (int cell = 0; cell < 100; cell++) city.put("sc_c" + cell, "safe");
        Scene calmCity = scene(city, "0 victims");
        check(calmCity.fullSync().size() == 102, "full city sync is one sweep, 100 markers and one metric line");
        Map<String, String> hitCity = new LinkedHashMap<>(city);
        hitCity.put("sc_c42", "victim");
        Scene struckCity = scene(hitCity, "1 victims");
        check(struckCity.deltaFrom(calmCity).equals(
                        List.of("kill @e[tag=sc_c42]", "summon sc_c42 victim", "title 1 victims")),
                "one status change costs three commands");

        Scene reordered = Scene.builder()
                .slot("t2", List.of("summon t2 A"))
                .slot("t1", List.of("summon t1 A"))
                .trailing("title A")
                .build();
        check(reordered.equals(a), "frame identity is the set of slots, not the order they were built in");
        check(reordered.deltaFrom(a).isEmpty(), "a reordered but otherwise identical payload redraws nothing");
        Scene duplicateTag = Scene.builder()
                .slot("t1", List.of("summon t1 A"))
                .slot("t1", List.of("summon t1 SECOND"))
                .trailing("title A")
                .build();
        check(duplicateTag.slotCount() == 1, "one tag maps to exactly one set of entities");
        check(Scene.builder().slot("", List.of("x")).slot("t1", List.of()).build().slotCount() == 0,
                "blank tags and empty slots are rejected");

        // --- Queue: coalescing plus diffing ---
        SceneQueue queue = new SceneQueue();
        check(!queue.hasRenderedState(), "a fresh queue knows nothing is on screen");
        queue.submit(a, false);
        check(queue.poll().equals(KILL_ALL), "first frame starts with a sweep");
        check(drain(queue).equals(List.of("summon t1 A", "summon t2 A", "title A")), "first frame completes");
        check(queue.hasRenderedState(), "a drained frame becomes the delta base");
        queue.submit(a, false);
        check(drain(queue).isEmpty(), "unchanged automatic scene skipped");
        queue.submit(b, false);
        check(drain(queue).equals(List.of("kill @e[tag=t2]", "summon t2 B", "title B")),
                "queue sends only the delta");
        queue.submit(b, true);
        check(drain(queue).equals(b.fullSync()), "a manual redraw cannot trust the rendered state");

        // A partially drained frame must never become a delta base: mid-batch the
        // screen sits between two frames.
        queue.reset(false);
        check(!queue.hasRenderedState(), "reset drops the delta base");
        queue.submit(a, false);
        queue.poll();
        queue.submit(b, false);
        List<String> afterInterrupt = drain(queue);
        check(afterInterrupt.equals(List.of("summon t1 A", "summon t2 A", "title A",
                        "kill @e[tag=t2]", "summon t2 B", "title B")),
                "active frame finishes before the newer frame diffs against it");

        Scene c = scene(slots("t1", "C", "t2", "C"), "C");
        queue.reset(false);
        queue.submit(a, false);
        queue.poll();
        queue.submit(b, false);
        queue.submit(c, false);
        check(drain(queue).equals(List.of("summon t1 A", "summon t2 A", "title A",
                        "kill @e[tag=t1]", "summon t1 C", "kill @e[tag=t2]", "summon t2 C", "title C")),
                "finish active, coalesce latest, then diff once");

        queue.reset(false);
        queue.submit(a, false);
        queue.poll();
        queue.submit(a, true);
        queue.submit(a, false);
        check(drain(queue).equals(List.of("summon t1 A", "summon t2 A", "title A",
                        KILL_ALL, "summon t1 A", "summon t2 A", "title A")),
                "auto does not cancel manual redraw");

        queue.submit(b, false);
        queue.reset(true);
        check(drain(queue).equals(List.of(KILL_ALL)), "clear drops queued and pending scenes");

        // A send failure resets the queue, so the retry must be a full sync
        // rather than a delta against a frame that never finished rendering.
        queue.reset(false);
        queue.submit(c, false);
        queue.poll();
        queue.reset(false);
        queue.submit(c, false);
        check(drain(queue).equals(c.fullSync()), "failed send retries a full scene");

        // Stable citizen projection (acceptance matrix A-13). Placement must
        // depend on the SET of citizen ids only, so a status change or a
        // reordered payload never moves a marker to a different block.
        List<String> roster = new ArrayList<>();
        for (int i = 1; i <= 100; i++) roster.add(String.format(Locale.ROOT, "citizen-%03d", i));
        Map<String, Integer> layout = CitizenGrid.place(roster);
        check(layout.size() == 100, "full roster is fully placed");
        check(new HashSet<>(layout.values()).size() == 100, "no two citizens share a cell");
        check(layout.values().stream().allMatch(cell -> cell >= 0 && cell < CitizenGrid.CELLS), "cells stay inside the grid");

        List<String> shuffled = new ArrayList<>(roster);
        Collections.shuffle(shuffled, new Random(20260919L));
        check(CitizenGrid.place(shuffled).equals(layout), "placement ignores payload order");

        List<String> reversed = new ArrayList<>(roster);
        Collections.reverse(reversed);
        check(CitizenGrid.place(reversed).equals(layout), "placement ignores payload reversal");

        List<String> duplicated = new ArrayList<>(roster);
        duplicated.addAll(roster);
        check(CitizenGrid.place(duplicated).equals(layout), "duplicate ids collapse to one cell");

        List<String> overflow = new ArrayList<>(roster);
        for (int i = 101; i <= 140; i++) overflow.add(String.format(Locale.ROOT, "citizen-%03d", i));
        Map<String, Integer> capped = CitizenGrid.place(overflow);
        check(capped.size() == CitizenGrid.CELLS, "grid capacity is enforced");
        check(new HashSet<>(capped.values()).size() == CitizenGrid.CELLS, "capacity overflow never overlaps a cell");

        Map<String, Integer> unicode = CitizenGrid.place(List.of("\u5e02\u6c11-001", "\u5e02\u6c11-002", "citizen-001"));
        check(unicode.size() == 3, "non-ascii ids are placed");
        check(new HashSet<>(unicode.values()).size() == 3, "non-ascii ids get distinct cells");

        endpointChecks();
        hudChecks();

        System.out.println("PASS: request lifecycle, scene diffing, scene queue, citizen grid, "
                + "endpoint resolution and HUD regressions");
    }

    /**
     * Endpoint resolution. The failure being guarded against: Minecraft's own
     * "Open to LAN" server occupied port 3000, the bridge connected to it, and
     * the resulting error was indistinguishable from an unrelated HTTP/2 bug.
     */
    private static void endpointChecks() {
        // An explicit setting is returned alone. Silently succeeding on a
        // different port would hide the operator's mistake.
        check(ApiEndpoints.candidates("http://localhost:51662/api/simulation", "{\"url\":\"http://localhost:9/api/simulation\"}")
                        .equals(List.of("http://localhost:51662/api/simulation")),
                "an explicit endpoint suppresses discovery and the default");
        // A bare origin is completed, so both forms can be configured.
        check(ApiEndpoints.candidates("http://localhost:51662", "")
                        .equals(List.of("http://localhost:51662/api/simulation")),
                "a bare origin is completed with the API path");
        check(ApiEndpoints.candidates("http://localhost:51662/", "")
                        .equals(List.of("http://localhost:51662/api/simulation")),
                "a trailing slash does not produce a doubled path");

        // With nothing configured, the discovered port is tried before the
        // default, because the default is the port Minecraft tends to steal.
        check(ApiEndpoints.candidates(null, "{\"url\":\"http://localhost:51662/api/simulation\"}")
                        .equals(List.of("http://localhost:51662/api/simulation", ApiEndpoints.DEFAULT_URL)),
                "a discovered endpoint outranks the default");
        check(ApiEndpoints.candidates(null, "").equals(List.of(ApiEndpoints.DEFAULT_URL)),
                "no configuration and no discovery falls back to the default");
        check(ApiEndpoints.candidates("", "   ").equals(List.of(ApiEndpoints.DEFAULT_URL)),
                "blank configuration is not mistaken for a setting");
        check(ApiEndpoints.candidates(null, "{\"url\":\"" + ApiEndpoints.DEFAULT_URL + "\"}")
                        .equals(List.of(ApiEndpoints.DEFAULT_URL)),
                "discovering the default does not duplicate it");

        // The discovery file lives in a shared temp directory, so it is
        // untrusted input: it must not be able to redirect the bridge off-box.
        check(ApiEndpoints.candidates(null, "{\"url\":\"http://evil.example.com/api/simulation\"}")
                        .equals(List.of(ApiEndpoints.DEFAULT_URL)),
                "a remote host in the discovery file is refused");
        check(!ApiEndpoints.isLoopbackHttp("https://localhost/api"), "only plaintext http is accepted");
        check(!ApiEndpoints.isLoopbackHttp("http://localhost.evil.com/api"), "a host suffix is not loopback");
        check(!ApiEndpoints.isLoopbackHttp("http://localhost@evil.com/api"), "credentials in the authority are refused");
        check(!ApiEndpoints.isLoopbackHttp("http://127.0.0.1:notaport/api"), "a non-numeric port is refused");
        check(ApiEndpoints.isLoopbackHttp("http://127.0.0.1:51662/api/simulation"), "loopback ipv4 accepted");
        check(ApiEndpoints.isLoopbackHttp("http://[::1]:51662/api/simulation"), "loopback ipv6 accepted");
        check(ApiEndpoints.candidates(null, "not json at all").equals(List.of(ApiEndpoints.DEFAULT_URL)),
                "a corrupt discovery file degrades to the default");

        // Reaching a listener is not evidence of reaching ScamCity. This check
        // is what turns "port 3000 answered" into a one-line diagnosis.
        check(ApiEndpoints.looksLikeSnapshot("{\"schemaVersion\":\"" + ApiEndpoints.SCHEMA_VERSION + "\"}"),
                "a real snapshot is recognised");
        check(!ApiEndpoints.looksLikeSnapshot("{\"ok\":true}"), "an unrelated JSON service is rejected");
        check(!ApiEndpoints.looksLikeSnapshot(""), "an empty body is rejected");
        check(!ApiEndpoints.looksLikeSnapshot(null), "a missing body is rejected");
        check(ApiEndpoints.wrongServiceMessage("http://localhost:3000/api/simulation")
                        .contains(ApiEndpoints.SCHEMA_VERSION),
                "the wrong-service message names the missing field");
    }

    /**
     * Screen overlay. It carries the comparison verdict, which previously had no
     * in-game presence at all, so the assertions focus on provenance: the demo
     * fallback must never read as live, and a verdict must not appear without
     * its disclaimer.
     */
    private static void hudChecks() {
        HudState waiting = HudState.of(false, false, false, 0, 0, 0, "HK$0", "", "", false, null);
        check(waiting.visible(), "the overlay is shown before the first sync");
        check(waiting.lines().get(0).text().contains("待同步"),
                "an unsynced overlay says so rather than showing a stale zero");

        HudState live = HudState.of(true, true, true, 100, 3, 7, "HK$12,345", "", "", false, null);
        check(live.lines().get(0).text().contains("LIVE"), "live data is labelled LIVE");
        check(live.lines().get(0).color() == HudState.COLOR_LIVE, "live uses the live colour");
        check(live.lines().get(1).color() == HudState.COLOR_ALERT, "a non-zero victim count is alert-coloured");

        HudState demo = HudState.of(true, true, false, 100, 3, 0, "HK$0", "", "", false, null);
        check(demo.lines().get(0).text().contains("DEMO"), "offline data is labelled DEMO");
        check(!demo.lines().get(0).text().contains("LIVE"), "the demo fallback must never read as live");
        check(demo.lines().get(1).color() == HudState.COLOR_TEXT, "zero victims is not alert-coloured");

        // A ranked "best" from a single seed is not a general claim, so the
        // disclaimer travels with it.
        HudState verdict = HudState.of(true, true, true, 100, 3, 7, "HK$12,345",
                "社交守护者", "损失较 baseline 变化 HK$4,000", true, null);
        check(verdict.lines().stream().anyMatch(line -> line.text().contains("社交守护者")),
                "the verdict label reaches the overlay");
        check(verdict.lines().stream().anyMatch(line -> line.text().contains("synthetic")),
                "a verdict always carries its synthetic disclaimer");
        HudState unqualified = HudState.of(true, true, true, 100, 3, 7, "HK$12,345",
                "社交守护者", "理由", false, null);
        check(unqualified.lines().stream().noneMatch(line -> line.text().contains("synthetic")),
                "provenance is not invented when the payload carries none");
        check(HudState.of(true, true, true, 1, 0, 0, "HK$0", "", "", false, null).lines().stream()
                        .noneMatch(line -> line.text().contains("最佳策略")),
                "no verdict row before a comparison has run");

        HudState failed = HudState.of(false, true, false, 0, 0, 0, "HK$0", "", "",
                false, "端口有服务但不是 ScamCity");
        HudState.Line last = failed.lines().get(failed.lines().size() - 1);
        check(last.color() == HudState.COLOR_ALERT, "an error is surfaced in the alert colour");

        // Verdict reasons are written for a web card and run long; the panel is
        // sized from the text, so an unbounded line would run off screen.
        HudState longReason = HudState.of(true, true, true, 100, 3, 7, "HK$1",
                "x".repeat(120), "y".repeat(400), true, null);
        check(longReason.widestLine() <= 60, "long verdict text is clipped to the panel budget");
        check(longReason.lines().stream().anyMatch(line -> line.text().endsWith("…")),
                "clipping is visible rather than silent");

        check(!HudState.EMPTY.visible(), "the empty overlay draws nothing");
        check(HudState.money(0).equals("HK$0"), "zero loss reads as HK$0");
        check(HudState.money(1234567).equals("HK$1,234,567"), "amounts are thousands-separated");
        check(HudState.money(-5).equals("HK$0"), "a negative amount is not rendered as a loss");
    }
}
