import { Controller, Get } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../../shared/auth';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private service: DashboardService) {}

  @Get()
  get(@CurrentUser() u: AuthUser) {
    return this.service.get(u);
  }
}
