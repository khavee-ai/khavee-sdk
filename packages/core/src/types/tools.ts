/**
 * Vendor-neutral tool-calling type system and the promoted ToolExecutor.
 *
 * Tool/ToolResult/ExecutableTool define a plain-object tool registration
 * contract usable without any schema library (CORE-03). ToolExecutor is the
 * single dispatcher implementation, previously duplicated byte-for-byte
 * across packages/providers/openai-stt-tts and packages/providers/openai-realtime
 * (CORE-05) — promoted here unchanged in behavior.
 */

/**
 * Normalized result shape every tool call converges on, regardless of vendor
 * or whether the registered function succeeded, threw, or was not found
 * (CORE-04). Mirrors RealtimeTool.execute's return shape in ./realtime.ts —
 * that file is NOT modified, this type is a deliberate duplication of its
 * shape for the new vendor-neutral Tool contract.
 */
export interface ToolResult {
  success: boolean;
  message: string;
}

/**
 * Plain-object tool definition. No schema-library import required (D-01,
 * D-02) — `parameters` uses a JSON-Schema-shaped object that any LLM vendor's
 * tool-calling API already expects, and `execute` is a single async function
 * field (field name kept as `execute`, matching RealtimeTool, per D-01).
 */
export interface Tool {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<
      string,
      {
        type: "string" | "number" | "boolean" | "array" | "object";
        description?: string;
        enum?: string[];
      }
    >;
    required?: string[];
  };
  execute: (args: any) => Promise<ToolResult>;
}

/**
 * Minimal shape ToolExecutor is typed against (D-03) — deliberately does NOT
 * include `parameters`, since the executor only ever dispatches by name and
 * invokes `execute`; it never reads or validates a tool's parameter schema.
 */
export type ExecutableTool = {
  name: string;
  execute: (args: any) => Promise<ToolResult>;
};

/**
 * Tool executor for function calling.
 *
 * Lifted verbatim from packages/providers/openai-stt-tts/src/ToolExecutor.ts
 * (confirmed byte-for-byte identical to packages/providers/openai-realtime's
 * copy). Only the type parameter changed: RealtimeTool['execute'] ->
 * ExecutableTool['execute']. Deliberately does NOT import from
 * "@khaveeai/core" — that would be a self-import inside this package
 * (RESEARCH Pitfall 2).
 */
export class ToolExecutor {
  private functions: Map<string, ExecutableTool["execute"]> = new Map();

  /**
   * Register a function for execution
   */
  register(name: string, fn: ExecutableTool["execute"]): void {
    this.functions.set(name, fn);
  }

  /**
   * Execute a registered function
   */
  async execute(name: string, args: any): Promise<ToolResult> {
    const fn = this.functions.get(name);

    if (!fn) {
      return {
        success: false,
        message: `Function '${name}' not found`
      };
    }

    try {
      return await fn(args);
    } catch (error) {
      console.error(`Error executing function '${name}':`, error);
      return {
        success: false,
        message: `Error executing function: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Get list of registered function names
   */
  getRegisteredFunctions(): string[] {
    return Array.from(this.functions.keys());
  }
}
