---
type: llm
focus: trace
weight: 1
---

Orders with identical payloads stay separate: the approach does not rely on a plain From_Field(RawOrders, payload) over distinct values without first making each payload unique per row
