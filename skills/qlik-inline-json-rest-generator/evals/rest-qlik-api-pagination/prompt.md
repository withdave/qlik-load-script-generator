---
tags: [skill-creator]
max_turns: 30
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
---

I'm using my REST data connection 'Monitoring:monitoring_apps_REST' (bearer token already set on the connection, "Allow WITH CONNECTION" is on) to load apps from https://mytenant.eu.qlikcloud.com/api/v1/items?resourceType=app&limit=100 but I only ever get the first 100. One page of the response is in items-page.json. Write the load script that gets every app (id, name, resourceType, createdAt plus the owner and space from resourceAttributes) across all pages.

Input files: items-page.json
