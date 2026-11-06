import { Body, Controller, Get, Param, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { AuthUser, CurrentUser, Perm } from '../../shared/auth';
import { ImporterService } from './importer.service';

@Controller('import')
export class ImporterController {
  constructor(private service: ImporterService) {}

  @Get()
  @Perm('pengaturan', 'read')
  kinds() {
    return this.service.kinds();
  }

  @Get('template/:kind')
  @Perm('pengaturan', 'read')
  template(@Param('kind') kind: string, @Res() res: Response) {
    return this.service.template(kind, res);
  }

  @Post(':kind/preview')
  @Perm('pengaturan', 'create')
  @UseInterceptors(FileInterceptor('file'))
  preview(@Param('kind') kind: string, @UploadedFile() file: Express.Multer.File) {
    return this.service.preview(kind, file);
  }

  @Post(':kind')
  @Perm('pengaturan', 'create')
  @UseInterceptors(FileInterceptor('file'))
  run(
    @CurrentUser() u: AuthUser,
    @Param('kind') kind: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: any,
  ) {
    return this.service.run(u, kind, file, body);
  }
}
