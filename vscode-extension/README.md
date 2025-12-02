# MCP Guard

Use local MCP servers securely with zero-trust isolation while reducing context window token usage by up to 98%.

## Quick Start

1. **Click the shield icon** 🛡️ in the activity bar (left sidebar)
2. Your MCP servers are auto-imported from Claude, Cursor, and Copilot configs
3. Toggle protection on for any MCP you want to secure

> **Tip:** Use `Ctrl+Shift+P` → "MCP Guard: Open Settings" to open the panel anytime.

## Features

- **Auto-Discovery**: Automatically detects MCP servers from Claude Code, Cursor, and GitHub Copilot configurations
- **Network Allowlists**: Control which hosts each MCP can access
- **File System Controls**: Restrict read/write access to specific directories
- **Resource Limits**: Set execution time, memory, and API call limits
- **Per-MCP Settings**: Configure each MCP server independently

## How It Works

1. Click the **shield icon** in the activity bar to open MCP Guard
2. Your MCP servers are automatically discovered from IDE configurations
3. Toggle **guard protection** on for any MCP you want to isolate
4. Configure network, file system, and resource settings as needed

## Configuration Options

### Network Access

| Option | Description |
|--------|-------------|
| **Enable Network Access** | Allow the MCP to make outbound requests |
| **Allowed Hosts** | Specific domains that can be accessed (e.g., `api.github.com`) |
| **Allow Localhost** | Permit requests to localhost/127.0.0.1 |

### File System Access

| Option | Description |
|--------|-------------|
| **Enable File System** | Allow the MCP to access files |
| **Read Paths** | Directories the MCP can read from |
| **Write Paths** | Directories the MCP can write to |

### Resource Limits

| Option | Default | Description |
|--------|---------|-------------|
| **Max Execution Time** | 30s | Maximum time per execution |
| **Max Memory** | 128MB | Memory limit |
| **Max MCP Calls** | 100 | Maximum tool calls per execution |

## Security

MCP Guard uses Cloudflare Workers isolates for execution:

- **Network Isolation**: All outbound access blocked by default
- **Process Isolation**: Each execution in a fresh isolate
- **Configurable Allowlists**: Granular control over what each MCP can access

## Commands

- `MCP Guard: Open Settings` - Open the configuration panel
- `MCP Guard: Refresh MCP List` - Re-scan for MCP servers
- `MCP Guard: Import from IDE Config` - Import MCP configurations

## Support

- [Documentation](https://github.com/mcpguard/mcpguard)
- [Report Issues](https://github.com/mcpguard/mcpguard/issues)
