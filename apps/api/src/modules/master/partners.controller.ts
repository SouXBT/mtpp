import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { AuthUser, CurrentUser, Perm } from '../../shared/auth';
import { PartnersService } from './partners.service';

@Controller('partners')
export class PartnersController {
  constructor(private service: PartnersService) {}

  @Get()
  list(@CurrentUser() u: AuthUser, @Query() q: any) {
    return this.service.list(u, q);
  }

  @Get(':id')
  get(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.service.get(u, id);
  }

  @Post()
  create(@CurrentUser() u: AuthUser, @Body() b: any) {
    return this.service.create(u, b);
  }

  @Patch(':id')
  update(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() b: any) {
    return this.service.update(u, id, b);
  }

  @Delete(':id')
  remove(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.service.remove(u, id);
  }

  @Post(':id/addresses')
  @Perm('pelanggan', 'write')
  addAddress(@Param('id', ParseIntPipe) id: number, @Body() b: any) {
    return this.service.addAddress(id, b);
  }

  @Patch('addresses/:aid')
  @Perm('pelanggan', 'write')
  editAddress(@Param('aid', ParseIntPipe) aid: number, @Body() b: any) {
    return this.service.editAddress(aid, b);
  }

  @Delete('addresses/:aid')
  @Perm('pelanggan', 'write')
  delAddress(@Param('aid', ParseIntPipe) aid: number) {
    return this.service.delAddress(aid);
  }
}
