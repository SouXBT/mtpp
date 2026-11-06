import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { DB, Db } from '../../db/db.module';
import { hashKey } from '../settings/api-keys.service';

// REST API untuk aplikasi lain: hanya baca, memakai header X-API-Key
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(@Inject(DB) private db: Db) {}
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const key = req.headers['x-api-key'];
    if (!key) throw new UnauthorizedException('Header X-API-Key wajib diisi');
    const k = await this.db.apiKeys.findFirst({ where: { keyHash: hashKey(String(key)) } });
    if (!k || !k.active) throw new UnauthorizedException('API key tidak valid');
    await this.db.apiKeys.updateMany({ where: { id: k.id }, data: { lastUsed: new Date() } });
    return true;
  }
}
