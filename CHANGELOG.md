# Changelog

## 1.0.2

- Add an authenticated loopback command API for physical-control integrations.
- Reuse native groups for open, close and stop while preserving movement-session membership.
- Serialize HomeKit and external controller traffic through one controller send queue.
- Learn explicit physical-control mappings after their first successful fallback command.
