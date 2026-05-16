import { Module } from "@nestjs/common";
import { AIModule } from "./ai/ai.module";
import { MCPModule } from "./mcp/mcp.module";

@Module({
  imports: [AIModule, MCPModule],
})
export class AppModule {}
