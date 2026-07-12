# Homebridge Silent Gliss Gateway

This plugin exposes Silent Gliss gateway motors to HomeKit. HomeKit bursts are batched into one controller request, exact native groups are preferred, and repeated room/type or scene combinations can be learned as managed controller groups.

## Local command coordinator

Another Homebridge child bridge on the same host can use the optional loopback-only API so physical controls share the same native group inventory, learning and controller send queue:

```json
{
  "address": "192.168.70.2",
  "autoGroups": true,
  "commandApiPort": 17602,
  "commandApiToken": "REPLACE_WITH_A_LONG_RANDOM_TOKEN"
}
```

The API binds only to `127.0.0.1` and accepts authenticated `POST /v1/commands` requests containing `open`, `close`, or `stop`, a movement session ID, and the requested motor IDs. A stop request reuses the validated native groups from the matching movement session; if group membership has changed, the original motors are stopped individually.

The controller maximum of 64 native groups is enforced. When capacity is exhausted, commands continue in a single multi-motor controller request.
