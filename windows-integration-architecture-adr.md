DR: Windows Integration Architecture for My-Turne

**Status:** Accepted  
**Date:** October 8, 2026

## Context

My-Turne is extending Nocturne on Car Thing with optional Windows-specific functionality such as:

- Windows volume control
- Windows media control and metadata
- Discord integration
- System statistics
- Macros
- Application launching
- Future PC-specific capabilities

The original design introduced a lightweight Windows Companion that exposes these capabilities over a WebSocket connection.

The intended architecture was:

```text
Car Thing
    ↓ WebSocket over LAN
Windows Companion
    ↓
Windows APIs
```

Testing showed that the Car Thing cannot currently route directly to the Windows PC's normal LAN address.

The Mac mini running Nocturne Connector is already reachable by the Car Thing and is always powered on.

Two primary architectures were considered.

---

## Option A — Mac Proxy + Windows Companion

```text
Car Thing
    ↓ existing Nocturne/private connection
Mac mini
    ↓ TCP/WebSocket proxy
Windows Companion
    ↓
Windows APIs
```

The Mac mini forwards the Windows Companion WebSocket connection without otherwise participating in the Windows feature protocol.

### Advantages

- Preserves the existing HostBridge architecture.
- Preserves the existing Windows Companion.
- Existing Sprint 1–3 work remains useful.
- Windows features remain isolated from Nocturne's core connector implementation.
- Windows-specific development can evolve independently.
- Lower risk of merge conflicts with upstream Nocturne.
- New Windows capabilities can be added without modifying Nocturne transport internals.
- Only one proxy port is required because all capabilities share the same WebSocket.
- Additional proxy latency should be negligible for control/state traffic.
- Windows can disappear without affecting core Nocturne operation.
- Mac mini is already always on, so requiring it as the path to Windows has little practical cost.

### Disadvantages

- Requires the Mac mini whenever Windows features are used.
- Adds one additional network hop.
- Requires maintaining:
  - HostBridge WebSocket transport
  - Windows Companion
  - WebSocket authentication/configuration
  - Mac TCP proxy
- More runtime components than a fully native Windows Connector implementation.

---

## Option B — Windows Nocturne Connector

```text
Car Thing
    ↓ Nocturne connector transport
Windows Nocturne Connector
    ↓ native host bridge
Windows APIs
```

Windows becomes a first-class Nocturne Connector rather than an optional external capability provider.

A possible future configuration could also keep the Mac mini connected as fallback:

```text
                    Windows Connector
                   /  preferred
Car Thing ─────────
                   \
                    Mac Connector
                     fallback
```

### Advantages

- Cleaner runtime architecture.
- No custom LAN WebSocket required.
- No Mac proxy required while Windows is active.
- Windows APIs live close to the transport that consumes them.
- Fewer runtime processes and network boundaries.
- Potentially better fit if Car Thing eventually becomes primarily a Windows desk controller.
- Current Nocturne companion routing already provides useful foundations for multiple live routes and fallback.

### Disadvantages

- Windows-specific features become more coupled to Nocturne internals.
- Custom changes may touch:
  - Connector RPC
  - `app.ready`
  - companion ownership
  - native Windows host bridge
  - Car Thing daemon routing
- Greater potential for upstream merge conflicts.
- Experimental features such as Discord, macros, app launching, and system stats would require extending native Nocturne infrastructure.
- Windows becomes more involved in the Car Thing's primary runtime path.
- Explicit Windows-over-Mac priority would require additional route-priority behavior.

---

# Decision

Use **Option A: Mac Proxy + Windows Companion** for the current implementation.

Target architecture:

```text
                         Windows PC
                    ┌──────────────────┐
                    │ Windows Companion│
                    │                  │
                    │ volume           │
                    │ media            │
                    │ Discord          │
                    │ macros           │
                    │ system stats     │
                    │ app launching    │
                    └────────▲─────────┘
                             │
                         WebSocket
                             │
Car Thing ◄──────────► Mac mini
   │                   TCP proxy
   │
   └── normal Nocturne functionality
```

The Mac mini remains the primary Nocturne Connector and the stable always-on infrastructure.

The Windows Companion remains an optional capability provider.

If Windows is unavailable:

```text
Nocturne / Spotify → continue working
Windows capabilities → unavailable
```

If Windows is available:

```text
Nocturne / Spotify → normal
Windows capabilities → available through HostBridge
```

---

# Rationale

The Windows feature set is expected to expand and remain experimental.

Keeping a distinct boundary:

```text
Car Thing UI
     ↓
HostBridge
     ↓
Windows Companion
```

provides a stable abstraction between Nocturne and arbitrary Windows functionality.

This reduces the amount of custom code placed inside upstream Nocturne infrastructure and makes future upstream merges easier.

The Mac mini is already continuously powered and used for other services, which substantially reduces the practical disadvantage of routing Windows functionality through it.

The additional proxy hop is not expected to produce noticeable latency for the intended workload because the protocol primarily carries small control and state messages rather than rendered UI or streaming video.

---

# Implementation Direction

Continue the existing sprint architecture.

### Retain

