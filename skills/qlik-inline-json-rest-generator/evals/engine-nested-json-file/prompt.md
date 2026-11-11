---
tags: [skill-creator]
max_turns: 30
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
---

I've uploaded orders.json to the DataFiles connection in my Qlik Cloud space (lib://DataFiles/orders.json). It's an array of orders, each with a nested customer object and a lines array, and each line has a tags array. Write me the load script to load all of it into properly associated tables.

Input files: orders.json
