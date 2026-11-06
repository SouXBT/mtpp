import { IsFilledText, IsId, IsPresentFlag, IsText } from '../../shared/validation';

export class CreateUserDto {
  @IsText() name!: string;
  @IsText() login!: string;
  @IsText() password!: string;
  @IsId() groupId!: number;
}

export class UpdateUserDto {
  @IsFilledText() name?: string;
  @IsFilledText() login?: string;
  @IsPresentFlag() active?: boolean;
  @IsId() groupId?: number;
}

export class ResetPasswordDto {
  @IsText() password!: string;
}
