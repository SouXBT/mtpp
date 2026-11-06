import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { DbModule } from './db/db.module';
import { CommonModule } from './common/common.module';
import { AuthGuard } from './common/auth';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { MasterModule } from './modules/master/master.module';
import { StockModule } from './modules/stock/stock.module';
import { EmailModule } from './modules/email/email.module';
import { SalesModule } from './modules/sales/sales.module';
import { PurchasingModule } from './modules/purchasing/purchasing.module';
import { AccountingModule } from './modules/accounting/accounting.module';
import { BillingModule } from './modules/billing/billing.module';
import { RecordsModule } from './modules/records/records.module';
import { SettingsModule } from './modules/settings/settings.module';
import { ReportsModule } from './modules/reports/reports.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { ImporterModule } from './modules/importer/importer.module';
import { PublicApiModule } from './modules/public-api/public-api.module';
import { DocumentsModule } from './modules/documents/documents.module';

@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET || 'ganti-rahasia-ini',
      signOptions: { expiresIn: '8h' },
    }),
    DbModule,
    CommonModule,
    EmailModule,
    AuthModule,
    UsersModule,
    MasterModule,
    StockModule,
    SalesModule,
    PurchasingModule,
    AccountingModule,
    BillingModule,
    RecordsModule,
    SettingsModule,
    ReportsModule,
    DashboardModule,
    ImporterModule,
    PublicApiModule,
    DocumentsModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
