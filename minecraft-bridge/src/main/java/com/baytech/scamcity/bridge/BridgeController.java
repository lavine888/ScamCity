package com.baytech.scamcity.bridge;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.mojang.brigadier.CommandDispatcher;
import net.fabricmc.fabric.api.client.command.v2.FabricClientCommandSource;
import net.minecraft.client.MinecraftClient;
import net.minecraft.text.Text;
import net.minecraft.util.Formatting;
import net.minecraft.util.math.BlockPos;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.text.NumberFormat;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.CompletableFuture;

import static net.fabricmc.fabric.api.client.command.v2.ClientCommandManager.literal;

/**
 * Owns the HTTP lifecycle and turns a ScamCity snapshot into server commands.
 *
 * <p>The bridge deliberately renders through vanilla {@code block_display},
 * {@code text_display} and {@code armor_stand} entities. That keeps the
 * world-side representation easy to inspect, easy to clean with one tag
 * selector, and independent of private client rendering APIs.</p>
 */
final class BridgeController {
    private static final int POLL_INTERVAL_TICKS = 200;
    private static final int COMMANDS_PER_TICK = 8;
    private static final Set<String> INTERVENTION_STRATEGIES = Set.of(
            "baseline",
            "mass-warning",
            "bank-risk-agent",
            "social-guardian",
            "network-intervention"
    );

