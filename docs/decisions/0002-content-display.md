# 0002: Preserve plain notes and render explicit Markdown

Status: Accepted

## Context

MemoryDock stores note bodies verbatim in both Markdown files and the search
index. MCP clients can submit either plain text or structured Markdown. Sending
plain text through a Markdown parser can consume backslashes in Windows paths,
while a plain-text-only reader hides headings, lists, and links in authored
Markdown.

## Decision

The console treats a body as Markdown only when Marked recognizes explicit
block or inline syntax. Bare URLs, line breaks, backslash escapes, and raw HTML
alone do not switch modes. Explicit Markdown continues through DOMPurify; plain
text is inserted by React as text and displayed with preserved line breaks.
The same behavior is used in the detail reader and editor preview. Library and
search results use text-preview cards, following the huiyuan-knowledge project's
card layout while retaining MemoryDock's type, tags, actions, and pagination.

The console defaults to English for its international audience. A persistent
language selector switches console labels, local feedback, and date formatting
between English and Chinese. Saved note content is never translated.

MCP tool descriptions ask agents to format structured notes as Markdown. The
server still stores the exact submitted body; it does not infer sections or
rewrite existing notes. No data migration or API change is needed.
