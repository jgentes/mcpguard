# Contributing to MCP Guard

Thank you for your interest in contributing to MCP Guard! This document provides guidelines and instructions for contributing.

## Getting Started

### Prerequisites

- Node.js 20 or higher
- npm (comes with Node.js)
- Git

### Development Setup

1. **Fork and clone the repository**
   ```bash
   git clone https://github.com/YOUR_USERNAME/mcpguard.git
   cd mcpguard
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. **Build the project**
   ```bash
   npm run build
   ```

5. **Run tests to verify setup**
   ```bash
   npm run test
   ```

## Development Workflow

### Branch Naming

- `feature/` - New features (e.g., `feature/add-rate-limiting`)
- `fix/` - Bug fixes (e.g., `fix/worker-timeout-issue`)
- `docs/` - Documentation updates (e.g., `docs/update-readme`)
- `refactor/` - Code refactoring (e.g., `refactor/schema-converter`)

### Commit Messages

We follow [Conventional Commits](https://www.conventionalcommits.org/). This enables automated changelog generation.

Format: `<type>(<scope>): <description>`

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

**Examples:**
```
feat(worker): add execution timeout configuration
fix(validation): handle edge case in TypeScript parsing
docs(readme): update installation instructions
test(security): add sandbox escape tests
```

### Code Style

We use [Biome](https://biomejs.dev/) for linting and formatting. Before submitting:

```bash
# Check for issues
npm run check

# Auto-fix issues
npm run check:fix

# Format code
npm run format
```

### Testing

Run tests before submitting changes:

```bash
# Run all tests
npm run test

# Run specific test suites
npm run test:unit        # Unit tests
npm run test:integration # Integration tests
npm run test:security    # Security tests
```

**Test coverage thresholds:**
- Lines: 80%
- Functions: 80%
- Branches: 80%
- Statements: 80%

### Building

```bash
npm run build
```

This compiles TypeScript to JavaScript in the `dist/` directory.

## Pull Request Process

### Before Submitting

1. **Update documentation** if you're changing functionality
2. **Add tests** for new features or bug fixes
3. **Run all checks**:
   ```bash
   npm run check
   npm run test
   npm run build
   ```
4. **Update AGENTES.md** if you're changing something significant

### Submitting a PR

1. Create a pull request against the `main` branch
2. Fill out the PR template completely
3. Link any related issues
4. Wait for CI checks to pass
5. Request review from maintainers

### PR Review Criteria

- Code follows project style guidelines
- Tests pass and coverage is maintained
- Documentation is updated
- Commit messages follow conventional commits
- No security vulnerabilities introduced
- Changes are backward compatible (or breaking changes are documented)

## Types of Contributions

### Bug Reports

Use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.md) when filing issues.

Include:
- Clear description of the bug
- Steps to reproduce
- Expected vs actual behavior
- Environment details (OS, Node.js version, etc.)

### Feature Requests

Use the [feature request template](.github/ISSUE_TEMPLATE/feature_request.md).

Include:
- Clear description of the feature
- Use case / motivation
- Proposed implementation (if any)

### Security Vulnerabilities

**Do NOT file public issues for security vulnerabilities.**

See [SECURITY.md](SECURITY.md) for responsible disclosure instructions.

### Documentation

Improvements to documentation are always welcome:
- README.md
- CLAUDE.md (architecture documentation)
- Code comments
- docs/ directory

## Project Structure

```
mcpguard/
├── src/
│   ├── cli/          # Interactive CLI
│   ├── server/       # MCP server implementation
│   ├── types/        # TypeScript type definitions
│   ├── utils/        # Utility functions
│   └── worker/       # Worker runtime code
├── tests/
│   ├── unit/         # Unit tests
│   ├── integration/  # Integration tests
│   ├── security/     # Security tests
│   └── helpers/      # Test utilities
├── docs/             # Documentation
└── vscode-extension/ # VS Code extension
```

## Getting Help

- Read [CLAUDE.md](CLAUDE.md) for architecture details
- Check existing issues for similar questions
- Open a discussion for general questions

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
