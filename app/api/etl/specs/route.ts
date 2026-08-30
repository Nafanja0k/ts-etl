import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import * as yaml from "js-yaml";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const specKey = searchParams.get("spec");

  const files: Record<string, string> = {
    "registry": "specs/pipeline_registry.yaml",
    "schema": "specs/target_metrics_schema.yaml",
    "mapping_k8s": "specs/mappings/k8s_prom.yaml",
    "mapping_splunk": "specs/mappings/splunk_apps.yaml",
    "mapping_graphite": "specs/mappings/graphite_infra.yaml",
  };

  if (specKey && files[specKey]) {
    const fullPath = path.join(process.cwd(), files[specKey]);
    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, "utf-8");
      let parsed = null;
      try {
        parsed = yaml.load(content);
      } catch {}
      return NextResponse.json({ path: files[specKey], content, parsed });
    }
  }

  const allSpecs: Record<string, { path: string; content: string; parsed: any }> = {};
  for (const [key, relPath] of Object.entries(files)) {
    const fullPath = path.join(process.cwd(), relPath);
    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, "utf-8");
      let parsed = null;
      try {
        parsed = yaml.load(content);
      } catch {}
      allSpecs[key] = { path: relPath, content, parsed };
    }
  }

  return NextResponse.json({ specs: allSpecs });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { specKey, content } = body;

    const files: Record<string, string> = {
      "registry": "specs/pipeline_registry.yaml",
      "schema": "specs/target_metrics_schema.yaml",
      "mapping_k8s": "specs/mappings/k8s_prom.yaml",
      "mapping_splunk": "specs/mappings/splunk_apps.yaml",
      "mapping_graphite": "specs/mappings/graphite_infra.yaml",
    };

    if (!specKey || !files[specKey]) {
      return NextResponse.json({ error: "Invalid spec key" }, { status: 400 });
    }

    // Validate YAML syntax
    let parsed: any;
    try {
      parsed = yaml.load(content);
    } catch (e: any) {
      return NextResponse.json({ error: `YAML parse error: ${e.message}` }, { status: 400 });
    }

    const fullPath = path.join(process.cwd(), files[specKey]);
    fs.writeFileSync(fullPath, content, "utf-8");

    return NextResponse.json({
      status: "SUCCESS",
      message: `Successfully saved ${files[specKey]}`,
      parsed,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
