import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { AuthUser, CurrentUser } from '../../shared/auth';
import { RecordsService } from './records.service';

@Controller()
export class RecordsController {
  constructor(private service: RecordsService) {}

  @Get('records/:model/:id/messages')
  messages(@CurrentUser() u: AuthUser, @Param('model') model: string, @Param('id', ParseIntPipe) id: number) {
    return this.service.messages(u, model, id);
  }

  @Post('records/:model/:id/messages')
  note(
    @CurrentUser() u: AuthUser,
    @Param('model') model: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() b: { body: string },
  ) {
    return this.service.note(u, model, id, b);
  }

  @Get('records/:model/:id/attachments')
  attachments(@CurrentUser() u: AuthUser, @Param('model') model: string, @Param('id', ParseIntPipe) id: number) {
    return this.service.attachments(u, model, id);
  }

  @Post('records/:model/:id/attachments')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  upload(
    @CurrentUser() u: AuthUser,
    @Param('model') model: string,
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() f: Express.Multer.File,
  ) {
    return this.service.upload(u, model, id, f);
  }

  @Get('attachments/:id/download')
  download(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    return this.service.download(u, id, res);
  }

  @Delete('attachments/:id')
  removeAttachment(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.service.removeAttachment(u, id);
  }

  @Get('activities')
  activities(@CurrentUser() u: AuthUser, @Query() q: any) {
    return this.service.activities(u, q);
  }

  @Post('activities')
  createActivity(@CurrentUser() u: AuthUser, @Body() b: any) {
    return this.service.createActivity(u, b);
  }

  @Patch('activities/:id')
  updateActivity(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() b: any) {
    return this.service.updateActivity(u, id, b);
  }

  @Delete('activities/:id')
  removeActivity(@Param('id', ParseIntPipe) id: number) {
    return this.service.removeActivity(id);
  }

  @Get('saved-filters')
  filters(@CurrentUser() u: AuthUser, @Query('resource') resource: string) {
    return this.service.filters(u, resource);
  }

  @Post('saved-filters')
  saveFilter(@CurrentUser() u: AuthUser, @Body() b: { resource: string; name: string; filter: any }) {
    return this.service.saveFilter(u, b);
  }

  @Delete('saved-filters/:id')
  removeFilter(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.service.removeFilter(u, id);
  }
}
