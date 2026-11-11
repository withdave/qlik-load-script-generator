---
tags: [skill-creator]
max_turns: 30
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
---

We load raw orders from Snowflake with:

LIB CONNECT TO 'Snowflake_RAW';
RawOrders:
SQL SELECT order_id, payload FROM raw.orders;

payload is a JSON string per row like {"status":"paid","customer":{"name":"Ann","country":"SE"},"lines":[{"sku":"X","qty":2},{"sku":"Y","qty":1}]}. Some orders have identical payloads, and some have an empty lines array. I need the payload expanded into an orders table and an order lines table, with every line still linked to its order_id. What should the script look like?
