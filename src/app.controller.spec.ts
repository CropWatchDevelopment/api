import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { join } from 'path';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should serve the API homepage (index.html)', () => {
      const sendFile = jest.fn();
      appController.getHello({ sendFile } as any);
      expect(sendFile).toHaveBeenCalledWith(
        join(process.cwd(), 'static', 'index.html'),
      );
    });
  });
});
