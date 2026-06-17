# Plugin Contract

Every plugin declares a manifest, permissions, optional migrations, and a runtime entry.

```json
{
  "id": "official.feeding",
  "name": "Feeding",
  "version": "0.1.0",
  "entry": "dist/index.js",
  "permissions": [
    "events:emit",
    "events:listen",
    "capability:pet.stats.modify",
    "capability:pet.animation.play"
  ]
}
```

## Communication Rules

- Broadcast facts with events.
- Request work with capabilities.
- Mount UI or content through extension points.
- Store plugin-private data under the plugin namespace.
- Do not import another plugin's implementation.

## Migrations

Plugin migrations are versioned and scoped:

```text
plugins/official/feeding/migrations/001_init.sql
plugins/official/feeding/migrations/002_add_preferences.sql
```

The kernel records applied migrations by `plugin_id` and migration name.
