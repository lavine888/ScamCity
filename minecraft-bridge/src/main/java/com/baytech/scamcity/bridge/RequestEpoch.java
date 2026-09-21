package com.baytech.scamcity.bridge;

/** Invalidates HTTP callbacks whenever the display lifecycle or world changes. */
final class RequestEpoch {
    private long generation;
    private boolean busy;
    private Object world;
    private Object network;

    boolean bind(Object nextWorld, Object nextNetwork) {
        if (world == nextWorld && network == nextNetwork) return false;
        world = nextWorld;
        network = nextNetwork;
        invalidate();
        return true;
    }

    void invalidate() { generation++; busy = false; }
    boolean busy() { return busy; }
    long begin() {
        if (busy) throw new IllegalStateException("Request already active");
        busy = true;
        return ++generation;
    }
    boolean finish(long ticket, Object currentWorld, Object currentNetwork) {
        if (ticket != generation || world != currentWorld || network != currentNetwork) return false;
        busy = false;
        return true;
    }
}
