import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { parseDocument } from "yaml";

const directory = fileURLToPath(new URL("../../.github/workflows/", import.meta.url));
const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
let scripts = 0;
for (const file of readdirSync(directory).filter((name) => name.endsWith(".yml"))) {
  const document = parseDocument(readFileSync(`${directory}/${file}`, "utf8"), {
    uniqueKeys: true,
  });
  if (document.errors.length)
    throw new Error(`${file}: ${document.errors.map((e) => e.message).join("; ")}`);
  const workflow = document.toJS();
  for (const [name, job] of Object.entries(workflow.jobs)) {
    for (const dependency of typeof job.needs === "string" ? [job.needs] : (job.needs ?? [])) {
      if (!workflow.jobs[dependency])
        throw new Error(`${file}/${name}: unknown dependency ${dependency}`);
    }
    for (const step of job.steps ?? []) {
      if (!step.run || step.shell === "pwsh" || step.shell === "powershell") continue;
      if (!step.shell && typeof job["runs-on"] === "string" && job["runs-on"].startsWith("windows"))
        continue;
      const result = spawnSync(bash, ["-n"], {
        input: step.run.replace(/\$\{\{.*?\}\}/g, "expression"),
        encoding: "utf8",
      });
      if (result.status !== 0)
        throw new Error(`${file}/${name}/${step.name ?? "run"}: ${result.stderr || result.error}`);
      scripts++;
    }
  }
}
console.log(`Workflow structure and ${scripts} shell blocks validated`);
