/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { ApiProperty, ApiPropertyOptional, ApiSchema, getSchemaPath } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsEnum, IsInt, IsOptional, IsString, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator'
import { IsSafeDisplayString } from '../../common/validators'
import { VolumeBackendType } from '../enums/volume-backend-type.enum'

export const DEFAULT_JUICEFS_CACHE_SIZE_MIB = 10240

export class JuiceFSVolumeCredentialDto {
  @ApiPropertyOptional({ writeOnly: true, description: 'Password for the JuiceFS metadata engine.' })
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  metaPassword?: string
}

export class CreateVolumeBackendDto {
  @ApiProperty({ enum: VolumeBackendType, enumName: 'VolumeBackendType' })
  @IsEnum(VolumeBackendType)
  type: VolumeBackendType

  @ApiPropertyOptional({ example: 'redis://juicefs-meta:6379/12' })
  @ValidateIf((value: CreateVolumeBackendDto) => value.type === VolumeBackendType.JUICEFS)
  @IsString()
  metaUrl?: string

  @ApiPropertyOptional({
    example: 'https://minio.internal:9000/juicefs-data',
    description: 'Optional object storage URL passed to JuiceFS mount as --bucket.',
  })
  @ValidateIf((value: CreateVolumeBackendDto) => value.type === VolumeBackendType.JUICEFS)
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  bucket?: string

  @ApiPropertyOptional({ default: DEFAULT_JUICEFS_CACHE_SIZE_MIB, minimum: 0 })
  @ValidateIf((value: CreateVolumeBackendDto) => value.type === VolumeBackendType.JUICEFS)
  @IsOptional()
  @IsInt()
  @Min(0)
  cacheSizeMiB?: number

  @ApiPropertyOptional({ type: JuiceFSVolumeCredentialDto, writeOnly: true })
  @ValidateIf((value: CreateVolumeBackendDto) => value.type === VolumeBackendType.JUICEFS)
  @IsOptional()
  @ValidateNested()
  @Type(() => JuiceFSVolumeCredentialDto)
  credential?: JuiceFSVolumeCredentialDto
}

@ApiSchema({ name: 'CreateVolume' })
export class CreateVolumeDto {
  @ApiProperty()
  @IsString()
  @IsSafeDisplayString()
  name: string

  @ApiPropertyOptional({
    oneOf: [{ $ref: getSchemaPath(CreateVolumeBackendDto) }],
    description: 'Storage backend. Omit to create a Daytona-managed S3 volume.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateVolumeBackendDto)
  backend?: CreateVolumeBackendDto
}
