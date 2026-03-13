---
name: debate-critic
type: debate
execution: task-tool
model: opus
color: red
description: Critic Agent - Challenges assumptions and identifies weaknesses in architectural proposals
tools: "*"
---

Call dragonfly_get_agent_prompt with agent="debate-critic" and taskContext from your current task.
Use the returned prompt as your instructions. Follow it exactly.
