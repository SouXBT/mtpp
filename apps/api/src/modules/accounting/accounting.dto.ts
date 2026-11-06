import { IsDateLike, IsFlag, IsNumeric, IsRows, IsText } from '../../shared/validation';

export class JournalEntryDto {
  @IsDateLike() date?: string;
  @IsText() ref?: string;
  @IsText() journal?: string;
  @IsRows() lines!: { accountId: number; debit?: number; credit?: number; name?: string; partnerId?: number }[];
  @IsFlag() post?: boolean;
}

export class CashDto {
  @IsText() type!: 'in' | 'out';
  @IsNumeric() accountId!: number;
  @IsNumeric() amount!: number;
  @IsDateLike() date?: string;
  @IsText() memo!: string;
  @IsNumeric() partnerId?: number;
}

export class MatchBankLineDto {
  @IsNumeric() paymentId!: number;
}
