package com.baytech.scamcity.bridge;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;

import java.util.Locale;

/** Deterministic offline snapshot so the Minecraft demo works without Next.js. */
final class DemoSnapshot {
    private DemoSnapshot() {
    }

    static JsonObject create(String reason) {
        JsonObject root = new JsonObject();
        JsonObject world = new JsonObject();
        JsonArray citizens = new JsonArray();
        String[] statuses = {"safe", "safe", "atRisk", "safe", "victim", "protected", "safe", "atRisk", "safe", "safe"};
        for (int i = 0; i < 100; i++) {
            JsonObject citizen = new JsonObject();
            citizen.addProperty("id", String.format(Locale.ROOT, "citizen-%03d", i + 1));
            citizen.addProperty("status", statuses[i % statuses.length]);
            citizen.addProperty("riskScore", statuses[i % statuses.length].equals("atRisk") ? 0.72 : 0.18);
            citizens.add(citizen);
        }

        JsonArray scammers = new JsonArray();
        for (int i = 0; i < 5; i++) {
            JsonObject scammer = new JsonObject();
            scammer.addProperty("id", String.format(Locale.ROOT, "scammer-%02d", i + 1));
            scammer.addProperty("name", "Founder Agent " + (i + 1));
            scammers.add(scammer);
        }

        JsonArray events = new JsonArray();
        addEvent(events, "system", "GPT-7 发布：AI 社会进入新阶段");
        addEvent(events, "scam", "S02 向 C024 发起高风险邀约");
        addEvent(events, "guardian", "Guardian Agent 保护了 C024");
        addEvent(events, "market", "C071 与 C072 组成新团队");

        JsonObject metrics = new JsonObject();
        metrics.addProperty("victims", 10);
        metrics.addProperty("atRisk", 20);
        metrics.addProperty("protected", 10);
        metrics.addProperty("fraudAttempts", 37);
        metrics.addProperty("moneyLost", 750200);

        world.add("citizens", citizens);
        world.add("scammers", scammers);
        world.add("eventFeed", events);
        world.add("metrics", metrics);
        world.addProperty("version", 1);
        world.addProperty("seed", 42);
        world.addProperty("tick", 0);
        world.addProperty("day", 1);
        world.addProperty("time", "Day 1 · 08:00");
        world.addProperty("phase", "idle");
        world.addProperty("eventSequence", events.size());
        world.add("audienceEvents", new JsonArray());
        world.add("activeInterventions", new JsonArray());
        root.add("world", world);
        root.addProperty("schemaVersion", "scamcity.simulation/v1");
        root.addProperty("snapshotId", "offline-demo-42-0-4-0");
        JsonObject cursor = new JsonObject();
        cursor.addProperty("revision", 0);
        cursor.addProperty("tick", 0);
        cursor.addProperty("eventSequence", events.size());
        cursor.addProperty("eventFeedStart", 1);
        cursor.addProperty("eventFeedEnd", events.size());
        cursor.addProperty("eventFeedTruncated", false);
        root.add("cursor", cursor);
        root.add("activeEvents", new JsonArray());
        root.addProperty("offline", true);
        root.addProperty("reason", reason);
        return root;
    }

    private static void addEvent(JsonArray events, String type, String message) {
        JsonObject event = new JsonObject();
        event.addProperty("type", type);
        event.addProperty("message", message);
        events.add(event);
    }
}
