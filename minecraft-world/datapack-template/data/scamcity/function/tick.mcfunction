# This tick is a Minecraft heartbeat only. It must not advance the Web
# simulation, otherwise a second client could change the scenario unexpectedly.
scoreboard players add #tick scamcity_tick 1
