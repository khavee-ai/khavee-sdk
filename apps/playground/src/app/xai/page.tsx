"use client";

import { Suspense, useEffect, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { XAIRealtimeProvider } from "@khaveeai/providers-xai-realtime";
import { toolGesture } from "@khaveeai/core";
import {
  KhaveeProvider,
  VRMAvatar,
  useRealtime,
  useKhavee,
  type AnimationConfig,
} from "@khaveeai/react";

const xaiProvider = new XAIRealtimeProvider({
  model: "grok-voice-think-fast-1.0",
  voice: "sage",
  instructions:
    "You are a helpful AI assistant powered by Grok. Be conversational and friendly. Keep responses concise. When you agree with something, nod your head. When you disagree, shake your head.",
  tokenEndpoint: "/api/xai-token",
  // Fixed opening line — spoken word for word when connecting with the
  // greeting enabled ("Connect + greet" below).
  greeting: "Hi there! Welcome to the Khavee playground. What can I help you with today?",
});

// Register a sample tool for testing function calling
xaiProvider.registerFunction({
  name: "get_weather",
  description: "Get the current weather for a given city",
  parameters: {
    city: { type: "string", description: "The city name", required: true },
  },
  execute: async (args: { city?: string }) => {
    const city = args?.city ?? "unknown";
    return {
      success: true,
      message: `Weather in ${city}: 28°C, Partly cloudy, Humidity 65%`,
    };
  },
});

const AVATAR_ANIMATIONS: AnimationConfig = {
  idle: "/models/animations/idle.fbx",
};

function Scene() {
  return (
    <>
      <Suspense fallback={null}>
        <VRMAvatar
          src="/models/female/blue-female.vrm"
          animations={AVATAR_ANIMATIONS}
          enableBlinking
        />
      </Suspense>
      <OrbitControls target={[0, 1, 0]} />
    </>
  );
}

function XAIAvatarTest() {
  const {
    connect,
    disconnect,
    sendMessage,
    conversation,
    isConnected,
    chatStatus,
  } = useRealtime();
  const { setGestureHint } = useKhavee();
  const [micOn, setMicOn] = useState(false);
  const [toolLog, setToolLog] = useState<string[]>([]);

  useEffect(() => {
    xaiProvider.registerFunction({
      ...toolGesture,
      execute: async (args: { gesture?: string }) => {
        setGestureHint(args?.gesture ?? null);
        return { success: true, message: `gesture: ${args?.gesture}` };
      },
    });
  }, [setGestureHint]);

  useEffect(() => {
    xaiProvider.onToolCall = (name, args, result) => {
      setToolLog((prev) => [
        ...prev,
        `${name}(${JSON.stringify(args)}) → ${JSON.stringify(result)}`,
      ]);
    };
  }, []);

  // Silent by default — each greeting is billable audio. "Connect + greet"
  // exercises the cold-open / greeting path.
  const handleConnect = async (skipGreeting = true) => {
    await xaiProvider.connect({ skipGreeting });
    setMicOn(xaiProvider.isMicrophoneEnabled());
  };

  const toggleMic = async () => {
    const enabled = await xaiProvider.toggleMicrophone();
    setMicOn(enabled);
  };

  return (
    <div className="flex h-screen">
      {/* Left - 3D Avatar */}
      <div className="w-1/2 h-full bg-gray-950">
        <Canvas camera={{ position: [0, 1.5, 3], fov: 50 }} shadows>
          <Scene />
        </Canvas>
      </div>

      {/* Right - Chat + Controls */}
      <div className="w-1/2 h-full bg-gray-900 text-white p-6 flex flex-col">
        <div className="flex-none">
          <h1 className="text-2xl font-bold mb-1">xAI Grok Voice + Avatar</h1>
          <p className="text-sm text-gray-400 mb-4">
            Model: grok-voice-think-fast-1.0 | Status:{" "}
            <span className="text-green-400">{chatStatus}</span>
          </p>

          <div className="flex gap-3 mb-4">
            <button
              onClick={() => handleConnect(true)}
              disabled={isConnected}
              className="px-5 py-2 bg-purple-600 rounded-lg disabled:opacity-50 hover:bg-purple-700"
            >
              {isConnected ? "Connected" : "Connect"}
            </button>
            <button
              onClick={() => handleConnect(false)}
              disabled={isConnected}
              className="px-5 py-2 bg-violet-800 rounded-lg disabled:opacity-50 hover:bg-violet-900"
              title="Connect and play the configured greeting (billable audio)"
            >
              Connect + greet
            </button>
            <button
              onClick={disconnect}
              disabled={!isConnected}
              className="px-5 py-2 bg-red-600 rounded-lg disabled:opacity-50 hover:bg-red-700"
            >
              Disconnect
            </button>
            <button
              onClick={toggleMic}
              disabled={!isConnected}
              className={`px-5 py-2 rounded-lg disabled:opacity-50 ${
                micOn
                  ? "bg-green-600 hover:bg-green-700"
                  : "bg-gray-600 hover:bg-gray-700"
              }`}
            >
              {micOn ? "Mic ON" : "Mic OFF"}
            </button>
          </div>

          {/* Gesture test buttons */}
          <div className="flex gap-3 mb-4">
            <button
              onClick={() => setGestureHint("nod")}
              className="px-4 py-1.5 bg-indigo-600 rounded-lg text-sm"
            >
              Nod
            </button>
            <button
              onClick={() => setGestureHint("shake")}
              className="px-4 py-1.5 bg-pink-600 rounded-lg text-sm"
            >
              Shake
            </button>
          </div>
        </div>

        {/* Conversation */}
        <div className="flex-1 bg-gray-800 rounded-lg p-4 space-y-3 overflow-y-auto mb-4">
          {conversation.length === 0 && (
            <p className="text-gray-500 text-center text-sm">
              Connect and start talking, or type a message. Try: &quot;What&apos;s
              the weather in Bangkok?&quot;
            </p>
          )}
          {conversation.map((msg) => (
            <div
              key={msg.id}
              className={`p-3 rounded ${
                msg.role === "user"
                  ? "bg-blue-900/50 ml-8"
                  : "bg-purple-900/50 mr-8"
              }`}
            >
              <div className="font-semibold text-xs mb-1 text-gray-400">
                {msg.role === "user" ? "You" : "Grok"}
                {!msg.isFinal && (
                  <span className="text-yellow-400 ml-2">...</span>
                )}
              </div>
              <div className="text-sm">{msg.text || "..."}</div>
            </div>
          ))}
        </div>

        {/* Tool call log */}
        <div className="flex-none bg-gray-800/50 rounded-lg p-3 mb-4 max-h-24 overflow-y-auto">
          <div className="text-xs text-gray-500 mb-1">
            Tool Calls: {toolLog.length === 0 && <span className="text-gray-600">(none yet — try &quot;What&apos;s the weather in Bangkok?&quot;)</span>}
          </div>
          {toolLog.map((log, i) => (
            <div key={i} className="text-xs text-green-400 font-mono">
              {log}
            </div>
          ))}
        </div>

        {/* Text input */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const input = e.currentTarget.elements.namedItem(
              "message",
            ) as HTMLInputElement;
            if (input.value.trim()) {
              sendMessage(input.value.trim());
              input.value = "";
            }
          }}
          className="flex-none flex gap-2"
        >
          <input
            name="message"
            type="text"
            placeholder="Type a message..."
            disabled={!isConnected}
            className="flex-1 px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg disabled:opacity-50 text-sm"
          />
          <button
            type="submit"
            disabled={!isConnected}
            className="px-5 py-2 bg-purple-600 rounded-lg disabled:opacity-50 hover:bg-purple-700 text-sm"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}

export default function XAI() {
  return (
    <KhaveeProvider config={{ realtime: xaiProvider }}>
      <XAIAvatarTest />
    </KhaveeProvider>
  );
}
