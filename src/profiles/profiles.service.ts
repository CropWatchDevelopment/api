import { Injectable } from '@nestjs/common';
import { CreateProfileDto } from './dto/create-profile.dto';
import { ProfileRepository } from 'src/repositories/profiles.repositories';

@Injectable()
export class ProfilesService {
  constructor(private readonly profilesRepository: ProfileRepository) {}
  findOne() {
    return this.profilesRepository.findById();
  }
}
