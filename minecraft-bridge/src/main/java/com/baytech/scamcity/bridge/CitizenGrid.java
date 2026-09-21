package com.baytech.scamcity.bridge;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;

/**
 * Stable projection of citizen ids onto the control-room grid.
 *
 * <p>The earlier bridge placed citizens by array index, so any insertion,
 * removal or reordering in the API payload moved every downstream citizen to a
 * different block. This class derives the cell from the citizen id instead, and
 * places ids in sorted order so the result depends only on the <em>set</em> of
 * ids, never on the order they arrive in. A status change therefore never moves
 * anybody, and a reordered-but-otherwise-identical snapshot produces a
 * byte-identical command stream, which lets {@link SceneQueue} skip it.</p>
 *
 * <p>Boundary: adding or removing an id can still shift members of the same
 * collision chain. With the standard full roster (100 ids in 100 cells) the
 * layout is a fixed permutation, so that case does not arise in the demo.</p>
 */
final class CitizenGrid {
    static final int WIDTH = 10;
    static final int HEIGHT = 10;
    static final int CELLS = WIDTH * HEIGHT;

    private CitizenGrid() {
    }

    /**
     * Map each id to a grid cell in {@code [0, CELLS)}.
     *
     * <p>Ids beyond the grid capacity are dropped rather than overlapped, so a
     * caller never renders two citizens on one block.</p>
     */
    static Map<String, Integer> place(List<String> ids) {
        // Sorting (via TreeSet) both de-duplicates and removes any dependence on
        // the caller's iteration order. Linear probing then resolves collisions
        // identically on every run.
        List<String> ordered = new ArrayList<>(new TreeSet<>(ids));
        boolean[] taken = new boolean[CELLS];
        Map<String, Integer> cells = new LinkedHashMap<>();
        for (String id : ordered) {
            if (cells.size() >= CELLS) break;
            int home = Math.floorMod(hash(id), CELLS);
            for (int probe = 0; probe < CELLS; probe += 1) {
                int cell = (home + probe) % CELLS;
                if (!taken[cell]) {
                    taken[cell] = true;
                    cells.put(id, cell);
                    break;
                }
            }
        }
        return cells;
    }

    /**
     * FNV-1a (32-bit) over UTF-16 code units.
     *
     * <p>Chosen over {@code String.hashCode()} so the layout stays readable and
     * verifiable here, and folded one byte at a time so non-ASCII ids hash
     * without truncation.</p>
     */
    static int hash(String id) {
        int hash = 0x811c9dc5;
        for (int index = 0; index < id.length(); index += 1) {
            char value = id.charAt(index);
            hash = (hash ^ (value & 0xff)) * 0x01000193;
            hash = (hash ^ ((value >>> 8) & 0xff)) * 0x01000193;
        }
        return hash;
    }
}
