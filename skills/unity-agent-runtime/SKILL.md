---
name: unity-agent-runtime
description: >-
  Client tip — bootstrap Unity agent runtime. Use when ping Unity, bootstrap
  agent-kit-client, sync entitled packs, license.
disable-model-invocation: false
---

# Unity Agent Runtime (client stub)

**Pack:** `core` (luôn có trên máy khách).

## Làm được gì với stub này

- Hướng dẫn `bootstrap-client.ps1` / `sync-entitled.ps1`
- Nhắc license tại `.cursor/agent-kit-license.json`

## Không có trên client

Hệ thống phát triển kit (`agent-kit-promotion`, governance, north-star nội bộ, TemplatePro).

## Nâng cấp

Mua pack → `sync-entitled.ps1` kéo runtime. Stub skill pack tương ứng sẽ được thay bằng skill đầy đủ từ cloud dist.
