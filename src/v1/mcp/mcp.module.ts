import { Module } from '@nestjs/common';
import { McpModule, McpTransportType } from '@rekog/mcp-nest';
import { AuthModule } from '../auth/auth.module';
import { JwtAuthGuard } from '../auth/guards/jwt.auth.guard';
import { DevicesModule } from '../devices/devices.module';
import { DeviceMcpTools } from './tools/devices.tools';

/**
 * Exposes the CropWatch API over the Model Context Protocol (MCP) so MCP clients
 * (Claude Desktop/Code, Cursor, etc.) can call it as tools.
 *
 * - Transport: Streamable HTTP. Clients connect to `POST /mcp`. NOTE: the app
 *   enables global URI versioning (defaultVersion '1'), so the route may be
 *   mounted at `/v1/mcp` — check the "Mapped {...}" line that Nest logs at
 *   startup and point your client at whatever is shown.
 * - Auth: reuses the existing Passport JWT guard. `allowUnauthenticatedAccess`
 *   is left at its default (false), so every tool requires a valid Supabase
 *   bearer token, exactly like the REST controllers.
 *
 * To add more tools: create another `@Injectable()` provider with `@Tool()`
 * methods that delegate to the relevant domain service, import that service's
 * module here, and list the provider in `providers`.
 */
@Module({
  imports: [
    // AuthModule registers the Supabase JWT strategy that populates
    // `request.user`, and exports JwtAuthGuard.
    AuthModule,
    // DevicesModule exports DevicesService, which the device tools delegate to.
    DevicesModule,
    McpModule.forRoot({
      name: 'cropwatch-api',
      version: '1.0.0',
      instructions:
        'CropWatch device monitoring API. Tools are user-scoped: results are limited to whatever the authenticated user is permitted to see.',
      transport: McpTransportType.STREAMABLE_HTTP,
      // Reuse the same JWT guard as the REST API; runs on every MCP request.
      guards: [JwtAuthGuard],
    }),
  ],
  // JwtAuthGuard is dependency-free and relies on the globally-registered 'jwt'
  // strategy (from AuthModule); listing it here guarantees MCP-Nest can resolve it.
  providers: [JwtAuthGuard, DeviceMcpTools],
})
export class CropwatchMcpModule {}
