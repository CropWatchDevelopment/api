import type { Request } from 'express';
import { Injectable } from '@nestjs/common';
import { Tool, type Context } from '@rekog/mcp-nest';
import { z } from 'zod';
import { DevicesService } from '../../devices/devices.service';

// The MCP module applies JwtAuthGuard, which puts the Supabase JWT payload on
// `request.user`. The domain services also need the raw Authorization header so
// their Supabase client stays RLS-scoped to the caller — same contract the REST
// controllers use (`devicesService.findAll(req.user, req.headers.authorization, ...)`).
type AuthedRequest = Request & { user: any };

/**
 * Read-only MCP tools over device data.
 *
 * Each tool delegates to the same DevicesService the REST controllers use, so
 * business logic and Supabase RLS scoping are never duplicated here.
 */
@Injectable()
export class DeviceMcpTools {
  constructor(private readonly devicesService: DevicesService) {}

  @Tool({
    name: 'list_devices',
    description:
      'List the devices the authenticated user can access. Supports optional ' +
      'pagination and name/group/location filters. Returns a paginated payload ' +
      'with the total count and the matching devices.',
    parameters: z.object({
      skip: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe('Number of records to skip for pagination (default 0).'),
      take: z
        .number()
        .int()
        .min(1)
        .max(1000)
        .optional()
        .describe('Maximum number of devices to return (default 100, max 1000).'),
      name: z
        .string()
        .optional()
        .describe('Filter by device name or dev_eui (case-insensitive contains).'),
      group: z
        .string()
        .optional()
        .describe('Filter by device group (case-insensitive contains).'),
      location: z
        .string()
        .optional()
        .describe('Filter by device location (case-insensitive contains).'),
    }),
    annotations: {
      title: 'List Devices',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  })
  async listDevices(
    { skip, take, name, group, location },
    _context: Context,
    request: AuthedRequest,
  ) {
    const authHeader = request.headers.authorization ?? '';
    const result = await this.devicesService.findAll(
      request.user,
      authHeader,
      skip ?? 0,
      take ?? 100,
      group,
      name,
      location,
    );
    return this.json(result);
  }

  @Tool({
    name: 'get_device',
    description:
      'Get a single device the authenticated user can access, by its dev_eui.',
    parameters: z.object({
      dev_eui: z
        .string()
        .min(1, 'dev_eui is required')
        .describe('The device EUI to look up.'),
    }),
    annotations: {
      title: 'Get Device',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  })
  async getDevice(
    { dev_eui },
    _context: Context,
    request: AuthedRequest,
  ) {
    const authHeader = request.headers.authorization ?? '';
    const device = await this.devicesService.findOne(
      request.user,
      dev_eui,
      authHeader,
    );
    return this.json(device);
  }

  /** Wrap any serializable value as an MCP text-content result. */
  private json(value: unknown) {
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
    };
  }
}
