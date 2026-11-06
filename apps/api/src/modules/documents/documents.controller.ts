import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { AuthUser, CurrentUser, Perm } from '../../shared/auth';
import { DocumentsService } from './documents.service';

@Controller('documents')
export class DocumentsController {
  constructor(private service: DocumentsService) {}

  @Get()
  @Perm('dokumen', 'read')
  list(@Query() q: any) {
    return this.service.list(q);
  }

  @Get('next-number')
  @Perm('dokumen', 'read')
  next(@Query('type') type: string, @Query('date') date: string) {
    return this.service.next(type, date);
  }

  @Post('preview')
  @Perm('dokumen', 'read')
  preview(@Body() b: any, @Res() res: Response) {
    return this.service.preview(b, res);
  }

  @Get(':id')
  @Perm('dokumen', 'read')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.service.get(id);
  }

  @Get(':id/pdf')
  @Perm('dokumen', 'read')
  file(@Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    return this.service.file(id, res);
  }

  @Post()
  @Perm('dokumen', 'create')
  create(@CurrentUser() u: AuthUser, @Body() b: any) {
    return this.service.create(u, b);
  }

  @Patch(':id')
  @Perm('dokumen', 'write')
  update(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() b: any) {
    return this.service.update(u, id, b);
  }

  @Post(':id/copy')
  @Perm('dokumen', 'create')
  copy(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.service.copy(u, id);
  }

  @Delete(':id')
  @Perm('dokumen', 'delete')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}
