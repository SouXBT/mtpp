import { IsDateLike, IsId, IsNumeric, IsRows, IsText } from '../../shared/validation';

export class PaymentDto {
  @IsId() invoiceId?: number;
  @IsId() saleId?: number;
  @IsId() purchaseId?: number;
  @IsNumeric() amount!: number;
  @IsText() method?: 'BNK' | 'KAS';
  @IsDateLike() date?: string;
  @IsText() memo?: string;
  @IsText() kind?: 'dp' | 'lunas';
  @IsDateLike() settleDate?: string;
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

export class InstallmentsDto {
  @IsRows() termins!: { dateDue: string; amount: number }[];
  @IsText() note?: string;
}
