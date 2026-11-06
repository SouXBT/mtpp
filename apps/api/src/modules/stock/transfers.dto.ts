import { IsDateLike, IsNumeric, IsRows, IsText } from '../../shared/validation';

export class UpdateTransferDto {
  @IsDateLike() scheduledDate?: string;
  @IsText() note?: string;
  @IsNumeric() partnerId?: number;
  @IsNumeric() warehouseId?: number;
  @IsRows() moves?: any[];
}

export class ValidateTransferDto {
  @IsRows() moves?: any[];
}
