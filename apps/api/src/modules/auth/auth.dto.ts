import { IsText } from '../../shared/validation';

export class LoginDto {
  @IsText() login!: string;
  @IsText() password!: string;
}

export class ProfileDto {
  @IsText() name?: string;
  @IsText() email?: string;
  @IsText() phone?: string;
}

export class ChangePasswordDto {
  @IsText() old!: string;
  @IsText() password!: string;
  @IsText() confirm!: string;
}
