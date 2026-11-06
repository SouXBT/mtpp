import { IsFlag, IsNumeric, IsText } from '../../shared/validation';

export class CreateUserDto {
  @IsText() name!: string;
  @IsText() login!: string;
  @IsText() password!: string;
  @IsNumeric() groupId!: number;
}

export class UpdateUserDto {
  @IsText() name?: string;
  @IsText() login?: string;
  @IsFlag() active?: boolean;
  @IsNumeric() groupId?: number;
}

export class ResetPasswordDto {
  @IsText() password!: string;
}
