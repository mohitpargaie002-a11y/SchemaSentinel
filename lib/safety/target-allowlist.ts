import { TargetConfig } from "../domain/contracts.js";

export class TargetNotAllowedError extends Error {
  constructor(targetId: string) {
    super(`[Target Security Error]: Target '${targetId}' is not registered or not authorized.`);
    this.name = "TargetNotAllowedError";
  }
}

export class TargetRegistry {
  private targets: Map<string, TargetConfig> = new Map();

  constructor() {
    // Default allowed demo / staging target
    this.registerTarget({
      id: "demo-postgres",
      name: "SchemaSentinel Staging Demo DB",
      environment: "staging-demo",
      connectionString: process.env.TARGET_POSTGRES_URL || "postgresql://postgres:postgres@localhost:5432/schemasentinel_demo",
      isAllowed: true,
    });

    this.registerTarget({
      id: "sandbox-postgres",
      name: "SchemaSentinel Ephemeral Sandbox DB",
      environment: "sandbox",
      connectionString: "memory://sandbox",
      isAllowed: true,
    });
  }

  public registerTarget(config: TargetConfig): void {
    this.targets.set(config.id, config);
  }

  public getTarget(targetId: string): TargetConfig {
    const target = this.targets.get(targetId);
    if (!target || !target.isAllowed) {
      throw new TargetNotAllowedError(targetId);
    }
    return target;
  }

  public listAllowedTargets(): TargetConfig[] {
    return Array.from(this.targets.values()).filter((t) => t.isAllowed);
  }
}

export const defaultTargetRegistry = new TargetRegistry();
