#!/usr/bin/env tsx
/**
 * Quick smoke test - sets up a project and verifies RTM connection
 */

import { loadConfig, RtmClient } from "../src/rtm-client.js";
import { ProjectManager } from "../src/project-manager.js";

const projectName = process.argv[2] || "milk-mcp";

async function main() {
  console.log(`\n🥛 Smoke testing milk-mcp with project: ${projectName}\n`);

  // Load config
  console.log("1. Loading config...");
  const config = loadConfig();
  console.log("   ✅ Config loaded\n");

  // Create client
  console.log("2. Creating RTM client...");
  const client = new RtmClient(config);
  const lists = await client.getLists();
  console.log(`   ✅ Connected - found ${lists.length} lists\n`);

  // Setup project
  console.log(`3. Setting up project "${projectName}"...`);
  const pm = new ProjectManager(client);
  const { created, skipped } = await pm.setupProject(projectName);
  if (created.length) console.log(`   ✅ Created: ${created.join(", ")}`);
  if (skipped.length) console.log(`   ⏭️  Skipped (already exist): ${skipped.join(", ")}`);
  console.log("");

  // Read context
  console.log("4. Reading context...");
  const context = await pm.readContext(projectName);
  console.log(`   Context: ${context ?? "(none yet)"}\n`);

  // Get todos
  console.log("5. Getting TODOs...");
  const todos = await pm.getTodos(projectName);
  console.log(`   Found ${todos.length} open TODO(s)\n`);

  // Write a test context
  console.log("6. Writing test context...");
  await pm.writeContext(projectName, `Smoke test completed at ${new Date().toISOString()}`);
  console.log("   ✅ Context written\n");

  // Verify
  console.log("7. Verifying context...");
  const newContext = await pm.readContext(projectName);
  console.log(`   Context: ${newContext}\n`);

  console.log("🎉 Smoke test passed!\n");
}

main().catch((err) => {
  console.error("❌ Smoke test failed:", err);
  process.exit(1);
});
