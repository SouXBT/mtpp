import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

// Galat database karena isian (data terkait tidak ada, teks terlalu panjang, angka di luar batas, tipe salah)
// dijawab 400 dengan pesan yang bisa dibaca, bukan 500. Galat lain tetap 500 dan dicatat.
const KNOWN: Record<string, [number, string]> = {
  P2000: [400, 'Isian terlalu panjang untuk kolomnya'],
  P2002: [400, 'Data yang sama sudah ada'],
  P2003: [400, 'Data terkait tidak ditemukan atau masih dipakai data lain'],
  P2005: [400, 'Isian tidak sesuai tipe kolomnya'],
  P2006: [400, 'Isian tidak sesuai tipe kolomnya'],
  P2007: [400, 'Isian tidak valid'],
  P2011: [400, 'Kolom wajib belum diisi'],
  P2020: [400, 'Angka di luar batas yang diperbolehkan'],
  P2025: [404, 'Data tidak ditemukan'],
};

@Catch()
export class AppErrorFilter implements ExceptionFilter {
  private log = new Logger('Galat');
  catch(e: any, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    if (e instanceof HttpException) {
      const r = e.getResponse();
      return res.status(e.getStatus()).json(typeof r === 'string' ? { statusCode: e.getStatus(), message: r } : r);
    }
    let status = 500,
      message = 'Terjadi kesalahan pada server';
    if (e instanceof Prisma.PrismaClientKnownRequestError && KNOWN[e.code]) [status, message] = KNOWN[e.code];
    else if (e instanceof Prisma.PrismaClientValidationError) [status, message] = [400, 'Isian tidak valid'];
    // galat Postgres yang dibungkus adapter: angka meluap, tanggal atau teks tidak valid
    else if (/numeric field overflow|out of range|invalid input syntax|value too long/i.test(String(e?.message)))
      [status, message] = [400, 'Isian tidak valid atau di luar batas'];
    if (status === 500) this.log.error(e?.stack || e);
    res.status(status).json({ statusCode: status, message });
  }
}
