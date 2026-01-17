## name: publish

Create a new release by analyzing commits, determining version bump, generating changelog, and publishing.

### Instructions for AI:

1. **Check current state:**
   ```bash
   git describe --tags --abbrev=0
   ```
   - If this fails with "No names found", there are no existing tags - get all commits
   - If successful, use the tag to get commits since then

   ```bash
   node -p "require('./package.json').version"
   npm view mcpflare version
   npm view mcpflare versions --json
   ```
   - Verify local version matches or exceeds npm version
   - Check which versions already exist on npm to avoid conflicts

2. **Get commits since last tag:**
   ```bash
   git log v1.x.x..HEAD --oneline
   ```
   Or if no tags exist:
   ```bash
   git log --oneline -50
   ```

3. **Analyze commits to determine version bump:**
   - **MAJOR**: Breaking changes (commits containing "BREAKING CHANGE" or type with "!")
   - **MINOR**: New features (commits starting with "feat:" or "feat(")
   - **PATCH**: Everything else (fix:, docs:, chore:, refactor:, style:, test:, ci:, etc.)

4. **Generate a changelog entry** in this format:
   ```markdown
   ## [X.Y.Z] - YYYY-MM-DD

   ### Added
   - New features from feat: commits

   ### Changed
   - Changes from refactor:, style: commits

   ### Fixed
   - Bug fixes from fix: commits

   ### Other
   - Docs, tests, CI changes
   ```
   Only include sections that have entries. Write human-readable summaries, not just commit messages.

5. **Update CHANGELOG.md:**
   - Prepend the new entry after the title/header
   - Keep existing entries
   - **IMPORTANT:** Commit the changelog BEFORE running npm version:
     ```bash
     git add CHANGELOG.md && git commit -m "docs: update changelog for vX.Y.Z"
     ```

6. **Bump version:**
   ```bash
   npm version [major|minor|patch] -m "chore: release v%s"
   ```
   This automatically:
   - Updates package.json version
   - Runs version hook (syncs VSCode extension version and stages it)
   - Creates a git commit with both package.json files
   - Creates a git tag pointing to that commit

7. **Push to trigger CI publish:**
   ```bash
   git push && git push --tags
   ```
   
   **If tag already exists from a previous failed attempt:**
   ```bash
   git push origin :refs/tags/vX.Y.Z && git push --tags
   ```
   This deletes the old remote tag and pushes the new one.

8. **Report to user:**
   - What version was released (e.g., "1.1.0 → 1.1.1")
   - Summary of changes included
   - Link to GitHub Actions: https://github.com/jgentes/mcpflare/actions

### Notes:
- The pre-push hook runs tests before each push (expect ~70s per push)
- CI will automatically publish to npm when it sees the version tag
- If tests fail, fix them and the push will retry automatically
- If a tag push fails but commits succeeded, delete the remote tag and retry

### Troubleshooting:

**"Startup failure" in Publish workflow:**
- Check GitHub Actions permissions - third-party actions may be blocked
- The workflow uses `gh release create` instead of third-party actions to avoid permission issues
- If third-party actions are blocked, use GitHub's built-in `gh` CLI commands

**"This workflow does not exist":**
- The workflow file is `.github/workflows/release.yml` (name: "Publish")
- Triggered by pushing tags matching `v*`

**Version already published:**
- npm doesn't allow re-publishing the same version
- Bump to a new version and retry
