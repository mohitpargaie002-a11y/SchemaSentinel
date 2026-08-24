import { TargetConfig } from "../domain/contracts.js";

export class TargetNotAllowedError extends Error {
  constructor(message: string) {
    super(`[Target Security Error]: ${message}`);
    this.name = "TargetNotAllowedError";
  }
}

export class TargetRegistry {
  private targets: Map<string, TargetConfig> = new Map();

  constructor() {
    // 1. Explicit allowlisted mutable staging target
    this.registerTarget({
      id: "staging-demo",
      name: "SchemaSentinel Allowlisted Staging DB",
      environment: "staging-demo",
      connectionString: process.env.TARGET_POSTGRES_URL || "postgresql://postgres:postgres@localhost:5432/schemasentinel_staging",
      isAllowed: true,
      mutable: true,
      allowedToApply: true,
      approvalRequired: true,
      provider: "postgres",
    });

    // 2. Demo target (Read-only inspection by default)
    this.registerTarget({
      id: "demo-postgres",
      name: "SchemaSentinel Read-Only Demo DB",
      environment: "staging",
      connectionString: process.env.TARGET_POSTGRES_URL || "postgresql://postgres:postgres@localhost:5432/schemasentinel_demo",
      isAllowed: true,
      mutable: false,
      allowedToApply: false,
      approvalRequired: true,
      provider: "postgres",
    });

    // 3. Ephemeral Sandbox DB
    this.registerTarget({
      id: "sandbox-postgres",
      name: "SchemaSentinel Ephemeral Sandbox DB",
      environment: "sandbox",
      connectionString: "memory://sandbox",
      isAllowed: true,
      mutable: true,
      allowedToApply: true,
      approvalRequired: false,
      provider: "pglite",
    });

    // 4. Production target (STRICTLY NON-MUTABLE / BLOCKED FROM APPLY)
    this.registerTarget({
      id: "prod-postgres",
      name: "Production PostgreSQL (LOCKED)",
      environment: "production",
      connectionString: "postgresql://restricted:restricted@prod-db.internal:5432/production_core",
      isAllowed: true,
      mutable: false,
      allowedToApply: false,
      approvalRequired: true,
      provider: "postgres",
    });
  }

  public registerTarget(config: TargetConfig): void {
    this.targets.set(config.id, config);
  }

  public getTarget(targetId: string): TargetConfig {
    const target = this.targets.get(targetId);
    if (!target || !target.isAllowed) {
      throw new TargetNotAllowedError(`Target '${targetId}' is not registered or not authorized in allowlist.`);
    }
    return target;
  }

  public assertApplyAllowed(targetId: string): TargetConfig {
    const target = this.getTarget(targetId);
    if (!target.mutable || !target.allowedToApply) {
      throw new TargetNotAllowedError(
        `Target '${targetId}' (${target.environment}) is NOT configured for mutation. Only allowlisted staging targets (e.g. 'staging-demo') permit approved DDL execution.`
      );
    }
    return target;
  }

  public listAllowedTargets(): TargetConfig[] {
    return Array.from(this.targets.values()).filter((t) => t.isAllowed);
  }
}

export const defaultTargetRegistry = new TargetRegistry();
