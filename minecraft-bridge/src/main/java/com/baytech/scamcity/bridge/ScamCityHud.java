package com.baytech.scamcity.bridge;

import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.render.RenderTickCounter;
import net.fabricmc.fabric.api.client.rendering.v1.hud.HudElement;

/**
 * Draws {@link HudState} into the top-left of the window.
 *
 * <p>Rendering is pure {@code fill} and {@code drawText}: no textures, no
 * atlases, nothing to load or fail at runtime. The overlay therefore adds no
 * world entities and no assets, which is the point — the entity budget is spent
 * on the city itself.</p>
 *
 * <p>Stays silent when there is nothing to say, and hides itself whenever a
 * screen is open (inventory, chat, pause) or the debug HUD is up, so it never
 * covers the interface a presenter is actually using.</p>
 */
final class ScamCityHud implements HudElement {
    private static final int MARGIN_X = 6;
    private static final int MARGIN_Y = 6;
    private static final int PADDING = 5;
    private static final int LINE_HEIGHT = 10;
    /** Semi-opaque backing so text stays readable over snow, sand or sky. */
    private static final int PANEL_BACKGROUND = 0xB0101418;
    private static final int PANEL_EDGE = 0x40FFFFFF;

    private final BridgeController controller;

    ScamCityHud(BridgeController controller) {
        this.controller = controller;
    }

    @Override
    public void render(DrawContext context, RenderTickCounter tickCounter) {
        MinecraftClient client = MinecraftClient.getInstance();
        if (client == null || client.player == null) {
            return;
        }
        // F3 owns the top-left corner; yielding avoids overlapping text that
        // would make both unreadable.
        if (client.getDebugHud() != null && client.getDebugHud().shouldShowDebugHud()) {
            return;
        }
        if (client.currentScreen != null) {
            return;
        }

        HudState state = controller.hudState();
        if (!state.visible() || state.lines().isEmpty()) {
            return;
        }

        // Measured, not estimated: a fixed per-character width is wrong for this
        // overlay because nearly every line is Chinese, and CJK glyphs advance
        // about 9px against ~6px for ASCII. Estimating undersized the panel so
        // the text spilled past its own background — defeating the one thing the
        // background is for. The font is only safe to measure on the render
        // thread, which is exactly where this runs.
        int widest = 0;
        for (HudState.Line line : state.lines()) {
            widest = Math.max(widest, client.textRenderer.getWidth(line.text()));
        }
        int width = widest + PADDING * 2;
        int height = state.lines().size() * LINE_HEIGHT + PADDING * 2 - 2;
        context.fill(MARGIN_X, MARGIN_Y, MARGIN_X + width, MARGIN_Y + height, PANEL_BACKGROUND);
        // A one-pixel top and bottom rule reads as a panel rather than a stray
        // block of text, at no meaningful cost.
        context.fill(MARGIN_X, MARGIN_Y, MARGIN_X + width, MARGIN_Y + 1, PANEL_EDGE);
        context.fill(MARGIN_X, MARGIN_Y + height - 1, MARGIN_X + width, MARGIN_Y + height, PANEL_EDGE);

        int y = MARGIN_Y + PADDING;
        for (HudState.Line line : state.lines()) {
            context.drawText(client.textRenderer, line.text(), MARGIN_X + PADDING, y, line.color(), true);
            y += LINE_HEIGHT;
        }
    }
}
