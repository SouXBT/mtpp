import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { ApiKeysController } from './api-keys.controller';
import { ApiKeysService } from './api-keys.service';

@Module({ controllers: [SettingsController, ApiKeysController], providers: [ApiKeysService] })
export class SettingsModule {}
