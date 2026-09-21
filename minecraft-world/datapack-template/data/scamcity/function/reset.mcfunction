# Safe reset: remove only entities created by the ScamCity bridge.
kill @e[type=minecraft:block_display,tag=scamcity.citizen]
kill @e[type=minecraft:text_display,tag=scamcity.text]
kill @e[type=minecraft:item_display,tag=scamcity.scammer]
kill @e[type=minecraft:block_display,tag=scamcity.scammer]
kill @e[type=minecraft:marker,tag=scamcity.marker]
scoreboard players set #tick scamcity_tick 0
scoreboard players set #day scamcity_day 1
scoreboard players set #victims scamcity_victims 0
scoreboard players set #loss scamcity_loss 0
scoreboard players set #risk scamcity_risk 0
scoreboard players set #events scamcity_events 0
tellraw @a {"text":"SCAMCITY display entities and HUD reset.","color":"yellow"}
