import { IsDateLike, IsNumeric, IsText } from '../../shared/validation';

export class PaymentDto {
  @IsNumeric() invoiceId?: number;
  @IsNumeric() saleId?: number;
  @IsNumeric() purchaseId?: number;
  @IsNumeric() amount!: number;
  @IsText() method?: 'BNK' | 'KAS';
  @IsDateLike() date?: string;
  @IsText() memo?: string;
}

export class InvoiceSourceDto {
  @IsDateLike() date?: string;
  @IsNumeric() dueDays?: number;
  @IsText() ref?: string;
  @IsNumeric() amount!: number;
  @IsText() memo?: string;
}

export class SendInvoiceDto {
  @IsText() to?: string;
}
