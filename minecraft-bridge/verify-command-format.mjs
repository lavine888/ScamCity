import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("./src/main/java/com/baytech/scamcity/bridge/BridgeController.java", import.meta.url),
  "utf8",
);

// Minecraft 1.21.5+ parses text components as inline SNBT. These assertions
// prevent the pre-1.21.5 JSON-in-a-string form from returning to the bridge.
assert.match(source, /text:%s,billboard/);
assert.match(source, /return "\{text:" \+ snbtString/);
assert.doesNotMatch(source, /text:'%s'/);
assert.match(source, /replace\("\\\\", "\\\\\\\\"\)/);
assert.match(source, /replace\("\\\"", "\\\\\\\""\)/);
assert.match(source, /literal\("intervene"\)/);
for (const strategy of [
  "baseline",
  "mass-warning",
  "bank-risk-agent",
  "social-guardian",
  "network-intervention",
]) {
  assert.match(source, new RegExp(`postIntervention\\([^,]+, "${strategy}"\\)`));
}
assert.match(source, /POST\(HttpRequest\.BodyPublishers\.ofString\(body\)\)/);
assert.match(source, /snapshotMeta\(\)/);

// Incremental rendering (acceptance matrix A-12) depends on every entity
// carrying the shared sweep tag AND its own slot tag: the sweep tag makes
// `/scamcity clear` able to remove everything, the slot tag makes a single
// marker separately killable. Losing either one silently breaks delta updates,
// so both are asserted here rather than only in the Java regression.
assert.match(source, /Tags:\[\\"%s\\",\\"%s\\"\]/);
// Asserted as an invariant over every summon template rather than as a fixed
// count: a hardcoded total has to be edited whenever a new entity kind is added,
// which turns a real check into a speed bump. What actually matters is that no
// summon ever ships with fewer than both tags.
const summonTemplates = [...source.matchAll(/"summon (?:\\.|[^"\\])*"/g)].map((m) => m[0]);
assert.ok(summonTemplates.length >= 4,
  `expected the citizen stand, scammer stand, block display and text display summons, found ${summonTemplates.length}`);
for (const template of summonTemplates) {
  assert.match(template, /Tags:\[\\"%s\\",\\"%s\\"\]/,
    `every summoned entity needs the sweep tag and its slot tag: ${template.slice(0, 60)}`);
}
assert.match(source, /Scene\.ENTITY_TAG, slotTag/);
assert.doesNotMatch(source, /Tags:\[\\"%s\\"\]/, "a single-tag entity could not be updated incrementally");
// The full sweep must stay centralised in Scene so the queue and the controller
// cannot disagree about which tag identifies bridge-owned entities.
assert.doesNotMatch(source, /"kill @e\[tag="/, "kill commands belong in Scene");

