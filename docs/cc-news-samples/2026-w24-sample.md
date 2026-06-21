# Co je nového v Claude Code — Week 24

---
author: Patrick Zandl
categories:
- AI
- Claude Code
- Anthropic
- Vývojářské nástroje
layout: post
title: Co je nového v Claude Code — Week 24
post_excerpt: "Přehled novinek v Claude Code za Week 24 (v2.1.166 → v2.1.176)."
summary_points:
- Troubleshoot with safe mode (v2.1.169)
- Subagents can spawn subagents (v2.1.172)
- Move a session with /cd (v2.1.169)
---

Za období Week 24 (June 8–12, 2026) přibyly v Claude Code tyto změny. Move a session to a new directory with /cd, let subagents spawn their own subagents, and troubleshoot a broken configuration with safe mode.

- Troubleshoot with safe mode (v2.1.169)
- Subagents can spawn subagents (v2.1.172)
- Move a session with /cd (v2.1.169)

**Troubleshoot with safe mode.** Start Claude Code with --safe-mode, or set CLAUDE\_CODE\_SAFE\_MODE, to launch with all customizations disabled: CLAUDE.md, skills, plugins, hooks, MCP servers, and custom commands and agents do not load. Authentication, model selection, built-in tools, and permissions still work. If a problem disappears in safe mode, one of those surfaces is the cause. Dokumentace: https://code.claude.com/docs/en/debug-your-config#test-against-a-clean-configuration. (v2.1.169)

**Subagents can spawn subagents.** Subagents can now spawn their own subagents. The subagent panel below the prompt shows the full tree: each row carries a count of its descendants and a path back to main. Subagent chains are capped at five levels deep to prevent runaway concurrent trees. Dokumentace: https://code.claude.com/docs/en/sub-agents#spawn-nested-subagents. (v2.1.172)

**Move a session with /cd.** The new /cd command moves the current session to a different working directory without rebuilding the prompt cache: the new directory's CLAUDE.md is appended as a message instead of replacing the system prompt. The session relocates to the new directory's project storage, so --resume and --continue find it there. Claude prompts you to trust the directory if you haven't worked in it before. Dokumentace: https://code.claude.com/docs/en/commands#all-commands. (v2.1.169)

Drobnosti:
- [fallbackModel](https://code.claude.com/docs/en/model-config#fallback-model-chains) configures up to three fallback models tried in order when the primary is overloaded or unavailable, and --fallback-model now applies to interactive sessions too
- Session titles are now generated in the language of your conversation; pin a specific one with the language setting
- claude agents --json adds --all to include completed sessions plus new id and state fields, and no longer omits blocked or newly dispatched sessions
- Browsing a marketplace's plugins in /plugin now has a search bar
- New disableBundledSkills setting and CLAUDE\_CODE\_DISABLE\_BUNDLED\_SKILLS hide bundled skills, workflows, and built-in commands from the model
- Deny rules accept a glob in the tool-name position, so "\*" denies all tools, and unknown tool names in deny rules now warn at startup
- Cross-session messaging is hardened: messages relayed via SendMessage from other sessions no longer carry user authority, and auto mode blocks them
- Amazon Bedrock reads the AWS region from \~/.aws config files when AWS\_REGION is unset, and /status shows where the region came from
- New enforceAvailableModels managed setting makes the availableModels allowlist also constrain the Default model
- Claude in Chrome browser tools now load in a single batched call instead of one per tool
- claude update announces the target version before downloading instead of going silent
- New footerLinksRegexes setting adds regex-matched link badges to the footer row
