import { Global, Module } from '@nestjs/common';
import { NumberingService } from './numbering.service';
import { SettingsService } from './settings.service';
import { FilesService } from './files.service';
import { ChatterService } from './chatter.service';
import { PdfService } from './pdf.service';

@Global()
@Module({
  providers: [NumberingService, SettingsService, FilesService, ChatterService, PdfService],
  exports: [NumberingService, SettingsService, FilesService, ChatterService, PdfService],
})
export class SharedModule {}
