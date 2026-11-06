import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { Perm } from '../../shared/auth';
import { ApiKeysService } from './api-keys.service';

@Controller('api-keys')
export class ApiKeysController {
  constructor(private service: ApiKeysService) {}

  @Get()
  @Perm('pengaturan', 'read')
  list() {
    return this.service.list();
  }

  @Post()
  @Perm('pengaturan', 'create')
  create(@Body() b: { name: string }) {
    return this.service.create(b);
  }

  @Patch(':id')
  @Perm('pengaturan', 'write')
  toggle(@Param('id', ParseIntPipe) id: number, @Body() b: { active: boolean }) {
    return this.service.toggle(id, b);
  }

  @Delete(':id')
  @Perm('pengaturan', 'delete')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}
