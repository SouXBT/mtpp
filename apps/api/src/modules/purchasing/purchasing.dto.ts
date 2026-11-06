import { IsDateLike, IsRows, IsText } from '../../shared/validation';

export class UpdatePurchaseOrderDto {
  @IsDateLike() datePlanned?: string;
  @IsText() note?: string;
  @IsRows() lines?: any[];
}

export class SendPurchaseOrderDto {
  @IsText() to?: string;
}
