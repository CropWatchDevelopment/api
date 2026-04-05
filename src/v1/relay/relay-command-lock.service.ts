import { ConflictException, Injectable } from '@nestjs/common';

@Injectable()
export class RelayCommandLockService {
  private readonly activeDevices = new Set<string>();

  acquire(devEui: string): () => void {
    if (this.activeDevices.has(devEui)) {
      throw new ConflictException(
        `A relay command is already in progress for device ${devEui}`,
      );
    }

    this.activeDevices.add(devEui);

    return () => {
      this.activeDevices.delete(devEui);
    };
  }
}