    // Pin HTTP/1.1. The JDK default is HTTP/2, which for a plaintext http://
    // target attempts an h2c upgrade; the Next.js dev server drops that
    // connection without replying, surfacing as
    // "HTTP/1.1 header parser received no bytes" with no request ever
    // reaching the server. Verified against the live dev server: HTTP_2 fails,
    // HTTP_1_1 returns 200. Proxy settings were ruled out (selector = DIRECT).
    private final HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(2))
            .version(HttpClient.Version.HTTP_1_1)
            .build();
    private final RequestEpoch requests = new RequestEpoch();
    private final SceneQueue scenes = new SceneQueue();
    /**
     * Endpoints to try, in order. More than one exists because the default port
     * 3000 is regularly taken over by Minecraft's own "Open to LAN" server, and
     * the launcher GUI does not inherit shell environment variables, so
     * {@code SCAMCITY_API} cannot be relied on either. See {@link ApiEndpoints}.
     */
    private final List<String> endpoints = ApiEndpoints.candidates(
            System.getProperty("scamcity.api", System.getenv("SCAMCITY_API")),
            readDiscoveryFile()
    );
    /** Last endpoint that returned a genuine ScamCity snapshot. */
    private String activeEndpoint;

    private boolean running = false;
    private int ticksSinceRefresh = POLL_INTERVAL_TICKS;
    private JsonObject latestSnapshot;
    private String lastError = "";
    private boolean latestFromApi;
    /** Stable world anchor; refreshes must not move the city when the player walks. */
    private BlockPos anchor;
    /**
     * Citizens render as dyed armour stands instead of concrete blocks when set.
     * Off by default: 100 armour stands are heavier than 100 block displays and
     * that cost has not been measured in game yet, so the cheap mode stays the
     * one you fall back to.
     */
    private boolean humanoidFigures = false;
    /**
     * Headline numbers and the comparison verdict, drawn straight to the screen.
     *
     * <p>Volatile because {@link ScamCityHud} reads it while rendering: a frame
     * may be one tick stale, but it must never see a half-built state.</p>
     */
    private volatile HudState hud = HudState.EMPTY;

    /** Current overlay contents. Called by the HUD renderer every frame. */
    HudState hudState() {
        return hud;
    }

    /**
     * Read the endpoint written by {@code scripts/scamcity-serve.mjs}.
     *
     * <p>Absence is the normal case (plain {@code next dev}), so a missing file
     * is not an error. Contents are untrusted — {@link ApiEndpoints} rejects
     * anything that is not a loopback HTTP URL.</p>
     */
    private static String readDiscoveryFile() {
        try {
            Path path = Path.of(System.getProperty("java.io.tmpdir"), ApiEndpoints.DISCOVERY_FILE);
            if (!Files.isRegularFile(path)) {
                return "";
            }
            return Files.readString(path);
        } catch (IOException | RuntimeException ex) {
            ScamCityBridgeClient.LOGGER.debug("No usable ScamCity endpoint file", ex);
            return "";
        }
    }

    void registerCommands(CommandDispatcher<FabricClientCommandSource> dispatcher,
                          net.minecraft.command.CommandRegistryAccess registryAccess) {
        dispatcher.register(literal("scamcity")
                .then(literal("start").executes(context -> {
                    bindWorld(context.getSource().getClient());
                    running = true;
                    ticksSinceRefresh = POLL_INTERVAL_TICKS;
                    refreshHud();
                    say(context.getSource().getClient(), "ScamCity 自动同步已启动", Formatting.AQUA);
                    return 1;
                }))
                .then(literal("stop").executes(context -> {
                    bindWorld(context.getSource().getClient());
                    running = false;
                    requests.invalidate();
                    scenes.reset(true);
                    refreshHud();
                    say(context.getSource().getClient(), "ScamCity 自动同步已停止", Formatting.YELLOW);
                    return 1;
                }))
                .then(literal("refresh").executes(context -> {
                    requestSnapshot(context.getSource().getClient(), true);
                    return 1;
                }))
                .then(literal("intervene")
                        .then(literal("baseline").executes(context -> {
                            postIntervention(context.getSource().getClient(), "baseline");
                            return 1;
                        }))
                        .then(literal("mass-warning").executes(context -> {
                            postIntervention(context.getSource().getClient(), "mass-warning");
                            return 1;
                        }))
                        .then(literal("bank-risk-agent").executes(context -> {
                            postIntervention(context.getSource().getClient(), "bank-risk-agent");
                            return 1;
                        }))
                        .then(literal("social-guardian").executes(context -> {
                            postIntervention(context.getSource().getClient(), "social-guardian");
                            return 1;
                        }))
                        .then(literal("network-intervention").executes(context -> {
                            postIntervention(context.getSource().getClient(), "network-intervention");
                            return 1;
                        })))
                .then(literal("anchor").executes(context -> {
                    MinecraftClient client = context.getSource().getClient();
                    if (client.player != null) {
                        bindWorld(client);
                        requests.invalidate();
                        anchor = client.player.getBlockPos();
                        scenes.reset(true);
                        requestSnapshot(client, true);
                        say(client, "ScamCity 城市中心已锁定在当前位置", Formatting.AQUA);
                    }
                    return 1;
                }))
                .then(literal("demo").executes(context -> {
                    bindWorld(context.getSource().getClient());
                    running = false;
                    requests.invalidate();
                    scenes.reset(false);
                    applySnapshot(context.getSource().getClient(), DemoSnapshot.create("手动离线演示"), false, true);
                    return 1;
                }))
                .then(literal("clear").executes(context -> {
                    bindWorld(context.getSource().getClient());
                    running = false;
                    requests.invalidate();
                    scenes.reset(true);
                    latestSnapshot = null;
                    hud = HudState.EMPTY;
                    say(context.getSource().getClient(), "已清除 ScamCity 展示实体", Formatting.GRAY);
                    return 1;
                }))
                .then(literal("style")
                        .then(literal("blocks").executes(context -> {
                            return applyStyle(context.getSource().getClient(), false);
                        }))
                        .then(literal("people").executes(context -> {
                            return applyStyle(context.getSource().getClient(), true);
                        })))
                .then(literal("status").executes(context -> {
                    MinecraftClient client = context.getSource().getClient();
                    String state = running ? "运行中" : "已暂停";
                    String source = latestSnapshot == null ? "尚未同步" : (latestFromApi ? "HTTP" : "离线演示");
                    say(client, "ScamCity | " + state + " | " + source + " | 队列 " + scenes.size() + (scenes.hasPending() ? " + 最新待渲染场景" : "")
                            + " | 增量基准 " + (scenes.hasRenderedState() ? "已建立" : "待全量同步")
                            + " | 已发送 " + scenes.issued() + " 条 / 跳过 " + scenes.skipped() + " 帧"
                            + " | " + snapshotMeta(), Formatting.AQUA);
                    return 1;
                }))
                .then(literal("api").executes(context -> {
                    MinecraftClient client = context.getSource().getClient();
                    say(client, "ScamCity API | 使用中 " + (activeEndpoint == null ? "尚未确认" : activeEndpoint)
                            + " | 候选 " + String.join(", ", endpoints)
                            + " | " + snapshotMeta(), Formatting.AQUA);
                    return 1;
                }))
        );
    }

    void tick(MinecraftClient client) {
        bindWorld(client);
        if (client.player == null) {
            return;
        }

        drainCommands(client);

        if (!running || requests.busy()) {
            return;
        }

        ticksSinceRefresh++;
        if (ticksSinceRefresh >= POLL_INTERVAL_TICKS) {
            requestSnapshot(client, false);
        }
    }

    private void bindWorld(MinecraftClient client) {
        if (requests.bind(client.world, client.getNetworkHandler())) {
            running = false;
            scenes.reset(false);
            anchor = null;
            latestSnapshot = null;
            latestFromApi = false;
            lastError = "";
            hud = HudState.EMPTY;
            ticksSinceRefresh = POLL_INTERVAL_TICKS;
        }
    }

    private void requestSnapshot(MinecraftClient client, boolean force) {
        bindWorld(client);
        if (requests.busy()) {
            say(client, "ScamCity 正在同步上一份快照", Formatting.YELLOW);
            return;
        }

        long ticket = requests.begin();
        ticksSinceRefresh = 0;
        // A previously confirmed endpoint is tried first so the steady state is
        // always a single request; the candidate list is only walked while the
        // right port is still unknown.
        List<String> attempts = new ArrayList<>();
        if (activeEndpoint != null) {
            attempts.add(activeEndpoint);
        }
        for (String endpoint : endpoints) {
            if (!attempts.contains(endpoint)) {
                attempts.add(endpoint);
            }
        }
        say(client, "正在同步 ScamCity: " + attempts.get(0), Formatting.GRAY);
        fetchSnapshot(client, attempts, 0, ticket, force);
    }

    /**
     * Try {@code attempts.get(index)}, falling through to the next candidate.
     *
     * <p>Recursion rather than a loop because each attempt is asynchronous. A
     * response is only accepted once {@link ApiEndpoints#looksLikeSnapshot}
     * confirms it came from ScamCity: reaching a listener proves a port is open,
     * not that the right service is behind it, and the failure this guards
     * against is precisely Minecraft's own LAN server answering on port 3000.</p>
     */
    private void fetchSnapshot(MinecraftClient client, List<String> attempts, int index,
                               long ticket, boolean force) {
        String endpoint = attempts.get(index);
        HttpRequest request;
        try {
            request = HttpRequest.newBuilder(URI.create(endpoint))
                    .timeout(Duration.ofSeconds(5))
                    .header("Accept", "application/json")
                    .GET()
                    .build();
        } catch (IllegalArgumentException ex) {
            failoverOrGiveUp(client, attempts, index, ticket, force,
                    "API 地址无效: " + ex.getMessage());
            return;
        }

        CompletableFuture<HttpResponse<String>> future = httpClient.sendAsync(
                request,
                HttpResponse.BodyHandlers.ofString()
        );
        future.orTimeout(7, java.util.concurrent.TimeUnit.SECONDS)
                .thenApply(response -> {
                    if (response.statusCode() < 200 || response.statusCode() >= 300) {
                        throw new IllegalStateException("HTTP " + response.statusCode());
                    }
                    if (!ApiEndpoints.looksLikeSnapshot(response.body())) {
                        throw new IllegalStateException(ApiEndpoints.wrongServiceMessage(endpoint));
                    }
                    return JsonParser.parseString(response.body()).getAsJsonObject();
                })
                .whenComplete((snapshot, error) -> client.execute(() -> {
                    if (error != null || snapshot == null) {
                        Throwable cause = error == null ? new IllegalStateException("空响应") : unwrap(error);
                        String message = cause.getMessage() == null
                                ? cause.getClass().getSimpleName() : cause.getMessage();
                        failoverOrGiveUp(client, attempts, index, ticket, force, message);
                        return;
                    }
                    if (!requests.finish(ticket, client.world, client.getNetworkHandler())) return;
                    lastError = "";
                    if (!endpoint.equals(activeEndpoint)) {
                        activeEndpoint = endpoint;
                        say(client, "ScamCity API 已确认: " + endpoint, Formatting.GREEN);
                    }
                    applySnapshot(client, snapshot, true, force);
                    say(client, "ScamCity 快照已同步", Formatting.GREEN);
        }));
    }

    /**
     * Move to the next candidate, or fall back to the offline demo.
     *
     * <p>The request ticket is only settled on the final failure, so the whole
     * chain counts as one logical request and a late response from an abandoned
     * candidate cannot unlock a newer one.</p>
     */
    private void failoverOrGiveUp(MinecraftClient client, List<String> attempts, int index,
                                  long ticket, boolean force, String message) {
        if (index + 1 < attempts.size()) {
            say(client, "该地址不可用（" + message + "），尝试 " + attempts.get(index + 1), Formatting.GRAY);
            fetchSnapshot(client, attempts, index + 1, ticket, force);
            return;
        }
        if (!requests.finish(ticket, client.world, client.getNetworkHandler())) return;
        // A confirmed endpoint that stops answering is forgotten, so the next
        // refresh rediscovers rather than retrying a port that has moved.
        activeEndpoint = null;
        lastError = message;
        applySnapshot(client, DemoSnapshot.create("API 不可用: " + lastError), false, force);
        say(client, "API 不可用，已切换离线演示: " + lastError, Formatting.YELLOW);
    }

    private void postIntervention(MinecraftClient client, String strategy) {
        bindWorld(client);
        if (!INTERVENTION_STRATEGIES.contains(strategy)) {
            say(client, "不支持的干预策略: " + strategy, Formatting.RED);
            return;
        }
        if (requests.busy()) {
            say(client, "ScamCity 正在同步上一份快照，请稍后再试", Formatting.YELLOW);
            return;
        }

        long ticket = requests.begin();
        ticksSinceRefresh = 0;
        String body = "{\"type\":\"intervention\",\"strategy\":\"" + strategy + "\"}";
        // An intervention mutates simulation state, so it is never broadcast
        // across candidate endpoints: dispatching the same command to the wrong
        // service, or twice, is worse than failing with a clear message. A GET
        // refresh has to confirm the endpoint first.
        if (activeEndpoint == null) {
            requests.finish(ticket, client.world, client.getNetworkHandler());
            say(client, "尚未确认 ScamCity API 地址，请先执行 /scamcity refresh", Formatting.RED);
            return;
        }
        HttpRequest request;
        try {
            request = HttpRequest.newBuilder(URI.create(activeEndpoint))
                    .timeout(Duration.ofSeconds(7))
                    .header("Accept", "application/json")
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(body))
                    .build();
        } catch (IllegalArgumentException ex) {
            requests.finish(ticket, client.world, client.getNetworkHandler());
            lastError = "API 地址无效: " + ex.getMessage();
            say(client, lastError, Formatting.RED);
            return;
        }

        say(client, "正在执行干预: " + strategy, Formatting.GRAY);
        httpClient.sendAsync(request, HttpResponse.BodyHandlers.ofString())
                .orTimeout(9, java.util.concurrent.TimeUnit.SECONDS)
                .thenApply(response -> {
                    if (response.statusCode() < 200 || response.statusCode() >= 300) {
                        throw new IllegalStateException("HTTP " + response.statusCode() + ": " + response.body());
                    }
                    if (!ApiEndpoints.looksLikeSnapshot(response.body())) {
                        throw new IllegalStateException(ApiEndpoints.wrongServiceMessage(activeEndpoint));
                    }
                    return JsonParser.parseString(response.body()).getAsJsonObject();
                })
                .whenComplete((snapshot, error) -> client.execute(() -> {
                    if (!requests.finish(ticket, client.world, client.getNetworkHandler())) return;
                    if (error != null || snapshot == null) {
                        Throwable cause = error == null ? new IllegalStateException("空响应") : unwrap(error);
                        lastError = cause.getMessage() == null ? cause.getClass().getSimpleName() : cause.getMessage();
                        say(client, "干预失败: " + lastError, Formatting.RED);
                        return;
                    }
                    lastError = "";
                    applySnapshot(client, snapshot, true, true);
                    say(client, "干预已执行并刷新展示: " + strategy + " | " + snapshotMeta(), Formatting.GREEN);
                }));
    }

    private static Throwable unwrap(Throwable error) {
        if (error instanceof java.util.concurrent.CompletionException && error.getCause() != null) {
            return error.getCause();
        }
        return error;
    }

    private void applySnapshot(MinecraftClient client, JsonObject snapshot, boolean fromApi, boolean force) {
        latestSnapshot = snapshot;
        latestFromApi = fromApi;
        if (client.player == null || client.getNetworkHandler() == null) {
            return;
        }

        Scene.Builder scene = Scene.builder();

        JsonObject world = object(snapshot, "world");
        if (world == null) {
            world = snapshot;
        }

        JsonArray citizens = array(world, "citizens");
        JsonArray scammers = array(world, "scammers");
        JsonArray events = array(world, "eventFeed");
        JsonObject metrics = object(world, "metrics");
        if (anchor == null) {
            anchor = client.player.getBlockPos();
        }
        int baseX = anchor.getX();
        int baseY = anchor.getY();
        int baseZ = anchor.getZ() + 5;

        enqueueHeader(scene, baseX, baseY, baseZ, metrics, citizens.size(), scammers.size(), fromApi);
        enqueueCitizens(scene, baseX, baseY, baseZ, citizens);
        enqueueScammers(scene, baseX, baseY, baseZ, scammers);
        enqueueEvents(scene, baseX, baseY, baseZ, events);

        int victims = statusNumber(metrics, "victims", countStatus(citizens, "victim"));
        scene.trailing("title @s actionbar " + component(
                "SCAMCITY | " + victims + " victims | " + money(metrics),
                "aqua"
        ));
        scenes.submit(scene.build(), force);
        updateHud(snapshot, fromApi, citizens.size(), scammers.size(), victims, metrics);
    }

    /**
     * Refresh the screen overlay from the snapshot.
     *
     * <p>The verdict is read from the top level of the snapshot rather than from
     * {@code world}: it is a property of a comparison run, not of the world, and
     * it is absent until one has been executed. Surfacing it here is what gives
     * the shared "best strategy" rule an in-game presence — previously it existed
     * only in the API payload and the web dashboard.</p>
     */
    private void updateHud(JsonObject snapshot, boolean fromApi,
                           int citizenCount, int scammerCount, int victims, JsonObject metrics) {
        JsonObject verdict = object(snapshot, "verdict");
        String bestLabel = verdict == null ? "" : string(verdict, "bestLabel", "bestStrategy");
        String reason = verdict == null ? "" : string(verdict, "reason");
        // Only claim a synthetic disclaimer when the payload actually carries
        // one, so the overlay never invents provenance it cannot support.
        boolean synthetic = verdict != null && !string(verdict, "disclaimer").isBlank();
        hud = HudState.of(running, latestSnapshot != null, fromApi,
                citizenCount, scammerCount, victims, money(metrics),
                bestLabel, reason, synthetic,
                lastError.isBlank() ? null : lastError);
    }

    /**
     * Redraw the overlay from the last snapshot without re-fetching.
     *
     * <p>Used by commands that change how the state should read (start/stop)
     * rather than what the state is. No snapshot means nothing to restate.</p>
     */
    private void refreshHud() {
        if (latestSnapshot == null) {
            hud = HudState.EMPTY;
            return;
        }
        JsonObject world = object(latestSnapshot, "world");
        if (world == null) {
            world = latestSnapshot;
        }
        JsonArray citizens = array(world, "citizens");
        JsonObject metrics = object(world, "metrics");
        updateHud(latestSnapshot, latestFromApi, citizens.size(), array(world, "scammers").size(),
                statusNumber(metrics, "victims", countStatus(citizens, "victim")), metrics);
    }

    /**
     * The control tower is split into independent slots so a changing metric
     * does not redraw the static legend or plinth.
     */
    private void enqueueHeader(Scene.Builder scene, int x, int y, int z, JsonObject metrics,
                               int citizenCount, int scammerCount, boolean fromApi) {
        scene.slot("sc_h1", slot(textDisplay("sc_h1", x, y + 3.2, z - 7,
                "SCAMCITY  " + (fromApi ? "LIVE" : "DEMO"), "aqua")));
        scene.slot("sc_h2", slot(textDisplay("sc_h2", x, y + 2.3, z - 7,
                "居民 " + citizenCount + " | 骗子 " + scammerCount + " | " + money(metrics), "white")));
        scene.slot("sc_h3", slot(textDisplay("sc_h3", x, y + 1.4, z - 7,
                "绿=安全 蓝=起疑 黄=接触 橙=信任 粉=点击 红=受害 青=保护 紫=骗子", "gray")));

        List<String> plinth = new ArrayList<>();
        for (int i = -1; i <= 1; i++) {
            add(plinth, blockDisplay("sc_h4", x + i, y + 0.15, z - 7, "cyan_concrete"));
            add(plinth, blockDisplay("sc_h4", x + i, y + 1.15, z - 7,
                    i == 0 ? "amethyst_block" : "blue_concrete"));
        }
        scene.slot("sc_h4", plinth);
    }

    private void enqueueCitizens(Scene.Builder scene, int baseX, int baseY, int baseZ, JsonArray citizens) {
        // Build the roster first: placement must depend on the set of citizen
        // ids, not on the order the API happened to return them in.
        Map<String, JsonObject> roster = new LinkedHashMap<>();
        for (int i = 0; i < citizens.size(); i++) {
            JsonObject citizen = object(citizens.get(i));
            if (citizen == null) {
                continue;
            }
            String key = string(citizen, "id", "citizenId", "name");
            // A payload with no identifier at all falls back to its position.
            // That is the only case where an insertion can still move a marker.
            if (key.isBlank()) {
                key = "index-" + i;
            }
            roster.putIfAbsent(key, citizen);
        }

        Map<String, Integer> cells = CitizenGrid.place(new ArrayList<>(roster.keySet()));
        // Emit in cell order so a reordered but otherwise identical snapshot
        // produces an identical command stream and SceneQueue skips the redraw.
        List<Map.Entry<String, Integer>> placed = new ArrayList<>(cells.entrySet());
        placed.sort(Map.Entry.comparingByValue());

        for (Map.Entry<String, Integer> entry : placed) {
            String key = entry.getKey();
            int cell = entry.getValue();
            JsonObject citizen = roster.get(key);
            int x = baseX + (cell % CitizenGrid.WIDTH) - 5;
            int z = baseZ + (cell / CitizenGrid.WIDTH) - 5;
            Status status = status(citizen);
            String label = shortText(key, key) + " " + status.label;
            // One slot per cell, so a status change replaces only this marker.
            // The tag is keyed by cell rather than by id: ids can be non-ASCII
            // or too long for a Minecraft tag, while the cell is already the
            // stable projection of that id.
            String tag = "sc_c" + cell;
            List<String> marker = new ArrayList<>();
            if (humanoidFigures) {
                addCitizenStand(marker, tag, x, baseY, z, status);
            } else {
                add(marker, blockDisplay(tag, x, baseY + 0.05, z, status.block));
            }
            add(marker, textDisplay(tag, x, baseY + 1.25, z, label, status.color));
            scene.slot(tag, marker);
        }
    }

    private void enqueueScammers(Scene.Builder scene, int baseX, int baseY, int baseZ, JsonArray scammers) {
        int count = Math.min(12, scammers.size());
        for (int i = 0; i < count; i++) {
            JsonObject scammer = object(scammers.get(i));
            if (scammer == null) {
                continue;
            }
            int x = baseX + (i * 2) - count + 1;
            int z = baseZ - 7;
            String id = shortText(string(scammer, "id", "name", "scammerId"), "S" + String.format(Locale.ROOT, "%02d", i + 1));
            String tag = "sc_s" + i;
            List<String> marker = new ArrayList<>();
            if (humanoidFigures) {
                addScammerStand(marker, tag, x, baseY, z);
            } else {
                add(marker, blockDisplay(tag, x, baseY + 0.05, z, "purple_concrete"));
            }
            add(marker, textDisplay(tag, x, baseY + 1.25, z, id + " SCAMMER", "light_purple"));
            scene.slot(tag, marker);
        }
    }

    private void enqueueEvents(Scene.Builder scene, int baseX, int baseY, int baseZ, JsonArray events) {
        List<JsonObject> recent = new ArrayList<>();
        for (JsonElement event : events) {
            JsonObject object = object(event);
            if (object != null) {
                recent.add(object);
            }
        }
        Collections.reverse(recent);
        int count = Math.min(5, recent.size());
        for (int i = 0; i < count; i++) {
            JsonObject event = recent.get(i);
            String message = shortText(string(event, "message", "description", "type", "eventType"), "world event");
            String type = string(event, "type", "eventType", "kind");
            String color = type.toLowerCase(Locale.ROOT).contains("fraud")
                    || type.toLowerCase(Locale.ROOT).contains("scam") ? "red" : "gold";
            // Event rows are positional: row i always shows the i-th most recent
            // event, so only the rows whose text actually shifted are redrawn.
            String tag = "sc_e" + i;
            scene.slot(tag, slot(textDisplay(tag, baseX + 13, baseY + 2.4 - i * 0.85, baseZ - 5,
                    "EVENT " + (i + 1) + ": " + message, color)));
        }
    }

    private void drainCommands(MinecraftClient client) {
        if (client.getNetworkHandler() == null) {
            return;
        }
        for (int i = 0; i < COMMANDS_PER_TICK; i++) {
            String command = scenes.poll();
            if (command == null) break;
            try {
                client.getNetworkHandler().sendChatCommand(command);
            } catch (RuntimeException ex) {
                ScamCityBridgeClient.LOGGER.warn("Unable to send Minecraft command", ex);
                scenes.reset(false);
                say(client, "展示命令发送失败: " + ex.getMessage(), Formatting.RED);
                return;
            }
        }
    }

    /**
     * Switching style changes every citizen and scammer marker, so the delta base
     * is dropped and the next frame resyncs in full rather than diffing blocks
     * against armour stands.
     */
    private int applyStyle(MinecraftClient client, boolean humanoid) {
        bindWorld(client);
        if (humanoidFigures == humanoid) {
            say(client, "ScamCity 人物样式已经是" + (humanoid ? "小人" : "色块"), Formatting.GRAY);
            return 1;
        }
        humanoidFigures = humanoid;
        scenes.reset(true);
        say(client, "ScamCity 人物样式已切为" + (humanoid ? "小人（居民皮甲染色 / 骗子紫甲持书）" : "色块"), Formatting.AQUA);
        if (latestSnapshot != null) {
            applySnapshot(client, latestSnapshot, latestFromApi, true);
        } else {
            say(client, "尚未同步快照；执行 /scamcity demo 或 /scamcity refresh 查看效果", Formatting.GRAY);
        }
        return 1;
    }

    /** Armour slots dyed to carry the same status colour as the block mode. */
    private static final String[] STAND_PIECES = {
            "armor.head:leather_helmet",
            "armor.chest:leather_chestplate",
            "armor.legs:leather_leggings",
            "armor.feet:leather_boots",
    };

    /**
     * A citizen as a dyed armour stand, emitted as a bare {@code summon} followed
     * by one {@code item replace} per piece.
     *
     * <p>The single-command form (equipment NBT inline) measures 561 characters
     * and the client sends display commands through {@code sendChatCommand},
     * which is capped at 256 by the protocol. Splitting keeps every command under
     * 100 characters. All of them land in the same scene slot, so the whole
     * citizen is still replaced or skipped as one unit.</p>
     *
     * <p>{@code NoGravity} plus {@code Marker:0b} and no base plate park a
     * visible, full-limbed stand on its grid cell: the layout is a data
     * projection, so a citizen must never drift or fall off its own block.
     * {@code DisabledSlots} stops the gear being taken or swapped by a player.</p>
     */
    private static void addCitizenStand(List<String> commands, String slotTag, int x, int y, int z, Status status) {
        add(commands, String.format(Locale.ROOT,
                "summon armor_stand %d %d %d {Tags:[\"%s\",\"%s\"],NoGravity:1b,Invulnerable:1b,NoBasePlate:1b,ShowArms:1b,DisabledSlots:4144959,Rotation:[180f,0f]}",
                x, y, z, Scene.ENTITY_TAG, slotTag));
        for (String piece : STAND_PIECES) {
            int split = piece.indexOf(':');
            // type= is required: the label text_display shares this slot tag, so a
            // bare tag selector could equip the wrong entity.
            add(commands, String.format(Locale.ROOT,
                    "item replace entity @e[tag=%s,type=armor_stand,limit=1] %s with %s[dyed_color=%d]",
                    slotTag, piece.substring(0, split), piece.substring(split + 1), status.leather));
        }
    }

    /** Dye colour for scammer stands, matching the purple of the block form. */
    private static final int SCAMMER_LEATHER = 0x8932B8;

    /**
     * A scammer as a dyed armour stand holding a book.
     *
     * <p>Split into separate commands for the same reason as
     * {@link #addCitizenStand}: the inline-equipment form overruns the
     * 256-character protocol cap on {@code sendChatCommand} and would be dropped
     * silently. The held item is what separates a scammer from a citizen at a
     * glance once both are humanoid, since dye colour alone reads poorly at
     * distance against the citizens' own palette.</p>
     */
    private static void addScammerStand(List<String> commands, String slotTag, int x, int y, int z) {
        add(commands, String.format(Locale.ROOT,
                "summon armor_stand %d %d %d {Tags:[\"%s\",\"%s\"],NoGravity:1b,Invulnerable:1b,NoBasePlate:1b,ShowArms:1b,DisabledSlots:4144959,Rotation:[180f,0f]}",
                x, y, z, Scene.ENTITY_TAG, slotTag));
        for (String piece : STAND_PIECES) {
            int split = piece.indexOf(':');
            // type= is required here too: the label text_display shares this slot
            // tag, so a bare tag selector could equip the wrong entity.
            add(commands, String.format(Locale.ROOT,
                    "item replace entity @e[tag=%s,type=armor_stand,limit=1] %s with %s[dyed_color=%d]",
                    slotTag, piece.substring(0, split), piece.substring(split + 1), SCAMMER_LEATHER));
        }
        add(commands, String.format(Locale.ROOT,
                "item replace entity @e[tag=%s,type=armor_stand,limit=1] weapon.mainhand with minecraft:writable_book",
                slotTag));
    }

    /** Drop oversized commands before they reach a scene, so what a scene
     * records is exactly what will be sent and diffs stay truthful. */
    private static void add(List<String> commands, String command) {
        if (command.length() > 250) {
            ScamCityBridgeClient.LOGGER.warn("Skipping command over 250 chars: {}", command.substring(0, 80));
            return;
        }
        commands.add(command);
    }

    private static List<String> slot(String command) {
        List<String> commands = new ArrayList<>(1);
        add(commands, command);
        return commands;
    }

    /** Every entity carries the shared sweep tag plus its slot tag, which is
     * what makes a single slot separately killable. */
    private static String blockDisplay(String slotTag, int x, double y, int z, String block) {
        return String.format(Locale.ROOT,
                "summon minecraft:block_display %d %.2f %d {Tags:[\"%s\",\"%s\"],block_state:{Name:\"minecraft:%s\"},view_range:64.0f}",
                x, y, z, Scene.ENTITY_TAG, slotTag, block);
    }

    private static String textDisplay(String slotTag, int x, double y, int z, String text, String color) {
        String textComponent = component(text, color);
        return String.format(Locale.ROOT,
                "summon minecraft:text_display %d %.2f %d {Tags:[\"%s\",\"%s\"],text:%s,billboard:\"center\",background:0,shadow:1b,view_range:64.0f}",
                x, y, z, Scene.ENTITY_TAG, slotTag, textComponent);
    }

    private static String component(String text, String color) {
        // Minecraft 1.21.5+ parses text components as inline SNBT rather than
        // a JSON string. This form works both as a /title argument and as the
        // text_display entity's text field: {text:"...",color:"aqua"}.
        return "{text:" + snbtString(shortText(text, ""))
                + ",color:" + snbtString(color) + "}";
    }

    private static String snbtString(String value) {
        String safe = value == null ? "" : value;
        safe = safe.replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", "\\n")
                .replace("\r", "\\r")
                .replace("\t", "\\t");
        return "\"" + safe + "\"";
    }

    private static String money(JsonObject metrics) {
        double value = number(metrics, "moneyLost", "totalMoneyLost", "loss", "moneyLostHkd");
        if (value <= 0) {
            return "HK$0";
        }
        return "HK$" + NumberFormat.getIntegerInstance(Locale.ROOT).format(Math.round(value));
    }

    private String snapshotMeta() {
        if (latestSnapshot == null) {
            return "snapshot=- | cursor=-";
        }
        String snapshotId = shortText(string(latestSnapshot, "snapshotId"), "-");
        JsonObject cursor = object(latestSnapshot, "cursor");
        if (cursor == null) {
            return "snapshot=" + snapshotId + " | cursor=-";
        }
        String revision = string(cursor, "revision");
        String tick = string(cursor, "tick");
        String eventSequence = string(cursor, "eventSequence");
        return "snapshot=" + snapshotId + " | cursor=r" + (revision.isBlank() ? "-" : revision)
                + "/t" + (tick.isBlank() ? "-" : tick)
                + "/e" + (eventSequence.isBlank() ? "-" : eventSequence);
    }

    private static int statusNumber(JsonObject object, String key, int fallback) {
        double value = number(object, key);
        return value == 0 && fallback != 0 ? fallback : (int) Math.round(value);
    }

    private static int countStatus(JsonArray citizens, String expected) {
        int count = 0;
        for (JsonElement element : citizens) {
            JsonObject citizen = object(element);
            if (citizen != null && status(citizen).kind.equals(expected)) {
                count++;
            }
        }
        return count;
    }

    /**
     * Project a citizen onto its marker colour.
     *
     * <p>The simulation's vocabulary is fixed in {@code types/index.ts}:
     * {@code safe → suspicious → engaged → trusted → clicked → victim}, plus
     * {@code protected}. That chain is the product's whole claim — you are meant
     * to watch a scam progress — so every stage needs its own colour. Matching
     * only {@code victim} left {@code engaged}, {@code trusted} and
     * {@code clicked} falling through to the green "safe" default, which drew a
     * citizen who was mid-scam as though nothing were happening.</p>
     *
     * <p>Exact matches come first so the canonical states cannot be captured by a
     * substring rule: {@code "trusted"} contains no other state name, but a
     * loose {@code contains("risk")} test used to swallow anything with "risk" in
     * it. The looser checks below are kept only for payloads from older or
     * hand-written fixtures.</p>
     *
     * <p>Colours deliberately diverge from the web palette for the three middle
     * stages. The dashboard renders {@code engaged}/{@code trusted}/
     * {@code clicked} as three shades of orange, which works for 6px SVG dots but
     * would be one indistinguishable block of colour across a 100-cell grid seen
     * from across the map. The ordering and the labels stay identical; only the
     * spread widens.</p>
     */
    private static Status status(JsonObject citizen) {
        String raw = string(citizen, "state", "status", "outcome").toLowerCase(Locale.ROOT).trim();
        switch (raw) {
            case "safe":
                return new Status("safe", "安全", "green", "lime_concrete", 0x5FC44A);
            case "suspicious":
                return new Status("suspicious", "起疑", "blue", "light_blue_concrete", 0x4C91FF);
            case "engaged":
                return new Status("engaged", "接触", "yellow", "yellow_concrete", 0xFACC15);
            case "trusted":
                return new Status("trusted", "信任", "gold", "orange_concrete", 0xF59E0B);
            case "clicked":
                return new Status("clicked", "已点击", "light_purple", "pink_concrete", 0xE86A9B);
            case "victim":
                return new Status("victim", "受害", "red", "red_concrete", 0xD03A3A);
            case "protected":
                return new Status("protected", "保护", "aqua", "cyan_concrete", 0x2FBFC4);
            default:
                break;
        }
        // Fixtures and older payloads only.
        if (raw.contains("victim") || raw.contains("compromised") || raw.contains("受害") || raw.contains("被骗")) {
            return new Status("victim", "受害", "red", "red_concrete", 0xD03A3A);
        }
        if (raw.contains("protect") || raw.contains("guardian") || raw.contains("保护")) {
            return new Status("protected", "保护", "aqua", "cyan_concrete", 0x2FBFC4);
        }
        return new Status("safe", "安全", "green", "lime_concrete", 0x5FC44A);
    }

    /** {@code leather} is the dye colour used for armour-stand citizens. */
    private record Status(String kind, String label, String color, String block, int leather) {
    }

    private static JsonObject object(JsonObject parent, String key) {
        if (parent == null || !parent.has(key) || !parent.get(key).isJsonObject()) {
            return null;
        }
        return parent.getAsJsonObject(key);
    }

    private static JsonObject object(JsonElement element) {
        return element != null && element.isJsonObject() ? element.getAsJsonObject() : null;
    }

    private static JsonArray array(JsonObject parent, String key) {
        if (parent == null || !parent.has(key) || !parent.get(key).isJsonArray()) {
            return new JsonArray();
        }
        return parent.getAsJsonArray(key);
    }

    private static String string(JsonObject object, String... keys) {
        if (object == null) {
            return "";
        }
        for (String key : keys) {
            JsonElement value = object.get(key);
            if (value != null && value.isJsonPrimitive()) {
                try {
                    return value.getAsString();
                } catch (UnsupportedOperationException ignored) {
                    // Try the next compatible field.
                }
            }
        }
        return "";
    }

    private static double number(JsonObject object, String... keys) {
        if (object == null) {
            return 0;
        }
        for (String key : keys) {
            JsonElement value = object.get(key);
            if (value != null && value.isJsonPrimitive()) {
                try {
                    return value.getAsDouble();
                } catch (NumberFormatException ignored) {
                    // Try the next compatible field.
                }
            }
        }
        return 0;
    }

    private static String shortText(String value, String fallback) {
        String safe = value == null || value.isBlank() ? fallback : value;
        safe = safe.replace('\n', ' ').replace('\r', ' ');
        return safe.length() > 46 ? safe.substring(0, 46) + "…" : safe;
    }

    private static void say(MinecraftClient client, String message, Formatting formatting) {
        if (client.player != null) {
            client.player.sendMessage(Text.literal(message).formatted(formatting), false);
        }
    }
}
