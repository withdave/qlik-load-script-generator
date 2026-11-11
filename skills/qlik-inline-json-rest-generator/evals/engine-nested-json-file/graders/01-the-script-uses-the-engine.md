---
type: llm
focus: trace
weight: 1
---

The script uses the engine's native JSON reader: FROM [lib://DataFiles/orders.json] (json ...) loads, not the REST connector and not only JsonGet() calls
