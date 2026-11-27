import { IsDateLike, IsFlag, IsRows, IsText } from '../../shared/validation';

export class UpdatePurchaseOrderDto {
  @IsDateLike() datePlanned?: string;
  @IsText() note?: string;
  @IsRows() lines?: any[];
}

export class SendPurchaseOrderDto {
  @IsText() to?: string;
}

// waive: konfirmasi tanpa uang muka kepada principal (pengecualian Pimpinan), note: alasannya
export class ConfirmPurchaseOrderDto {
  @IsFlag() waive?: boolean;
  @IsText() note?: string;
}
