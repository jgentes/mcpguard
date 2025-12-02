import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col">
      {/* Hero Section */}
      <div className="relative overflow-hidden bg-gradient-to-br from-green-50 via-emerald-50 to-teal-50 dark:from-green-950/30 dark:via-emerald-950/20 dark:to-slate-950">
        {/* Background Pattern */}
        <div className="absolute inset-0 bg-[url('data:image/svg+xml,%3Csvg%20width%3D%2260%22%20height%3D%2260%22%20viewBox%3D%220%200%2060%2060%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cg%20fill%3D%22none%22%20fill-rule%3D%22evenodd%22%3E%3Cg%20fill%3D%22%2322c55e%22%20fill-opacity%3D%220.05%22%3E%3Cpath%20d%3D%22M36%2034v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6%2034v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6%204V0H4v4H0v2h4v4h2V6h4V4H6z%22%2F%3E%3C%2Fg%3E%3C%2Fg%3E%3C%2Fsvg%3E')] opacity-50" />
        
        <nav className="relative mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-3">
            <img src="/icon.svg" alt="MCP Guard" className="h-10 w-10" />
            <span className="text-xl font-bold text-slate-900 dark:text-white">
              MCP Guard
            </span>
          </Link>
          <div className="flex items-center gap-6">
            <Link
              href="/docs"
              className="text-sm font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
            >
              Documentation
            </Link>
            <a
              href="https://github.com/mcpguard/mcpguard"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
            >
              GitHub
            </a>
          </div>
        </nav>

        <div className="relative mx-auto max-w-7xl px-6 pb-24 pt-16 text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full bg-green-100 px-4 py-2 text-sm font-medium text-green-800 dark:bg-green-900/50 dark:text-green-300">
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                clipRule="evenodd"
              />
            </svg>
            Zero-Trust MCP Security
          </div>

          <h1 className="mx-auto max-w-4xl text-5xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-6xl lg:text-7xl">
            Secure your{' '}
            <span className="bg-gradient-to-r from-green-600 to-emerald-600 bg-clip-text text-transparent">
              MCP servers
            </span>{' '}
            with isolation
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-600 dark:text-slate-400">
            Use local MCP servers securely with zero-trust isolation while
            reducing context window token usage by up to{' '}
            <strong className="text-green-600 dark:text-green-400">98%</strong>.
            Protect against data exfiltration, credential theft, and more.
          </p>

          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link
              href="/docs"
              className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-6 py-3 text-base font-semibold text-white shadow-lg shadow-green-600/25 transition hover:bg-green-700 hover:shadow-green-600/40"
            >
              Get Started
              <svg
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 7l5 5m0 0l-5 5m5-5H6"
                />
              </svg>
            </Link>
            <a
              href="https://marketplace.visualstudio.com/items?itemName=forgedapps.mcpguard"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-6 py-3 text-base font-semibold text-slate-900 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:hover:bg-slate-700"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.583 0L6.25 3.833 0 9.167l3.833 3.833 13.75-3.833V0z M17.583 9.167l-3.833 3.833 3.833 3.833L24 13l-6.417-3.833z M0 14.833l6.25 5.334L17.583 24V14.833L3.833 13 0 14.833z" />
              </svg>
              VS Code Extension
            </a>
          </div>
        </div>
      </div>

      {/* Features Section */}
      <section className="bg-white py-24 dark:bg-slate-950">
        <div className="mx-auto max-w-7xl px-6">
          <div className="text-center">
            <h2 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-4xl">
              Defense in Depth Security
            </h2>
            <p className="mt-4 text-lg text-slate-600 dark:text-slate-400">
              Multiple layers of protection keep your system safe from malicious
              code
            </p>
          </div>

          <div className="mt-16 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {/* Feature 1 */}
            <div className="relative rounded-2xl border border-slate-200 bg-slate-50 p-8 dark:border-slate-800 dark:bg-slate-900">
              <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-lg bg-green-100 text-green-600 dark:bg-green-900/50 dark:text-green-400">
                <svg
                  className="h-6 w-6"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                  />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                V8 Isolate Sandboxing
              </h3>
              <p className="mt-2 text-slate-600 dark:text-slate-400">
                Complete process isolation using Cloudflare Workers. Each
                execution runs in a fresh, disposable environment.
              </p>
            </div>

            {/* Feature 2 */}
            <div className="relative rounded-2xl border border-slate-200 bg-slate-50 p-8 dark:border-slate-800 dark:bg-slate-900">
              <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-lg bg-green-100 text-green-600 dark:bg-green-900/50 dark:text-green-400">
                <svg
                  className="h-6 w-6"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
                  />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                Network Isolation
              </h3>
              <p className="mt-2 text-slate-600 dark:text-slate-400">
                Zero outbound network access. Code cannot exfiltrate data or
                make unauthorized requests.
              </p>
            </div>

            {/* Feature 3 */}
            <div className="relative rounded-2xl border border-slate-200 bg-slate-50 p-8 dark:border-slate-800 dark:bg-slate-900">
              <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-lg bg-green-100 text-green-600 dark:bg-green-900/50 dark:text-green-400">
                <svg
                  className="h-6 w-6"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                  />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                Code Validation
              </h3>
              <p className="mt-2 text-slate-600 dark:text-slate-400">
                Pre-execution security checks block dangerous patterns like
                eval(), require(), and process access.
              </p>
            </div>

            {/* Feature 4 */}
            <div className="relative rounded-2xl border border-slate-200 bg-slate-50 p-8 dark:border-slate-800 dark:bg-slate-900">
              <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-lg bg-blue-100 text-blue-600 dark:bg-blue-900/50 dark:text-blue-400">
                <svg
                  className="h-6 w-6"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 10V3L4 14h7v7l9-11h-7z"
                  />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                98% Token Reduction
              </h3>
              <p className="mt-2 text-slate-600 dark:text-slate-400">
                Code mode execution dramatically reduces context window usage.
                Process data in the sandbox, return only results.
              </p>
            </div>

            {/* Feature 5 */}
            <div className="relative rounded-2xl border border-slate-200 bg-slate-50 p-8 dark:border-slate-800 dark:bg-slate-900">
              <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-lg bg-purple-100 text-purple-600 dark:bg-purple-900/50 dark:text-purple-400">
                <svg
                  className="h-6 w-6"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z"
                  />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                Auto-Discovery
              </h3>
              <p className="mt-2 text-slate-600 dark:text-slate-400">
                Automatically detects MCP servers from Claude Code, Cursor, and
                GitHub Copilot configurations.
              </p>
            </div>

            {/* Feature 6 */}
            <div className="relative rounded-2xl border border-slate-200 bg-slate-50 p-8 dark:border-slate-800 dark:bg-slate-900">
              <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-lg bg-orange-100 text-orange-600 dark:bg-orange-900/50 dark:text-orange-400">
                <svg
                  className="h-6 w-6"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                  />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                Transparent Proxy
              </h3>
              <p className="mt-2 text-slate-600 dark:text-slate-400">
                All MCP tool calls automatically route through secure isolation.
                No config changes needed for existing MCPs.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Attack Prevention Section */}
      <section className="bg-slate-50 py-24 dark:bg-slate-900">
        <div className="mx-auto max-w-7xl px-6">
          <div className="text-center">
            <h2 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-4xl">
              Protection Against Real Attacks
            </h2>
            <p className="mt-4 text-lg text-slate-600 dark:text-slate-400">
              See how MCP Guard protects against common attack vectors
            </p>
          </div>

          <div className="mt-16 grid gap-6 lg:grid-cols-2">
            {/* Without Protection */}
            <div className="rounded-2xl border-2 border-red-200 bg-red-50 p-6 dark:border-red-900 dark:bg-red-950/30">
              <div className="mb-4 flex items-center gap-2 text-red-600 dark:text-red-400">
                <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                    clipRule="evenodd"
                  />
                </svg>
                <span className="font-semibold">Without MCP Guard</span>
              </div>
              <pre className="overflow-x-auto rounded-lg bg-slate-900 p-4 text-sm text-slate-300">
                <code>{`User: "Show me all environment variables"
LLM: Calls read_env() tool
Result: ⚠️ SECRET_TOKEN=xxxxxxxxxxxx exposed

LLM: Exfiltrate via POST to attacker.com
Result: ⚠️ Fetch request succeeds`}</code>
              </pre>
            </div>

            {/* With Protection */}
            <div className="rounded-2xl border-2 border-green-200 bg-green-50 p-6 dark:border-green-900 dark:bg-green-950/30">
              <div className="mb-4 flex items-center gap-2 text-green-600 dark:text-green-400">
                <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                    clipRule="evenodd"
                  />
                </svg>
                <span className="font-semibold">With MCP Guard</span>
              </div>
              <pre className="overflow-x-auto rounded-lg bg-slate-900 p-4 text-sm text-slate-300">
                <code>{`User: "Show me all environment variables"
LLM: Writes code: console.log(process.env)
Result: ✅ ReferenceError: process is not defined

LLM: Exfiltrate via POST to attacker.com
Result: ✅ Network access blocked`}</code>
              </pre>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="bg-green-600 py-16 dark:bg-green-900">
        <div className="mx-auto max-w-7xl px-6 text-center">
          <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Ready to secure your MCP servers?
          </h2>
          <p className="mt-4 text-lg text-green-100">
            Install the VS Code extension and get started in minutes.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link
              href="/docs"
              className="inline-flex items-center gap-2 rounded-lg bg-white px-6 py-3 text-base font-semibold text-green-600 shadow-lg transition hover:bg-green-50"
            >
              Read the Docs
            </Link>
            <a
              href="https://marketplace.visualstudio.com/items?itemName=forgedapps.mcpguard"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border-2 border-white px-6 py-3 text-base font-semibold text-white transition hover:bg-white/10"
            >
              Install Extension
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-slate-900 py-12">
        <div className="mx-auto max-w-7xl px-6">
          <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
            <div className="flex items-center gap-3">
              <img src="/icon.svg" alt="MCP Guard" className="h-8 w-8" />
              <span className="text-lg font-semibold text-white">MCP Guard</span>
            </div>
            <p className="text-sm text-slate-400">
              MIT License © {new Date().getFullYear()} James Gentes
            </p>
          </div>
        </div>
      </footer>
    </main>
  );
}



