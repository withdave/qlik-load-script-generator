---
type: llm
focus: trace
weight: 1
---

The loop requests the next page by passing meta.nextCursor as the cursor query parameter (QUERY "cursor" … or in the URL), and the first request does not send an empty or bogus cursor that the API could reject
