import { Module } from "@nestjs/common";
import { MCPController } from "./mcp.controller";
import { MCPService } from "./mcp.service";

@Module({
  controllers: [MCPController],
  providers: [MCPService],
})
export class MCPModule {}
