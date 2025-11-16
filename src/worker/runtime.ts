/**
 * Parent Worker Runtime
 *
 * This Worker uses the Worker Loader API to spawn dynamic Worker isolates
 * that execute AI-generated TypeScript code with access to MCP server bindings.
 *
 * Reference: https://blog.cloudflare.com/code-mode/
 * Reference: https://developers.cloudflare.com/workers/runtime-apis/bindings/worker-loader/
 */

import type { WorkerCode } from '../types/worker.js'

// ExecutionContext is a global type in Cloudflare Workers runtime
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type ExecutionContext = {
  waitUntil(promise: Promise<any>): void
  passThroughOnException(): void
}

interface Env {
  LOADER: {
    get(
      id: string,
      getCodeCallback: () => Promise<WorkerCode>,
    ): {
      getEntrypoint(
        name?: string,
        options?: { props?: any },
      ): {
        fetch(request: Request): Promise<Response>
      }
    }
  }
  [key: string]: any // MCP bindings and other env vars
}

export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<Response> {
    // CORS headers for development
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders })
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', {
        status: 405,
        headers: corsHeaders,
      })
    }

    try {
      const { workerId, workerCode, executionRequest } =
        (await request.json()) as {
          workerId: string
          workerCode: WorkerCode
          executionRequest: {
            code: string
            timeout?: number
          }
        }

      if (!env.LOADER) {
        throw new Error(
          'Worker Loader binding not available. Ensure [[worker_loaders]] is configured in wrangler.toml',
        )
      }

      // Use Worker Loader API to spawn a dynamic Worker isolate
      // Reference: https://developers.cloudflare.com/workers/runtime-apis/bindings/worker-loader/
      // Following Cloudflare's Code Mode pattern: https://blog.cloudflare.com/code-mode/
      const dynamicWorker = env.LOADER.get(workerId, async () => {
        // Note: Functions cannot be passed via env (they can't be cloned)
        // Instead, we pass the RPC URL and MCP ID as strings
        // The worker code will generate a binding function that uses these values
        // The actual RPC call will be made by embedding the URL in the generated code
        // Since globalOutbound is null, we need to allow fetch to the RPC server specifically
        // For now, keep MCP_RPC_URL and MCP_ID as strings - they'll be used in generated code
        return workerCode
      })

      // Get the default entrypoint of the dynamic Worker
      const entrypoint = dynamicWorker.getEntrypoint()

      // Forward the execution request to the dynamic Worker
      const executionRequestPayload = JSON.stringify(executionRequest)
      const workerResponse = await entrypoint.fetch(
        new Request('http://localhost', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: executionRequestPayload,
        }),
      )

      // Return the response from the dynamic Worker with CORS headers
      const responseBody = await workerResponse.text()
      return new Response(responseBody, {
        status: workerResponse.status,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders,
        },
      })
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error'
      const errorStack = error instanceof Error ? error.stack : undefined
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Failed to execute code in Worker isolate',
          message: errorMessage,
          stack: errorStack,
        }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders,
          },
        },
      )
    }
  },
}
