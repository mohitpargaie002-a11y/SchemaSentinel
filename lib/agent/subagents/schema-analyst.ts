import { IPostgresMcpService } from "../../mcp/postgres.js";
import { SchemaAnalysisResult, SchemaSnapshot, TableMetadata } from "../../domain/contracts.js";

export interface ISchemaAnalystSubagent {
  analyzeSchema(
    targetId: string,
    affectedTables: string[]
  ): Promise<{
    snapshot: SchemaSnapshot;
    analysis: SchemaAnalysisResult;
  }>;
}

export class SchemaAnalystSubagent implements ISchemaAnalystSubagent {
  private postgresMcp: IPostgresMcpService;

  constructor(postgresMcp: IPostgresMcpService) {
    this.postgresMcp = postgresMcp;
  }

  /**
   * Introspects target schema via read-only Postgres MCP tool.
   * Extracts table topology, index count, foreign key constraints, and volume estimates.
   * MUST NOT perform any mutations.
   */
  public async analyzeSchema(
    targetId: string,
    affectedTables: string[]
  ): Promise<{
    snapshot: SchemaSnapshot;
    analysis: SchemaAnalysisResult;
  }> {
    const snapshot = await this.postgresMcp.inspectSchema(targetId);

    const affectedSet = new Set(affectedTables.map((t) => t.toLowerCase()));
    const affectedTableDetails: TableMetadata[] = snapshot.tables.filter((t) =>
      affectedSet.has(t.tableName.toLowerCase())
    );

    let totalIndexCount = 0;
    const volumeEstimates: Record<string, number> = {};
    const foreignKeyDependencies: Array<{
      sourceTable: string;
      sourceColumn: string;
      targetTable: string;
      targetColumn: string;
    }> = [];

    for (const table of snapshot.tables) {
      totalIndexCount += table.indexes.length;
      volumeEstimates[table.tableName] = table.estimatedRows ?? 0;

      for (const fk of table.foreignKeys) {
        foreignKeyDependencies.push({
          sourceTable: table.tableName,
          sourceColumn: fk.column,
          targetTable: fk.foreignTable,
          targetColumn: fk.foreignColumn,
        });
      }
    }

    const tableNames = snapshot.tables.map((t) => t.tableName).join(", ");
    const summary = `Schema Analyst: Introspected ${snapshot.tables.length} tables (${tableNames}) with ${totalIndexCount} indexes. Analyzed ${affectedTableDetails.length} affected tables.`;

    const analysis: SchemaAnalysisResult = {
      targetId,
      timestamp: new Date().toISOString(),
      tableCount: snapshot.tables.length,
      totalIndexCount,
      affectedTables: Array.from(affectedSet),
      affectedTableDetails,
      foreignKeyDependencies,
      volumeEstimates,
      summary,
    };

    return { snapshot, analysis };
  }
}
