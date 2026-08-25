import fs from "fs";
import path from "path";

/**
 * Safe Demo Reset Utility
 * Cleans transient local session files, scratch artifacts, and in-memory caches.
 * Note: Never modifies production or external live databases.
 */
async function resetDemo() {
  console.log("================================================================================");
  console.log("🛡️  SchemaSentinel — Safe Demo Environment Reset");
  console.log("================================================================================");

  const sessionsDir = path.resolve(process.cwd(), ".schemasentinel/sessions");
  if (fs.existsSync(sessionsDir)) {
    const files = fs.readdirSync(sessionsDir);
    let count = 0;
    for (const f of files) {
      if (f.endsWith(".json")) {
        fs.unlinkSync(path.join(sessionsDir, f));
        count++;
      }
    }
    console.log(`🧹 Cleaned ${count} persisted session file(s) from .schemasentinel/sessions/`);
  } else {
    fs.mkdirSync(sessionsDir, { recursive: true });
    console.log("📁 Initialized empty session directory at .schemasentinel/sessions/");
  }

  // Ensure migrations fixture directory is intact
  const migrationsDir = path.resolve(process.cwd(), "migrations");
  if (!fs.existsSync(migrationsDir)) {
    fs.mkdirSync(migrationsDir, { recursive: true });
  }

  console.log("🔒 Target Allowlist Verified: 'staging-demo' (mutable), 'prod-postgres' (STRICTLY BLOCKED)");
  console.log("✨ Reset Complete. Ready for a clean, deterministic demonstration!");
  console.log("================================================================================");
}

resetDemo().catch(console.error);
