import { IsDateLike, IsId, IsNumeric, IsRows, IsText } from '../../shared/validation';

export class SaveSalesOrderDto {
  @IsId() partnerId?: number;
  @IsId() partnerShippingId?: number;
  @IsId() paymentTermId?: number;
  @IsDateLike() dateOrder?: string;
  @IsDateLike() validityDate?: string;
  @IsDateLike() commitmentDate?: string;
  @IsText() name?: string;
  @IsText() note?: string;
  @IsText() clientOrderRef?: string;
  @IsText() mtppTermPayment?: string;
  @IsText() mtppTermDelivery?: string;
  @IsText() mtppTermValidity?: string;
  @IsText() mtppTermWarranty?: string;
  @IsText() mtppTermHandover?: string;
  @IsText() mtppTermStandard?: string;
  @IsRows() lines?: any[];
}

export class ConfirmSalesOrderDto {
  @IsText() clientOrderRef?: string;
  @IsDateLike() commitmentDate?: string;
}

export class SendSalesOrderDto {
  @IsText() to?: string;
  @IsText() kind?: 'quotation' | 'order' | 'proforma';
}

export class ProformaDto {
  @IsText() mode!: 'persen' | 'nominal' | 'lunas';
  @IsNumeric() percent?: number;
  @IsNumeric() amount?: number;
  @IsText() note?: string;
  @IsDateLike() date?: string;
  @IsDateLike() settleDate?: string;
  @IsNumeric() graceDays?: number;
}

export class ReleaseDto {
  @IsText() note?: string;
}
