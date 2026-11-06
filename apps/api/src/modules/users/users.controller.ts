import { CreateUserDto, UpdateUserDto, ResetPasswordDto } from './users.dto';
import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Perm } from '../../shared/auth';
import { UsersService } from './users.service';

@Controller()
export class UsersController {
  constructor(private service: UsersService) {}

  @Get('menus')
  menus() {
    return this.service.menus();
  }

  @Get('users')
  @Perm('pengguna', 'read')
  list() {
    return this.service.list();
  }

  @Get('users/:id')
  @Perm('pengguna', 'read')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.service.get(id);
  }

  @Post('users')
  @Perm('pengguna', 'create')
  create(@Body() b: CreateUserDto) {
    return this.service.create(b);
  }

  @Patch('users/:id')
  @Perm('pengguna', 'write')
  update(@Param('id', ParseIntPipe) id: number, @Body() b: UpdateUserDto) {
    return this.service.update(id, b);
  }

  @Post('users/:id/reset-password')
  @Perm('pengguna', 'write')
  reset(@Param('id', ParseIntPipe) id: number, @Body() b: ResetPasswordDto) {
    return this.service.reset(id, b);
  }

  @Post('users/:id/signature')
  @Perm('pengguna', 'write')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024 } }))
  signature(@Param('id', ParseIntPipe) id: number, @UploadedFile() f: Express.Multer.File) {
    return this.service.signature(id, f);
  }

  @Get('groups')
  groups() {
    return this.service.groups();
  }

  @Put('groups/:id/permissions')
  @Perm('pengguna', 'write')
  setPerms(
    @Param('id', ParseIntPipe) id: number,
    @Body() rows: { menu: string; read: boolean; create: boolean; write: boolean; delete: boolean }[],
  ) {
    return this.service.setPerms(id, rows);
  }
}
