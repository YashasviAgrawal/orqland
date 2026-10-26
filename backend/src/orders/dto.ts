import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { FulfilmentType, PaymentMethod } from '../domain/enums';
import { VIEWS } from './order-query.service';

const FULFILMENT_TYPES = Object.values(FulfilmentType);
const PAYMENT_METHODS = Object.values(PaymentMethod);

export class ListOrdersQuery {
  @ApiPropertyOptional({ enum: VIEWS, description: 'Dashboard card / tab' })
  @IsOptional()
  @IsIn(VIEWS as unknown as string[])
  view?: (typeof VIEWS)[number];

  @ApiPropertyOptional({ enum: ['PRODUCT', 'SERVICE'] })
  @IsOptional()
  @IsIn(['PRODUCT', 'SERVICE'])
  kind?: 'PRODUCT' | 'SERVICE';

  @ApiPropertyOptional({ description: 'Comma-separated fulfilment types' })
  @IsOptional()
  @IsString()
  fulfilmentType?: string;

  @ApiPropertyOptional({ description: 'Comma-separated order statuses' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ enum: ['PENDING', 'PAID', 'FAILED'] })
  @IsOptional()
  @IsIn(['PENDING', 'PAID', 'FAILED'])
  paymentStatus?: string;

  @ApiPropertyOptional({ description: 'Search by order ID, customer name/phone or item' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ example: '2026-10-26' })
  @IsOptional()
  @IsString()
  dateFrom?: string;

  @ApiPropertyOptional({ example: '2026-10-31' })
  @IsOptional()
  @IsString()
  dateTo?: string;

  @ApiPropertyOptional({ enum: ['created', 'scheduled'] })
  @IsOptional()
  @IsIn(['created', 'scheduled'])
  dateField?: 'created' | 'scheduled';

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export class ActionDto {
  @ApiProperty({ example: 'ACCEPT', description: 'Action code from the order’s `actions` list' })
  @IsString()
  @MaxLength(64)
  action: string;

  @ApiPropertyOptional({ description: 'Inputs required by the action (see the action’s `fields`)' })
  @IsOptional()
  @IsObject()
  input?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Optimistic concurrency: the order `version` the user was looking at' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  expectedVersion?: number;
}

export class BulkAcceptDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  orderIds: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  startPreparation?: boolean;
}

export class OrderItemDto {
  @ApiProperty()
  @IsUUID()
  listingId: string;

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  quantity: number;
}

export class CustomerDto {
  @ApiProperty() @IsString() @MaxLength(120) name: string;
  @ApiProperty() @IsString() @MaxLength(30) phone: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) address?: string;
}

export class EventDetailsDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) venue?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000) guests?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) occasion?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) requirements?: string;
}

export class CreateOrderDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() customerId?: string;

  @ApiPropertyOptional({ type: CustomerDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CustomerDto)
  customer?: CustomerDto;

  @ApiProperty({ enum: FULFILMENT_TYPES })
  @IsIn(FULFILMENT_TYPES)
  fulfilmentType: FulfilmentType;

  @ApiProperty({ type: [OrderItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items: OrderItemDto[];

  @ApiProperty({ enum: PAYMENT_METHODS })
  @IsIn(PAYMENT_METHODS)
  paymentMethod: PaymentMethod;

  @ApiPropertyOptional() @IsOptional() @IsUUID() slotId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() scheduledStart?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) deliveryAddress?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() deliveryLat?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() deliveryLng?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) note?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) tableNumber?: string;

  @ApiPropertyOptional({ type: EventDetailsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => EventDetailsDto)
  eventDetails?: EventDetailsDto;
}

export class ScopeQuery {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  scope?: string;
}

export const toList = (v?: string) =>
  v
    ? v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;
