import { Body, Controller, Headers, Post, UnauthorizedException } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { timingSafeEqual } from 'crypto';
import { Public } from '../common/auth/decorators';
import { config } from '../config';
import { PaymentsService } from './payments.service';

class WebhookDto {
  @IsOptional() @IsUUID() orderId?: string;
  @IsString() @MaxLength(120) reference: string;
  @IsIn(['SUCCEEDED', 'FAILED']) status: 'SUCCEEDED' | 'FAILED';
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
}

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  /**
   * Payment provider webhook (sample provider). Replace the shared-secret check with the
   * gateway's signature verification when the gateway is integrated.
   */
  @Public()
  @Post('webhook')
  @ApiHeader({ name: 'X-Webhook-Secret', required: true })
  @ApiOperation({ summary: 'Verified payment result from the payment provider' })
  webhook(@Headers('x-webhook-secret') secret: string | undefined, @Body() body: WebhookDto) {
    const a = Buffer.from(secret ?? '');
    const b = Buffer.from(config.paymentWebhookSecret);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new UnauthorizedException('Invalid webhook signature');
    return this.payments.handleEvent(body);
  }
}
