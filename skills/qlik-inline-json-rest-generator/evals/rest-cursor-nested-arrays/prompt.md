---
tags: [skill-creator]
max_turns: 30
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
---

I have a REST connection 'Projects:Acme API' (Allow WITH CONNECTION is on, API key header set on the connection). GET https://api.acme.example/v2/projects?pageSize=50 returns pages like items-page.json. The next page is requested by adding cursor=<meta.nextCursor> to the query; on the last page nextCursor is missing. I need every project with its owner email in one table and the tags in a separate table linked to the right project. Write the load script.

Input files: items-page.json
