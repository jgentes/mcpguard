# Network Access Enforcement & Opt-in Cursor Hooks (Design Notes)

This document captures an agreed approach for two related efforts:

1) **Make per-MCP Network Access settings actually enforced during MCPGuard Worker executions**.
2) **(Future, opt-in) Use Cursor hooks to block outbound shell tooling (e.g., `curl`) and steer users/agents to MCPGuard**, with an explicit user confirmation step via an MCPGuard tool: `request_network_access`.

This is a design note only; implementation may vary based on runtime constraints.

## Background: What exists today

### Per-MCP network settings already exist
The VS Code extension UI (and settings store) supports per-MCP network settings:

- `network.enabled`
- `network.allowlist` (Allowed Hosts)
- `network.allowLocalhost`

These settings are persisted to `~/.mcpguard/settings.json` and mapped into a runtime-friendly structure:

- Source of truth and mapping: `src/utils/mcp-registry.ts`
  - `WorkerIsolationConfig.outbound.allowedHosts`
  - `WorkerIsolationConfig.outbound.allowLocalhost`

### Current enforcement gap
Dynamic Worker creation currently hard-disables outbound network:

- `src/server/worker-manager.ts` emits `globalOutbound: null` in generated `WorkerCode`.

That means the allowlist configured in the extension is currently not applied to Worker executions.

## Goal 1: Enforce per-MCP network policy during Worker execution

### Desired behavior
For a guarded MCP (i.e., routed through MCPGuard):

- **Network disabled**: Worker cannot make outbound requests.
- **Network enabled**:
  - Worker may use `fetch()`.
  - Requests are restricted to:
    - allowlisted hosts, and
    - localhost only if `allowLocalhost` is enabled.

### Where to apply the policy
At code execution time (per execution/per MCP instance), MCPGuard should load the effective policy from `src/utils/mcp-registry.ts`:

- `getIsolationConfigForMCP(mcpName)`

### Enforcement approach (current design)
Because the Worker Loader API type exposed in this repo only contains a coarse `globalOutbound?: 'allow' | 'deny' | null` (`src/types/worker.ts`) and does not carry host allowlists, enforce host restrictions in **two layers**:

1) **Enable/disable outbound at the Worker runtime level**
   - If network disabled: `globalOutbound: null`.
   - If network enabled: `globalOutbound: 'allow'`.

2) **Enforce allowlisted hosts inside the dynamic Worker**
   - In the generated Worker script, wrap `fetch` before user code runs:
     - Parse URL from `string | URL | Request`.
     - Reject disallowed hosts with a clear error.
     - Reject localhost/loopback unless explicitly allowed.

Notes:
- This does not prevent *all* forms of network access if additional APIs exist, but for typical Worker environments `fetch()` is the primary outbound capability.
- Host matching should start simple (exact host match) and only add wildcard/suffix matching if needed.

### Optional extension: apply allowlist to URL-based MCP endpoints
Some MCPs are configured via `url` (HTTP transport). Decide whether the per-MCP allowlist should also gate the MCP endpoint itself.

If yes:
- Validate the configured MCP endpoint host against the same allowlist before connecting (schema fetch, prompts, tool calls).

## Goal 2 (future, opt-in): Cursor hooks to block outbound shell tools and steer to MCPGuard

### Why hooks
Cursor Enterprise hooks can deterministically intercept terminal commands **before execution** and allow/deny them, returning guidance text.

This can reduce exposure to:
- accidental `curl` to untrusted domains,
- prompt-injection-driven attempts to fetch malicious pages outside MCPGuard,
- unsafe browsing/exfil paths that bypass MCPGuard.

### High-level opt-in workflow
1) A user/agent attempts a terminal network command (e.g., `curl https://example.com`).
2) The Cursor hook detects the network tool and extracts a destination URL/host (best-effort).
3) The hook **denies** the command and instructs:
   - “Please confirm MCP Guard access to <url> by approving `mcpguard.request_network_access`.”
4) The agent calls `mcpguard.request_network_access` (a new MCPGuard tool).
   - Cursor will show the tool call for user approval.
   - Approval is the explicit confirmation moment.
5) After approval, the agent uses MCPGuard (`call_mcp` or guarded tool calls) to fetch/process content under the allowlist.

Important:
- Hooks cannot reliably present an interactive yes/no prompt mid-hook; the approval happens via the **MCP tool call prompt**.

