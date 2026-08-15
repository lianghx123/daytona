/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { CreateVolumeDto, DEFAULT_JUICEFS_CACHE_SIZE_MIB } from './create-volume.dto'
import { VolumeBackendType } from '../enums/volume-backend-type.enum'

describe('CreateVolumeDto', () => {
  it('keeps managed S3 creation backward compatible', async () => {
    const dto = plainToInstance(CreateVolumeDto, { name: 'managed-volume' })
    expect(await validate(dto)).toHaveLength(0)
    expect(dto.backend).toBeUndefined()
  })

  it('accepts a JuiceFS backend and optional credential', async () => {
    const dto = plainToInstance(CreateVolumeDto, {
      name: 'juicefs-volume',
      backend: {
        type: VolumeBackendType.JUICEFS,
        metaUrl: 'redis://metadata:6379/1',
        cacheSizeMiB: DEFAULT_JUICEFS_CACHE_SIZE_MIB,
        credential: { metaPassword: 'secret' },
      },
    })

    expect(await validate(dto)).toHaveLength(0)
    expect(dto.backend?.credential?.metaPassword).toBe('secret')
  })

  it.each([-1, 1.5])('rejects invalid cache size %s', async (cacheSizeMiB) => {
    const dto = plainToInstance(CreateVolumeDto, {
      name: 'juicefs-volume',
      backend: { type: VolumeBackendType.JUICEFS, metaUrl: 'redis://metadata:6379/1', cacheSizeMiB },
    })

    expect(await validate(dto)).not.toHaveLength(0)
  })
})
