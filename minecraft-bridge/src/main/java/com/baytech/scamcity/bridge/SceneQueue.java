package com.baytech.scamcity.bridge;

import java.util.ArrayDeque;
import java.util.List;

/**
 * Client-thread only: finish the active scene, then render only the newest
 * pending scene, and send only the commands that actually changed.
 *
 * <p>Two separate savings apply. Coalescing drops intermediate scenes when
 * snapshots arrive faster than the queue drains, so the city never renders a
 * frame the audience would not see anyway. Diffing then reduces the surviving
 * frame to the slots that differ from what is currently on screen, so a single
 * citizen changing status costs three commands instead of a full teardown.</p>
 *
 * <p>The delta base is the last <em>fully drained</em> scene, never a partially
 * applied one: while a batch is in flight the on-screen state is somewhere
 * between two scenes, so a new scene waits for that batch to finish. Whenever
 * the rendered state becomes unknown (world change, manual clear, send failure)
 * the base is dropped and the next submit performs a full sync.</p>
 */
final class SceneQueue {
    private final ArrayDeque<String> commands = new ArrayDeque<>();
    /** Fully drained and therefore known to be on screen. */
    private Scene rendered;
    /** Currently draining; on-screen state is partway between rendered and this. */
    private Scene active;
    private Scene pending;
    private boolean pendingForce;
    private long skipped;
    private long issued;

    void submit(Scene scene, boolean force) {
        if (scene.equals(pending)) force |= pendingForce;
        if (!commands.isEmpty()) {
            // A return to the active scene cancels an obsolete pending update.
            pending = !force && scene.equals(active) ? null : scene;
            pendingForce = force;
            if (!force && scene.equals(active)) skipped++;
            return;
        }
        pending = null;
        pendingForce = false;
        if (!force && scene.equals(rendered)) {
            skipped++;
            return;
        }
        // A forced redraw cannot trust the rendered state: the operator asked
        // for a rebuild precisely because the world may have drifted.
        List<String> batch = force ? scene.fullSync() : scene.deltaFrom(rendered);
        if (batch.isEmpty()) {
            skipped++;
            rendered = scene;
            return;
        }
        active = scene;
        commands.addAll(batch);
        issued += batch.size();
    }

    String poll() {
        if (commands.isEmpty() && pending != null) {
            Scene next = pending;
            boolean nextForce = pendingForce;
            pending = null;
            pendingForce = false;
            submit(next, nextForce);
        }
        String command = commands.poll();
        if (command != null && commands.isEmpty()) {
            rendered = active;
            active = null;
        }
        return command;
    }

    /**
     * Drop every queued and pending scene.
     *
     * <p>Always clears the delta base: after a reset the bridge no longer knows
     * what is on screen, so the next scene must be a full sync.</p>
     */
    void reset(boolean cleanup) {
        commands.clear();
        active = rendered = pending = null;
        pendingForce = false;
        if (cleanup) commands.add(Scene.killAll());
    }

    int size() { return commands.size(); }
    boolean hasPending() { return pending != null; }
    long skipped() { return skipped; }
    long issued() { return issued; }
    boolean hasRenderedState() { return rendered != null; }
}
