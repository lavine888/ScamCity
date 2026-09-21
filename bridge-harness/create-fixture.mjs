#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createOfflineWorld } from "./lib/bridge.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(here, "fixtures", "offline-snapshot.json");
const world = createOfflineWorld(42);
const payload = {
  world,
  overview: {
    citizens: world.citizens.length,
    relationships: world.socialGraph.edges.length,
    activeScammers: world.scammers.filter((scammer) => scammer.active).length,
  },
  findings: [],
};

await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(`wrote ${output}`);
