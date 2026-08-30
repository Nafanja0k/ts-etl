"use client";

import React, { useState } from "react";
import { Header } from "@/components/Header";
import { TopologyDiagram } from "@/components/TopologyDiagram";
import { PipelineStudio } from "@/components/PipelineStudio";
import { MetricsExplorer } from "@/components/MetricsExplorer";
import { SpecEditor } from "@/components/SpecEditor";
import { S3Inspector } from "@/components/S3Inspector";
import { CodeViewer } from "@/components/CodeViewer";

export default function Home() {
  const [activeTab, setActiveTab] = useState<string>("overview");
  const [isHeaderRunning, setIsHeaderRunning] = useState<boolean>(false);

  const handleTriggerFromHeader = async () => {
    setIsHeaderRunning(true);
    try {
      await fetch("/api/etl/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      // Switch to studio or keep current tab
    } catch (e) {
      console.error(e);
    } finally {
      setIsHeaderRunning(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      <Header
        isRunning={isHeaderRunning}
        onTriggerRun={handleTriggerFromHeader}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {activeTab === "overview" && <TopologyDiagram />}
        {activeTab === "studio" && <PipelineStudio />}
        {activeTab === "metrics" && <MetricsExplorer />}
        {activeTab === "specs" && <SpecEditor />}
        {activeTab === "s3" && <S3Inspector />}
        {activeTab === "code" && <CodeViewer />}
      </main>

      <footer className="border-t border-slate-800/80 bg-slate-950 py-4 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <div>
            Nobl9-Inspired Pull-Based Telemetry ETL Engine • Stateless & Serverless
          </div>
          <div className="font-mono text-[11px] text-slate-400">
            S3 Distributed Lock • Prometheus Remote-Write • Push-Down Downsample
          </div>
        </div>
      </footer>
    </div>
  );
}
