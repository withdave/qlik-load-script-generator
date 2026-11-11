---
tags: [skill-creator]
max_turns: 30
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
---

need this as an inline table in my qlik script please, it's an export from our rules engine (csv):

code,expr,comment
"001","arr[0] & `x`","He said ""hi"" and 'bye'"
"002","a,b","line one
line two"
"003","$(vRate) * 2","ends with a quote'"
