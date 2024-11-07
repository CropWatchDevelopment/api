import { Test, TestingModule } from '@nestjs/testing';
import { ProfilesService } from './profiles.service';
import { ProfileRepository } from 'src/repositories/profiles.repositories';


describe('ProfilesService', () => {
  let service: ProfilesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProfilesService,
        {
          provide: ProfileRepository,
          useValue: {
            // Mock methods here as needed
            findAll: jest.fn(),
            findById: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ProfilesService>(ProfilesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
