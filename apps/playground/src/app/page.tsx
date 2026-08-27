"use client"
import React from "react";
import { Loader, Stats } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Suspense } from "react";
import Link from "next/link";
import { Experience } from "./components/Experience";
import { UI } from "./components/UI";

export default function page() {
  return (
    <>
      <Loader />
      
      {/* Navigation overlay */}
      <div className="absolute top-4 right-4 z-10 bg-white rounded-lg shadow-lg p-4">
        <h3 className="font-bold mb-2">Examples</h3>
        <Link 
          href="/sample" 
          className="block px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
        >
          🚀 Khavee SDK Demo
        </Link>
        <p className="text-xs text-gray-600 mt-2">
          Interactive VRM Avatar with AI Chat
        </p>
      </div>

      <Canvas shadows camera={{ position: [0.25, 0.25, 2], fov: 30 }}>
        <color attach="background" args={["#333"]} />
        <fog attach="fog" args={["#333", 10, 20]} />
        <Stats />
        <Suspense>
          <Experience />
        </Suspense>
      </Canvas>
    </>
  );
}
