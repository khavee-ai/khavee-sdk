"use client";
import React, { createContext, useContext, ReactNode, useState, useCallback, useEffect } from 'react';
import { KhaveeConfig, RealtimeProvider } from '@khaveeai/core';
import { VRM } from '@pixiv/three-vrm';

interface KhaveeContextType {
  config?: KhaveeConfig; // Optional
  // VRM state
  vrm: VRM | null;
  setVrm: (vrm: VRM | null) => void;
  // VRM expressions
  expressions: Record<string, number>;
  setExpression: (name: string, value: number) => void;
  resetExpressions: () => void;
  setMultipleExpressions: (expressionMap: Record<string, number>) => void;
  // VRM animations
  currentAnimation: string | null;
  animate: (animationName: string) => void;
  stopAnimation: () => void;
  availableAnimations: string[];
  setAvailableAnimations: (animations: string[]) => void;
  // Realtime provider
  realtimeProvider: RealtimeProvider | null;
  chatStatus: import('@khaveeai/core').ChatStatus;
}

const KhaveeContext = createContext<KhaveeContextType | null>(null);

export interface KhaveeProviderProps {
  config?: KhaveeConfig; // Optional - only needed for LLM/TTS features
  children: ReactNode;
}

/**
 * KhaveeProvider - The main provider component that manages all SDK state
 * 
 * This is the single provider you need to wrap your app with. It handles:
 * - VRM model state and instance management
 * - Expression control and smooth transitions
 * - Animation playback and state
 * - Optional LLM/TTS configuration
 * 
 * @param config - Optional SDK configuration for LLM/TTS features. Not needed for VRM-only apps.
 * @param children - Your app components
 * 
 * @example
 * // VRM-only app (no config needed)
 * ```tsx
 * import { KhaveeProvider, VRMAvatar } from '@khaveeai/react';
 * 
 * function App() {
 *   return (
 *     <KhaveeProvider>
 *       <Canvas>
 *         <VRMAvatar src="/model.vrm" />
 *       </Canvas>
 *     </KhaveeProvider>
 *   );
 * }
 * ```
 * 
 * @example
 * // With LLM/TTS features
 * ```tsx
 * import { KhaveeProvider } from '@khaveeai/react';
 * 
 * const config = {
 *   llm: myLLMProvider,
 *   tts: myTTSProvider,
 *   tools: [],
 * };
 * 
 * function App() {
 *   return (
 *     <KhaveeProvider config={config}>
 *       <Canvas>
 *         <VRMAvatar src="/model.vrm" />
 *       </Canvas>
 *       <ChatInterface />
 *     </KhaveeProvider>
 *   );
 * }
 * ```
 */
