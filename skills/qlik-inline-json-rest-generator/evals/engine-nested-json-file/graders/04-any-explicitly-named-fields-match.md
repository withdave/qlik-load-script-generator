---
type: llm
focus: trace
weight: 1
---

Any explicitly named fields match the engine's naming: nested objects as dotted names (customer.name, customer.address.city) and child-table fields prefixed with the array path (lines.sku, lines.qty, lines.tags.@1); a LOAD * also satisfies this
