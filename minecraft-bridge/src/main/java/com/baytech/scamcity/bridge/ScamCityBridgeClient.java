package com.baytech.scamcity.bridge;

import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.command.v2.ClientCommandRegistrationCallback;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.rendering.v1.hud.HudElementRegistry;
import net.minecraft.util.Identifier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** Fabric entrypoint for the ScamCity visual bridge. */
public final class ScamCityBridgeClient implements ClientModInitializer {
    public static final String MOD_ID = "scamcity_bridge";
    public static final Logger LOGGER = LoggerFactory.getLogger(MOD_ID);

    @Override
    public void onInitializeClient() {
        BridgeController controller = new BridgeController();
        ClientTickEvents.END_CLIENT_TICK.register(controller::tick);
        ClientCommandRegistrationCallback.EVENT.register(controller::registerCommands);
        // Headline metrics and the comparison verdict are drawn to the screen
        // rather than summoned into the world: the entity budget is already
        // carrying 100 citizens plus labels, and an overlay cannot be walked
        // away from or mined. Added last so it paints above the vanilla HUD.
        HudElementRegistry.addLast(
                Identifier.of(MOD_ID, "status-overlay"),
                new ScamCityHud(controller)
        );
        LOGGER.info("ScamCity bridge loaded; use /scamcity refresh or /scamcity demo");
    }
}
