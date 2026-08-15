/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { VolumeDto } from './volume.dto'
import { Volume } from '../entities/volume.entity'
import { VolumeBackendType } from '../enums/volume-backend-type.enum'
import { VolumeLifecycle } from '../enums/volume-lifecycle.enum'
import { VolumeState } from '../enums/volume-state.enum'

describe('VolumeDto', () => {
  it('returns sanitized JuiceFS configuration without credential references', () => {
    const volume = Object.assign(new Volume(), {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'juicefs-volume',
      organizationId: '00000000-0000-0000-0000-000000000002',
      state: VolumeState.READY,
      backendType: VolumeBackendType.JUICEFS,
      lifecycle: VolumeLifecycle.EXTERNAL,
      backendConfig: { metaUrl: 'redis://metadata:6379/1', cacheSizeMiB: 2048 },
      credentialRef: '00000000-0000-0000-0000-000000000003',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    })

    const dto = VolumeDto.fromVolume(volume)

    expect(dto.backend).toEqual({
      type: VolumeBackendType.JUICEFS,
      metaUrl: 'redis://metadata:6379/1',
      cacheSizeMiB: 2048,
    })
    expect(JSON.stringify(dto)).not.toContain('credential')
  })
})
