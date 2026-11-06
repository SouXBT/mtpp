import { IsDateLike, IsId, IsRows, IsText } from '../../shared/validation';

export class UpdateTransferDto {
  @IsDateLike() scheduledDate?: string;
  @IsText() note?: string;
  @IsId() partnerId?: number;
  @IsId() warehouseId?: number;
  @IsRows() moves?: any[];
}

export class ValidateTransferDto {
  @IsRows() moves?: any[];
}
