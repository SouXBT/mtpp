import { IsDateLike, IsId, IsNumeric, IsRows, IsText } from '../../shared/validation';

export class ReturnDto {
  @IsId() pickingId!: number;
  @IsDateLike() date?: string;
  @IsText() reason!: string;
  @IsText() resolution!: string;
  @IsText() note?: string;
  @IsRows() lines!: { moveId: number; quantity: number; priceUnit?: number }[];
}

export class ReturnRefundDto {
  @IsNumeric() amount!: number;
  @IsText() method?: 'BNK' | 'KAS';
  @IsDateLike() date?: string;
  @IsText() memo?: string;
}
