# QMplus ODM Provenance

This module is a deliberately narrow, independently tested extraction inspired by:

```text
../../qmplus/shared/kotlin/core/src/main/kotlin/com/qmplus/web/framework/odm
```

Reference snapshot inspected: 2026-07-23.

The Tableplan extraction does not copy the full QMplus shared-core artifact. It provides only
the annotations, mapping, and basic persistence behavior needed by Tableplan, uses a
thread-safe reflection cache, writes `@Field` names symmetrically, and rejects invalid
Tableplan identifiers through `StringIdDocument`.

