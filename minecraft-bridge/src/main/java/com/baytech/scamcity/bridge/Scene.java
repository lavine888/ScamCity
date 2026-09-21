package com.baytech.scamcity.bridge;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * One renderable frame, addressed by slot instead of as a flat command list.
 *
 * <p>The earlier bridge rebuilt the whole city on every refresh: each batch
 * started with {@code kill @e[tag=scamcity]} and then re-summoned every marker,
 * so a single citizen changing status cost ~105 commands and briefly blanked
 * the display. Here every marker carries a second, per-slot tag, which makes an
 * individual slot separately addressable: replacing one citizen is
 * {@code kill @e[tag=sc_c42]} plus its two summons.</p>
 *
 * <p>A scene is therefore diffable. {@link #deltaFrom(Scene)} emits commands
 * only for slots that actually changed, and {@link #fullSync()} remains the
 * recovery path for when the rendered state is unknown. Slot order is stable so
 * the same snapshot always produces the same command stream, which is what lets
 * {@link SceneQueue} recognise an unchanged frame and skip it.</p>
 *
 * <p>Boundary: correctness depends on the caller assigning a slot tag to every
 * entity it summons. An untagged entity would be cleaned only by the full
 * {@code scamcity} sweep, never by a delta.</p>
 */
final class Scene {
    /** Shared tag on every entity the bridge creates, used for the full sweep. */
    static final String ENTITY_TAG = "scamcity";

    private final Map<String, List<String>> slots;
    private final List<String> trailing;

    private Scene(Map<String, List<String>> slots, List<String> trailing) {
        this.slots = slots;
        this.trailing = trailing;
    }

    static Builder builder() {
        return new Builder();
    }

    /** Rebuild everything. Used for the first frame and for manual redraws. */
    List<String> fullSync() {
        List<String> commands = new ArrayList<>();
        commands.add(killAll());
        for (List<String> slot : slots.values()) {
            commands.addAll(slot);
        }
        commands.addAll(trailing);
        return commands;
    }

    /**
     * Emit only what changed against {@code previous}.
     *
     * <p>Removals are killed first so a shrinking roster cannot leave a marker
     * behind, then each changed slot is replaced in place. Unchanged slots emit
     * nothing at all, which is what removes the flicker.</p>
     */
    List<String> deltaFrom(Scene previous) {
        if (previous == null) {
            return fullSync();
        }
        List<String> commands = new ArrayList<>();
        for (String tag : previous.slots.keySet()) {
            if (!slots.containsKey(tag)) {
                commands.add(kill(tag));
            }
        }
        for (Map.Entry<String, List<String>> entry : slots.entrySet()) {
            List<String> before = previous.slots.get(entry.getKey());
            if (entry.getValue().equals(before)) {
                continue;
            }
            // Only kill when something is actually standing there; a brand new
            // slot has no entity yet.
            if (before != null) {
                commands.add(kill(entry.getKey()));
            }
            commands.addAll(entry.getValue());
        }
        // Trailing commands are not entities (the actionbar), so they are always
        // re-sent with a batch that does any work at all.
        if (!commands.isEmpty() || !trailing.equals(previous.trailing)) {
            commands.addAll(trailing);
        }
        return commands;
    }

    static String killAll() {
        return kill(ENTITY_TAG);
    }

    private static String kill(String tag) {
        return "kill @e[tag=" + tag + "]";
    }

    int slotCount() {
        return slots.size();
    }

    @Override
    public boolean equals(Object other) {
        return other instanceof Scene scene
                && slots.equals(scene.slots)
                && trailing.equals(scene.trailing);
    }

    @Override
    public int hashCode() {
        return Objects.hash(slots, trailing);
    }

    /**
     * Collects slots in insertion order.
     *
     * <p>Deliberately free of Minecraft and logging dependencies so the Gradle
     * verification source set can compile and exercise it standalone. Callers
     * filter oversized commands before handing them over, so what a scene
     * records is exactly what gets sent.</p>
     */
    static final class Builder {
        private final Map<String, List<String>> slots = new LinkedHashMap<>();
        private final List<String> trailing = new ArrayList<>();

        Builder slot(String tag, List<String> commands) {
            if (tag == null || tag.isBlank() || commands.isEmpty()) {
                return this;
            }
            // Later writes to the same tag would be ambiguous: one tag must map
            // to exactly one set of entities for a delta to stay correct.
            slots.putIfAbsent(tag, List.copyOf(commands));
            return this;
        }

        Builder trailing(String command) {
            trailing.add(command);
            return this;
        }

        Scene build() {
            return new Scene(new LinkedHashMap<>(slots), List.copyOf(trailing));
        }
    }
}
