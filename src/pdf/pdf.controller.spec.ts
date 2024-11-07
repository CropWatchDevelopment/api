import { Test, TestingModule } from '@nestjs/testing';
import PdfPrinter from 'pdfmake';
import { PdfService } from './pdf.service';
import { DataService } from 'src/data/data.service';
import { ReportsTemplatesService } from 'src/reports_templates/reports_templates.service';

describe('PdfService', () => {
  let pdfService: PdfService;
  let dataService: DataService;
  let reportsTemplatesService: ReportsTemplatesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PdfService,
        {
          provide: DataService,
          useValue: {
            findAll: jest.fn().mockResolvedValue([
              {
                id: 1,
                created_at: '2024-01-01T00:00:00Z',
                dewPointC: 12.5,
                humidity: 45,
                temperatureC: 22.4,
                vpd: 1.2,
                dev_eui: 'test-devEui',
                profile_id: 'profile-123',
              },
            ]),
          },
        },
        {
          provide: ReportsTemplatesService,
          useValue: {
            getReportTemplateByDevEui: jest.fn().mockResolvedValue({
              created_at: '2024-01-01T00:00:00Z',
              dev_eui: 'test-devEui',
              id: 1,
              name: 'Test Report',
              owner_id: 'test-user',
              recipients: 'test@example.com',
              template: {
                content: [
                  {}, // Placeholder for other sections
                  {}, // Placeholder for other sections
                  {
                    table: {
                      headerRows: 1,
                      widths: ['*', '*', '*', '*', '*', '*', '*', '*'],
                      body: [
                        ['Header1', 'Header2', 'Header3', 'Header4', 'Header5', 'Header6', 'Header7', 'Header8'], // Header row
                      ],
                    },
                  },
                ],
              },
            }),
          },
        },
      ],
    }).compile();

    pdfService = module.get<PdfService>(PdfService);
    dataService = module.get<DataService>(DataService);
    reportsTemplatesService = module.get<ReportsTemplatesService>(ReportsTemplatesService);
  });

  it('should be defined', () => {
    expect(pdfService).toBeDefined();
  });

  describe('createPdfBinary', () => {
    it('should create a PDF binary', async () => {
      const mockUserId = 'test-user';
      const mockDevEui = 'test-devEui';

      const pdfBuffer = await pdfService.createPdfBinary(mockUserId, mockDevEui);

      expect(pdfBuffer).toBeDefined();
      expect(Buffer.isBuffer(pdfBuffer)).toBe(true);
      expect(pdfBuffer.length).toBeGreaterThan(0);
      expect(dataService.findAll).toHaveBeenCalledWith(
        { devEui: mockDevEui, skip: 0, take: 10, order: 'ASC' },
        mockUserId,
      );
      expect(reportsTemplatesService.getReportTemplateByDevEui).toHaveBeenCalledWith(mockDevEui);
    });
  });
});
