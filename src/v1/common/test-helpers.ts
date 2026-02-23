import { Test, TestingModule } from '@nestjs/testing';
import { Type } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import { TimezoneFormatterService } from './timezone-formatter.service';

/**
 * Creates a testing module with common providers (SupabaseService and TimezoneFormatterService)
 * @param additionalProviders - Additional providers to include in the module
 * @param controllers - Controllers to include in the module
 * @returns Compiled TestingModule
 */
export async function createTestingModuleWithCommonProviders(
  additionalProviders: any[] = [],
  controllers: Type<any>[] = [],
): Promise<TestingModule> {
  const moduleConfig: any = {
    providers: [
      { provide: SupabaseService, useValue: {} },
      TimezoneFormatterService,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      ...additionalProviders,
    ],
  };

  if (controllers.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    moduleConfig.controllers = controllers;
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  return await Test.createTestingModule(moduleConfig).compile();
}