export function KhaveeProvider({ config, children }: KhaveeProviderProps) {
  // VRM state
  const [vrm, setVrm] = useState<VRM | null>(null);
  const [expressions, setExpressions] = useState<Record<string, number>>({});
  const [currentAnimation, setCurrentAnimation] = useState<string | null>("idle");
  const [availableAnimations, setAvailableAnimations] = useState<string[]>([]);
  
  // Realtime provider state
  const [realtimeProvider, setRealtimeProvider] = useState<RealtimeProvider | null>(
    config?.realtime || null
  );
  const [chatStatus, setChatStatus] = useState<import('@khaveeai/core').ChatStatus>("stopped");

  // Note: Realtime provider connection is now manual - user must call connect() explicitly

  // Update realtime provider when config changes
  useEffect(() => {
    if (config?.realtime !== realtimeProvider) {
      setRealtimeProvider(config?.realtime || null);
    }
  }, [config?.realtime, realtimeProvider]);

  // Listen to chat status changes from realtime provider
  useEffect(() => {
    if (realtimeProvider) {
      realtimeProvider.onChatStatusChange = setChatStatus;
    }
  }, [realtimeProvider]);

  

  /**
   * setExpression - Set a single VRM facial expression with smooth transition
   * 
   * Sets the intensity of a specific expression. Values are automatically clamped between 0 and 1,
   * and changes are smoothly interpolated over time.
   * 
   * @param name - Name of the expression (e.g., 'happy', 'sad', 'angry', 'surprised')
   * @param value - Intensity value from 0 (none) to 1 (maximum). Will be clamped automatically.
   * 
   * @example
   * ```tsx
   * // Full intensity
   * setExpression('happy', 1);
   * 
   * // Partial intensity
   * setExpression('happy', 0.5);
   * 
   * // Multiple expressions can be active
   * setExpression('happy', 0.7);
   * setExpression('surprised', 0.3);
   * ```
   */
  const setExpression = useCallback((name: string, value: number) => {
    const clampedValue = Math.max(0, Math.min(1, value));
    setExpressions(prev => ({ ...prev, [name]: clampedValue }));
  }, []);

  /**
   * resetExpressions - Reset all active expressions to 0
   * 
   * Smoothly transitions all currently active expressions back to 0 (neutral face).
   * Useful for returning to a neutral state or clearing all expressions.
   * 
   * @example
   * ```tsx
   * // After setting some expressions
   * setExpression('happy', 1);
   * setExpression('surprised', 0.5);
   * 
   * // Reset everything back to neutral
   * resetExpressions();
   * ```
   */
  const resetExpressions = useCallback(() => {
    setExpressions(prev => {
      const resetExpressions = Object.fromEntries(
        Object.keys(prev).map(name => [name, 0])
      );
      return resetExpressions;
    });
  }, []);

  /**
   * setMultipleExpressions - Set multiple expressions at once
   * 
   * Efficiently sets multiple expressions simultaneously. Useful for complex expressions
   * or preset emotional states that combine multiple facial features.
   * 
   * @param expressionMap - Object mapping expression names to values (0-1)
   * 
   * @example
   * ```tsx
   * // Excited expression (happy + surprised)
   * setMultipleExpressions({
   *   happy: 0.8,
   *   surprised: 0.6,
   * });
   * 
   * // Confused expression
   * setMultipleExpressions({
   *   confused: 0.7,
   *   worried: 0.3,
   * });
   * 
   * // Reset specific expressions
   * setMultipleExpressions({
   *   happy: 0,
   *   sad: 0,
   * });
   * ```
   */
  const setMultipleExpressions = useCallback((expressionMap: Record<string, number>) => {
    const clampedExpressions = Object.fromEntries(
      Object.entries(expressionMap).map(([name, value]) => [
        name,
        Math.max(0, Math.min(1, value))
      ])
    );
    setExpressions(prev => ({ ...prev, ...clampedExpressions }));
  }, []);

  /**
   * animate - Play a VRM animation by name
   * 
   * Plays the specified animation with a smooth fade-in transition. Automatically stops
   * any currently playing animation with a fade-out. The "idle" animation auto-plays on load.
   * 
   * @param animationName - Name of the animation to play (must match a key in AnimationConfig)
   * 
   * @example
   * ```tsx
   * // Play walk animation
   * animate('walk');
   * 
   * // Play dance animation
   * animate('dance');
   * 
   * // Return to idle
   * animate('idle');
   * ```
   */
  const animate = useCallback((animationName: string) => {
    setCurrentAnimation(animationName);
  }, []);

  /**
   * stopAnimation - Stop all currently playing animations
   * 
   * Stops all animations with a smooth fade-out. The character will hold its current pose.
   * 
   * @example
   * ```tsx
   * // Stop all animations
   * stopAnimation();
   * 
   * // Later, resume with a new animation
   * animate('idle');
   * ```
   */
  const stopAnimation = useCallback(() => {
    setCurrentAnimation(null);
  }, []);

  return (
    <KhaveeContext.Provider value={{
      config,
      vrm,
      setVrm,
      expressions,
      setExpression,
      resetExpressions,
      setMultipleExpressions,
      currentAnimation,
      animate,
      stopAnimation,
      availableAnimations,
      setAvailableAnimations,
      realtimeProvider,
      chatStatus,
    }}>
      {children}
    </KhaveeContext.Provider>
  );
}

/**
 * useKhavee - Access the complete Khavee SDK context
 * 
 * Returns the full context including VRM state, expressions, animations, and config.
 * This is an advanced hook - for most cases, use the specific hooks like useVRM(),
 * useVRMExpressions(), or useVRMAnimations() instead.
 * 
 * @returns The complete KhaveeContextType object
 * @throws Error if used outside of KhaveeProvider
 * 
 * @example
 * ```tsx
 * import { useKhavee } from '@khaveeai/react';
 * 
 * function AdvancedComponent() {
 *   const { 
 *     vrm, 
 *     expressions, 
 *     currentAnimation,
 *     config 
 *   } = useKhavee();
 *   
 *   return (
 *     <div>
 *       VRM loaded: {vrm ? 'Yes' : 'No'}
 *       Current animation: {currentAnimation}
 *     </div>
 *   );
 * }
 * ```
 */
export function useKhavee(): KhaveeContextType {
  const context = useContext(KhaveeContext);
  if (!context) {
    throw new Error('useKhavee must be used within a KhaveeProvider');
  }
  return context;
}