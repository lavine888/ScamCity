# ScamCity bootstrap. This function is intentionally local and idempotent enough
# for a demo world. The bridge owns citizen/entity state; this file owns only HUD
# scoreboards and the local heartbeat.
scoreboard objectives add scamcity_tick dummy
scoreboard objectives add scamcity_day dummy
scoreboard objectives add scamcity_victims dummy
scoreboard objectives add scamcity_loss dummy
scoreboard objectives add scamcity_risk dummy
scoreboard objectives add scamcity_events dummy
scoreboard players set #tick scamcity_tick 0
scoreboard players set #day scamcity_day 1
scoreboard players set #victims scamcity_victims 0
scoreboard players set #loss scamcity_loss 0
scoreboard players set #risk scamcity_risk 0
scoreboard players set #events scamcity_events 0
tellraw @a {"text":"SCAMCITY bridge ready. Waiting for the local simulation.","color":"aqua"}
