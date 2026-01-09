import { Controller, Get } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { ApiOkResponse } from '@nestjs/swagger';

@Controller()
export class AppController {
  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  @Get()
  @ApiOkResponse({
    description: 'List all available endpoints.',
    schema: {
      type: 'object',
      properties: {
        endpoints: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              method: { type: 'string', example: 'GET' },
              path: { type: 'string', example: '/air/{dev_eui}' },
            },
          },
        },
      },
      example: {
        endpoints: [
          { method: 'GET', path: '/' },
          { method: 'GET', path: '/docs' },
        ],
      },
    },
  })
  getHello(): string {// { endpoints: Array<{ method: string; path: string }> } {
    // const httpAdapter = this.httpAdapterHost.httpAdapter;
    // const instance = httpAdapter?.getInstance?.();
    // const stack =
    //   instance?._router?.stack ??
    //   instance?.router?.stack ??
    //   instance?.stack ??
    //   [];
    // const endpoints = this.extractEndpoints(stack);

    return "Its dangerous to go alone! Take this... API documentation at /docs";
  }

  private extractEndpoints(
    stack: Array<{
      route?: { path?: string; methods?: Record<string, boolean> };
      name?: string;
      handle?: { stack?: unknown[] };
      regexp?: { fast_slash?: boolean; source?: string };
      keys?: Array<{ name: string }>;
    }>,
    prefix = '',
  ): Array<{ method: string; path: string }> {
    const endpoints: Array<{ method: string; path: string }> = [];

    for (const layer of stack) {
      if (layer.route?.path && layer.route.methods) {
        const methods = Object.keys(layer.route.methods)
          .filter((method) => layer.route?.methods?.[method])
          .map((method) => method.toUpperCase());
        for (const method of methods) {
          endpoints.push({ method, path: `${prefix}${layer.route.path}` });
        }
        continue;
      }

      if (layer.name === 'router' && layer.handle?.stack) {
        const nextPrefix = `${prefix}${this.getLayerPrefix(layer)}`;
        endpoints.push(...this.extractEndpoints(layer.handle.stack as typeof stack, nextPrefix));
      }
    }

    return endpoints.sort((a, b) =>
      a.path === b.path ? a.method.localeCompare(b.method) : a.path.localeCompare(b.path),
    );
  }

  private getLayerPrefix(layer: {
    regexp?: { fast_slash?: boolean; source?: string };
    keys?: Array<{ name: string }>;
  }): string {
    if (!layer.regexp || layer.regexp.fast_slash) {
      return '';
    }
    const source = (layer.regexp.source ?? '')
      .replace('^\\/', '/')
      .replace('\\/?(?=\\/|$)', '')
      .replace('(?=\\/|$)', '')
      .replace(/\\\//g, '/')
      .replace(/\(\?:\(\[\^\\\/]\+\?\)\)/g, ':param')
      .replace(/\(\[\^\\\/]\+\?\)/g, ':param')
      .replace(/\$$/, '');

    return source === '/' ? '' : source;
  }
}