### Example Cursor hook (concept)
The following is an example “before terminal execution” hook policy concept for Cursor Enterprise. It denies direct network commands (e.g., `curl`) and steers the agent/user to confirm access via MCPGuard.

Notes:
- The exact hook input/output JSON shape depends on Cursor’s hook API; treat this as a conceptual template.
- The hook should **deny** the command (to prevent bypass) and instruct the agent to call `mcpguard.request_network_access`.
- The user confirmation happens when Cursor prompts to approve the MCP tool call.

```bash
#!/usr/bin/env bash
set -euo pipefail

input="$(cat)"

# Extract the command string (Cursor hook payloads are JSON)
command="$(echo "$input" | jq -r '.command // ""')"

# Very simple destination extraction for curl-style commands:
# - curl https://example.com/path
url="$(echo "$command" | awk '{for (i=1;i<=NF;i++) if ($i ~ /^https?:\\/\\//) {print $i; exit}}')"

if [[ "$command" =~ (^|[[:space:]])curl($|[[:space:]]) ]]; then
  cat << EOF
{
  "permission": "deny",
  "userMessage": "Network command blocked. Please confirm MCP Guard access to ${url:-<url>} by approving mcpguard.request_network_access, then re-run via MCPGuard (call_mcp).",
  "agentMessage": "Do not use curl. Call mcpguard.request_network_access with {mcp_name: <target_mcp>, url: \"${url:-<url>}\"}, then use mcpguard.call_mcp and fetch() under the allowlist."
}
EOF
  exit 0
fi

cat << EOF
{ "permission": "allow" }
EOF
```

## Proposed new MCPGuard tool: `request_network_access`

### Purpose
Provide a user-approvable action to add a destination to a guarded MCP’s allowlist (and optionally enable network access), so subsequent MCPGuard executions can fetch from that destination.

### Proposed input schema
- `mcp_name: string` (target MCP whose policy is being updated)
- `url: string` (full URL; MCPGuard extracts host)
- `allow_localhost?: boolean` (default false)
- `ttl_minutes?: number` (optional; if set, store expiry for temporary access)

### Proposed behavior
- Parse URL, extract host.
- Normalize host (lowercase, strip trailing dot).
- Validate host:
  - reject empty host, invalid host, and (by default) raw IP literals / private ranges unless explicitly allowed.
- Update `~/.mcpguard/settings.json` via `src/utils/mcp-registry.ts` helpers:
  - ensure MCP config exists (create defaults if needed)
  - set `network.enabled = true`
  - append host to `network.allowlist` if not present
  - optionally set `allowLocalhost`
  - optionally store TTL metadata (requires schema extension)
- Return JSON confirmation, e.g.:

```json
{ "success": true, "mcp_name": "github", "allowed_host": "api.github.com", "expires_at": null }
```

## Prompt injection: what network isolation does and does not solve

### Key point
**Fetching inside an isolate is not sufficient to prevent prompt injection**.

Prompt injection is about *untrusted content influencing the model*. Even with perfect sandboxing, if you return raw untrusted HTML/text to the LLM, the LLM can still be manipulated.

### What isolation does help with
If injected content causes the model to attempt harmful actions (read files, access env vars, exfiltrate via network), a correctly configured isolate can reduce the blast radius by blocking those capabilities.

However:
- The model can still take harmful actions via *allowed tools*.
- The model can still be socially engineered.

### Recommended mitigation pattern: “data diode” outputs
When using `fetch()` in a guarded execution, prefer:

- **Minimize what returns to the LLM**:
  - return structured JSON (facts/fields) instead of raw page bodies
  - strict truncation/size limits
- **Sanitize**:
  - strip HTML → text
  - remove scripts/styles/hidden content
  - normalize whitespace
- **Label and gate**:
  - attach provenance: `source_url`, `retrieved_at`
  - include risk signals (heuristics) and require user confirmation for risky content

This makes untrusted content *data-like* rather than *instruction-like*.

## Open questions / future decisions
- Whether host allowlists should support wildcards (e.g., `*.example.com`) or remain exact-match.
- Whether `request_network_access` should support TTL-based temporary grants (and how expiry is enforced).
- Whether allowlists should apply to URL-based MCP endpoints (`StreamableHTTPClientTransport`) in addition to Worker `fetch()`.
- Whether “prompt-injection scanning” should be purely heuristic or include a dedicated policy engine.
