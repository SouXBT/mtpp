import { Body, Controller, Get, Patch, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthUser, CurrentUser, Public } from '../../shared/auth';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private service: AuthService) {}

  @Public()
  @Get('config')
  config() {
    return this.service.config();
  }

  @Public()
  @Post('login')
  login(@Body() b: { login: string; password: string }) {
    return this.service.login(b);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.service.me(user);
  }

  @Patch('profile')
  profile(@CurrentUser() user: AuthUser, @Body() b: { name?: string; email?: string; phone?: string }) {
    return this.service.profile(user, b);
  }

  @Post('password')
  password(@CurrentUser() user: AuthUser, @Body() b: { old: string; password: string; confirm: string }) {
    return this.service.password(user, b);
  }

  @Post('signature')
  @UseInterceptors(FileInterceptor('file'))
  signature(@CurrentUser() user: AuthUser, @UploadedFile() file: Express.Multer.File) {
    return this.service.signature(user, file);
  }
}
