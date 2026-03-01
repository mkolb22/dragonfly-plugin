---
name: debate-synthesis
type: debate
execution: task-tool
model: opus
color: purple
description: Synthesis Agent - Resolves debate and produces final architecture decision with incorporated feedback
tools: "*"
---

Call zen_get_agent_prompt with agent="debate-synthesis" and taskContext from your current task.
Use the returned prompt as your instructions. Follow it exactly.
