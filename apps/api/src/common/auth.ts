import {
  CanActivate, ExecutionContext, Injectable, SetMetadata, UnauthorizedException, ForbiddenException,
  createParamDecorator, Inject,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { DB, Db } from '../db/db.module';
import { COST_GROUPS } from './menus';

export type Action = 'read' | 'create' | 'write' | 'delete';
export interface AuthUser {
  id: number; partnerId: number; name: string; login: string; group: string; groupName: string;
  perms: Record<string, { read: boolean; create: boolean; write: boolean; delete: boolean }>;
  canSeeCost: boolean;
}

export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);
export const PERM = 'perm';
export const Perm = (menu: string, action: Action = 'read') => SetMetadata(PERM, { menu, action });
export const CurrentUser = createParamDecorator((_d, ctx: ExecutionContext) => ctx.switchToHttp().getRequest().user as AuthUser);

const cache = new Map<number, { at: number; user: AuthUser }>();
export const clearAuthCache = () => cache.clear();

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private reflector: Reflector, private jwt: JwtService, @Inject(DB) private db: Db) {}

  async loadUser(id: number): Promise<AuthUser> {
    const hit = cache.get(id);
    if (hit && Date.now() - hit.at < 30000) return hit.user;
    const u = await this.db.users.findFirst({ where: { id: id }, include: { partner: true, groups: { include: { group: { include: { permissions: true } } } } } });
    if (!u || !u.active) throw new UnauthorizedException('Akun tidak aktif');
    const g = u.groups[0]?.group;
    const perms: AuthUser['perms'] = {};
    for (const p of g?.permissions || []) perms[p.menu] = { read: p.permRead, create: p.permCreate, write: p.permWrite, delete: p.permDelete };
    const user: AuthUser = {
      id: u.id, partnerId: u.partnerId, name: u.partner?.name || u.login, login: u.login,
      group: g?.code || '', groupName: g?.name || '', perms, canSeeCost: COST_GROUPS.includes(g?.code || ''),
    };
    cache.set(id, { at: Date.now(), user });
    return user;
  }

  async canActivate(ctx: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;
    const req = ctx.switchToHttp().getRequest();
    const h: string = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : (req.query?.token as string);
    if (!token) throw new UnauthorizedException('Silakan login');
    let payload: any;
    try { payload = await this.jwt.verifyAsync(token); } catch { throw new UnauthorizedException('Sesi habis, silakan login lagi'); }
    req.user = await this.loadUser(payload.sub);
    const perm = this.reflector.getAllAndOverride<{ menu: string; action: Action }>(PERM, [ctx.getHandler(), ctx.getClass()]);
    if (perm) {
      const p = req.user.perms[perm.menu];
      if (!p || !p[perm.action]) throw new ForbiddenException('Anda tidak memiliki akses');
    }
    return true;
  }
}

// cek hak akses di dalam service (Algoritma 3.6)
export function checkPerm(user: AuthUser, menu: string, action: Action) {
  const p = user.perms[menu];
  if (!p || !p[action]) throw new ForbiddenException('Anda tidak memiliki akses');
}

// buang kolom rahasia untuk grup yang tidak berhak
const COST_KEYS = ['purchasePrice', 'margin', 'marginPercent', 'costTotal', 'marginTotal'];
export function stripCost<T>(user: AuthUser, data: T): T {
  if (user.canSeeCost || data == null) return data;
  const walk = (o: any): any => {
    if (Array.isArray(o)) return o.map(walk);
    if (o && typeof o === 'object' && !(o instanceof Date)) {
      const r: any = {};
      for (const k of Object.keys(o)) if (!COST_KEYS.includes(k)) r[k] = walk(o[k]);
      return r;
    }
    return o;
  };
  return walk(data);
}

// AturanData (Algoritma 3.6): syarat baris tambahan per grup, misalnya hanya dokumen buatan sendiri.
// Versi pertama tanpa batas baris (keputusan rencana bagian 13), jadi semua grup melihat seluruh data menunya.
export const DATA_RULES: Record<string, Record<string, (u: AuthUser) => any>> = {
  // contoh bila dibutuhkan: SALES: { sales_orders: (u) => { userId: u.id } },
};
export function dataRule(user: AuthUser, table: string) {
  return DATA_RULES[user.group]?.[table]?.(user);
}
