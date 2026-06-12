/**
 * Tool executor for function calling
 */

import { RealtimeTool } from '@khaveeai/core';

export class ToolExecutor {
  private functions: Map<string, RealtimeTool['execute']> = new Map();

  /**
   * Register a function for execution
   */
  register(name: string, fn: RealtimeTool['execute']): void {
    this.functions.set(name, fn);
  }

  /**
   * Execute a registered function
   */
  async execute(name: string, args: any): Promise<{ success: boolean; message: string }> {
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