// Humanoid citizens are sent as a bare summon plus one `item replace` per piece.
// The inline-equipment form measures 561 chars but commands go out through
// sendChatCommand, which the protocol caps at 256, so `add()` would silently
// drop every citizen. Keep the split form and keep the type filter: the label
// text_display shares the slot tag, so a bare tag selector could equip it.
assert.match(source, /item replace entity @e\[tag=%s,type=armor_stand,limit=1\]/);
assert.doesNotMatch(source, /summon\s+\S*armor_stand[^"]*equipment:\{/,
  "inline armour-stand equipment exceeds the 256-char chat command cap");
assert.match(source, /dyed_color=%d/);
// Scammers use the same split form. Both humanoid builders must stay under the
// cap, so assert no builder inlines equipment and that the scammer keeps its
// held item: once citizens are humanoid too, dye colour alone reads poorly at
// distance and the item is the thing that says "this one is the scammer".
assert.match(source, /addScammerStand/,
  "scammers must have a humanoid form, not only citizens");
assert.match(source, /weapon\.mainhand with minecraft:writable_book/,
  "the scammer's held item is what distinguishes it from a citizen stand");
assert.doesNotMatch(source, /summon armor_stand[^\n]*ArmorItems/,
  "ArmorItems inline would overrun the 256-char cap and be dropped silently");
// Every emitted command is length-checked against the protocol cap, because the
// failure mode is silent: add() drops the command and nothing renders.
for (const match of source.matchAll(/"(?:summon |item replace entity )(?:\\.|[^"\\])*"/g)) {
  // Substitute the widest real values: 12 scammers means sc_s11, and a dyed
  // colour is 8 decimal digits at most.
  const rendered = match[0]
    .slice(1, -1)
    .replace(/%s/g, "sc_s11")
    .replace(/%d/g, "99999999")
    .replace(/%\.2f/g, "9999.99")
    .replace(/\\"/g, '"');
  assert.ok(rendered.length < 250,
    `command template would render at ${rendered.length} chars, over the guard: ${rendered.slice(0, 60)}`);
}

// The bridge must not go back to a single hardcoded endpoint. Port 3000 is
// regularly taken over by Minecraft's own "Open to LAN" server, which answers
// with an error indistinguishable from an unrelated HTTP/2 fault, so endpoint
// choice belongs in ApiEndpoints where it is validated and regression-tested.
assert.match(source, /ApiEndpoints\.candidates\(/);
assert.match(source, /ApiEndpoints\.looksLikeSnapshot\(response\.body\(\)\)/,
  "a 200 from an unknown service must not be accepted as a snapshot");
assert.doesNotMatch(source, /String DEFAULT_API_URL/,
  "the default endpoint belongs in ApiEndpoints, not the controller");

// HTTP/1.1 stays pinned: the JDK default is HTTP/2, whose h2c upgrade the
// Next.js dev server drops without replying.
assert.match(source, /\.version\(HttpClient\.Version\.HTTP_1_1\)/,
  "HTTP/1.1 must stay pinned or snapshots silently fail to arrive");

// The overlay is the only in-game surface for the comparison verdict, and it
// must be read from the snapshot root: the verdict is a property of a
// comparison run, not of the world, and is absent until one has executed.
assert.match(source, /object\(snapshot, "verdict"\)/);
assert.match(source, /volatile HudState hud/,
  "the HUD is read from the render thread, so publication must be volatile");

const hudSource = await readFile(
  new URL("./src/main/java/com/baytech/scamcity/bridge/ScamCityHud.java", import.meta.url),
  "utf8",
);
// The overlay must yield the corner to F3 and never paint over an open screen.
assert.match(hudSource, /shouldShowDebugHud\(\)/);
assert.match(hudSource, /client\.currentScreen != null/);
// No textures: the point of the overlay is that it costs no entities and no
// assets, so it cannot fail to load at runtime.
assert.doesNotMatch(hudSource, /drawTexture|NativeImage|Identifier\.of/,
  "the overlay is drawn with fill/drawText only");
// The panel must be sized from measured glyph advances. A fixed per-character
// width undersizes it badly for Chinese text (~9px vs ~6px per glyph), so the
// rows spill past the background that exists to keep them readable.
assert.match(hudSource, /textRenderer\.getWidth\(/,
  "panel width must come from the font, not a per-character estimate");
assert.doesNotMatch(hudSource, /widestLine\(\)\s*\*/,
  "character counts must not be multiplied into a pixel width");

/**
 * Bind the Java state switch to the canonical TypeScript union.
 *
 * The vocabulary is owned by types/index.ts and Java cannot import it. The
 * Java-side fixtures only exercise `safe` and `victim`, so a state without an
 * explicit branch falls through to the green "safe" default and draws a citizen
 * who is mid-scam as though nothing were wrong.
 */
async function assertCitizenStates() {
  const types = await readFile(new URL("../types/index.ts", import.meta.url), "utf8");
  const union = /export type CitizenState =([^;]+);/.exec(types);
  assert.ok(union, "could not find the CitizenState union in types/index.ts");
  const states = [...union[1].matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
  assert.ok(states.length >= 7, `expected the full funnel, parsed: ${states.join(", ")}`);

  const blocks = [];
  for (const state of states) {
    const branch = new RegExp(
      `case "${state}":\\s*\\n\\s*return new Status\\("${state}", "[^"]+", "[a-z_]+", "([a-z_]+)", 0x[0-9A-Fa-f]{6}\\)`,
    ).exec(source);
    assert.ok(branch, `citizen state "${state}" has no explicit branch in status()`);
    blocks.push(branch[1]);
  }
  // A shared colour would merge two funnel stages into one on the grid.
  assert.equal(new Set(blocks).size, blocks.length, `two states share a block: ${blocks.join(", ")}`);
  // Scammers are purple concrete; a citizen state must not collide with them.
  assert.ok(!blocks.includes("purple_concrete"), "a citizen state must not reuse the scammer colour");

  // Every rendered colour needs naming on screen or the palette is unexplained.
  const legend = /"([^"]*=[^"]*骗子)"/.exec(source);
  assert.ok(legend, "could not find the control-tower legend");
  for (const label of ["安全", "起疑", "接触", "信任", "点击", "受害", "保护"]) {
    assert.ok(legend[1].includes(label), `legend is missing "${label}"`);
  }

  // riskScore was never a citizen field (the payload has riskAwareness), so the
  // old threshold branch was dead code that could only mislabel.
  assert.doesNotMatch(source, /number\(citizen, "riskScore"/, "riskScore is not a citizen field");
  assert.doesNotMatch(source, /"atRisk"/, "atRisk is not part of the simulation vocabulary");
}

await assertCitizenStates();

console.log("Minecraft text command format check passed");
