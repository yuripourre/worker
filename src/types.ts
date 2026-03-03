// Re-export shared types for backward compatibility
export * from './shared';

// Additional client-specific types
export interface ToolContext {
  permissions: string[];
}