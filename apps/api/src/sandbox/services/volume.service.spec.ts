/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { Organization } from '../../organization/entities/organization.entity'
import { VolumeBackendType } from '../enums/volume-backend-type.enum'
import * as connectivity from '../utils/juicefs-connectivity.util'
import { VolumeService } from './volume.service'

describe('VolumeService JuiceFS creation', () => {
  afterEach(() => jest.restoreAllMocks())

  it('rejects an unreachable backend before quota or database state is changed', async () => {
    const volumeRepository = {}
    const sandboxRepository = {}
    const organizationService = { assertOrganizationIsNotSuspended: jest.fn() }
    const organizationUsageService = {
      incrementPendingVolumeUsage: jest.fn(),
      getVolumeUsageOverview: jest.fn(),
      decrementPendingVolumeUsage: jest.fn(),
    }
    const configService = { get: jest.fn() }
    const redisLockProvider = {}
    const dataSource = { transaction: jest.fn() }
    const volumeCredentialService = { create: jest.fn() }
    const service = new VolumeService(
      volumeRepository as never,
      sandboxRepository as never,
      organizationService as never,
      organizationUsageService as never,
      configService as never,
      redisLockProvider as never,
      dataSource as never,
      volumeCredentialService as never,
    )
    jest.spyOn(connectivity, 'probeJuiceFSEndpoint').mockRejectedValue(new Error('unreachable'))

    await expect(
      service.create({ id: 'organization-id' } as Organization, {
        name: 'juicefs-volume',
        backend: {
          type: VolumeBackendType.JUICEFS,
          metaUrl: 'redis://metadata:6379/1',
          bucket: 'https://storage.example.com/bucket',
          credential: { metaPassword: 'secret' },
        },
      }),
    ).rejects.toThrow('unreachable')

    expect(organizationUsageService.incrementPendingVolumeUsage).not.toHaveBeenCalled()
    expect(organizationUsageService.decrementPendingVolumeUsage).not.toHaveBeenCalled()
    expect(dataSource.transaction).not.toHaveBeenCalled()
    expect(volumeCredentialService.create).not.toHaveBeenCalled()
  })
})