- Shared host protocol
- `HostCapability`
- `useHostBridge`
- Host connection state
- Host capability reporting
- Host Status UI
- Windows Companion
- Offline/reconnect behavior
- WebSocket protocol

### Revise

The HostBridge target should become a Car-Thing-reachable Mac endpoint rather than attempting to address the Windows LAN IP directly.

Conceptually:

```text
Before:

Car Thing
→ ws://WINDOWS_LAN_IP:8893
→ Windows Companion
```

```text
After:

Car Thing
→ ws://MAC_REACHABLE_IP:8893
→ TCP proxy
→ WINDOWS_LAN_IP:8893
→ Windows Companion
```

No feature-level protocol changes should be necessary simply because a transparent TCP proxy has been inserted.

---

# Future Option: Native Windows Nocturne Connector

Native Windows Connector support is intentionally **not rejected**.

It may become worthwhile if My-Turne evolves from:

> Nocturne with optional Windows integrations

into:

> a Windows-focused Car Thing desk controller built on Nocturne

The architecture should therefore avoid unnecessarily coupling Windows feature implementations to the WebSocket transport.

Where practical:

```text
UI feature
    ↓
Host capability/action abstraction
    ↓
transport
```

rather than:

```text
UI feature
    ↓
raw WebSocket implementation details
```

This creates the possibility of supporting two transports later:

```text
                         ┌─ WebSocket → Mac proxy → Windows Companion
Host capability layer ──┤
                         └─ Nocturne RPC → Windows Connector
```

Both transports could expose the same conceptual capabilities:

```text
volume
media
discord
systemStats
macros
appLaunch
```

The UI should not need separate implementations of those features.

```
Implement explicit Windows Connector priority with automatic fallback to other connected Nocturne connectors.

Current behavior:
- `AppReadyRegistry` stores each connected companion/connector route.
- The most recently registered `app.ready` route becomes active.
- When the active route closes, the most recently ready surviving route is promoted.
- Preserve that failover architecture.

Desired behavior:
- If a healthy Windows Nocturne Connector route is available, it should always be the active connector.
- If Windows disconnects, immediately promote the best surviving connector using the existing fallback behavior (e.g. always-on macOS Connector).
- When Windows reconnects, it should automatically regain ownership.
- A macOS Connector reconnecting while Windows is healthy must NOT steal ownership.
- Phone/iOS/Android routing behavior must not change.

Important compatibility constraint:
- Do NOT change the existing `app.ready.platform: "web"` value used by desktop Connector compatibility.
- Do NOT infer Windows from hostname, display name, or other fragile naming heuristics.
- First inspect whether the daemon already has a reliable connector OS/origin signal.
- If none exists, add the smallest backward-compatible explicit metadata field (for example `connector_platform`) to Connector `app.ready`, while retaining `platform: "web"`.
- Older connectors that omit the new field must continue working exactly as they do now.

Keep the implementation localized around existing companion ownership / `AppReadyRegistry`. Do not redesign Bluetooth, transport, RPC routing, or HostBridge.

Priority should conceptually be:
1. healthy Windows Connector
2. otherwise existing most-recently-ready surviving-route behavior

Add focused tests covering:
- Mac active, then Windows connects → Windows becomes active.
- Windows active, Mac reconnects → Windows stays active.
- Windows active, Windows disconnects → Mac is promoted.
- Windows reconnects → Windows becomes active again.
- Non-Windows/legacy routes without new metadata preserve existing behavior.
- Closing a non-owner route does not disturb the active route.

Keep the diff small. No unrelated refactors or new abstractions unless strictly necessary.

Before editing, identify the exact existing ownership path and tell me if this requires a coordinated change to `nocturne-connector` in addition to this Nocturne repo. If so, keep that protocol addition minimal and backward compatible.
```

---

# Trigger for Reconsideration

Reconsider native Windows Connector integration if one or more of the following becomes true:

1. Windows becomes the primary expected host for most My-Turne users.
2. The Mac proxy becomes a meaningful setup or reliability burden.
3. Windows Companion duplicates substantial functionality already available in the native Windows Connector.
4. Maintaining two independent transports becomes more expensive than integrating into Nocturne.
5. Native Windows features require tighter integration than the HostBridge protocol reasonably provides.
6. My-Turne is intentionally evolving into a Windows-first Car Thing platform.

Until then, prefer the isolated Windows Companion architecture.

---

# Consequences

Near-term development remains:

```text
Sprint 4 → Windows Volume
Sprint 5 → Windows Media
Sprint 6 → Apps/capability UI
Sprint 7 → configurable actions
```

These features should continue to use the HostBridge abstraction.

The immediate infrastructure task is to establish the Mac mini TCP/WebSocket forwarding path rather than implementing general Car Thing → LAN routing or replacing HostBridge with native Connector RPC.

---

# Summary

**Current architecture**

```text
Car Thing
   ↓
Mac mini / Nocturne Connector
   ↓ TCP proxy
Windows Companion
```

**Future optional architecture**

```text
Car Thing
   ↓
Windows Nocturne Connector
```

The current design optimizes for development independence and upstream compatibility.

The future design remains available if Windows becomes important enough to justify tighter native Nocturne integration.
