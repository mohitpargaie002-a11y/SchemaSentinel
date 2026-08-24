import { createSchemaSentinelServer } from "./app.js";

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

const server = createSchemaSentinelServer();

server.listen(PORT, () => {
  console.log(`================================================================================`);
  console.log(`🛡️  SchemaSentinel Mission Control UI & Server running on http://localhost:${PORT}`);
  console.log(`================================================================================`);
});
