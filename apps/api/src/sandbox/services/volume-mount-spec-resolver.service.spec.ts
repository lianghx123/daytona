/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { VolumeMountSpecResolver } from './volume-mount-spec-resolver.service'
import { VolumeBackendType } from '../enums/volume-backend-type.enum'
import { VolumeState } from '../enums/volume-state.enum'

describe('VolumeMountSpecResolver', () => {
  it('separates public mount specs from transient credentials', async () => {
    const volume = {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'juicefs-volume',
      organizationId: 'org-1',
      state: VolumeState.READY,
      backendType: VolumeBackendType.JUICEFS,
      backendConfig: { metaUrl: 'redis://metadata:6379/1', cacheSizeMiB: 2048 },
      credentialRef: 'credential-1',
    }
    const repository = { find: jest.fn().mockResolvedValue([volume]) }
    const credentialService = { get: jest.fn().mockResolvedValue({ metaPassword: 'secret' }) }
    const resolver = new VolumeMountSpecResolver(repository as never, credentialService as never)

    const result = await resolver.resolve('org-1', [{ volumeId: volume.id, mountPath: '/data' }])

    expect(result.volumes).toEqual([
      {
        volumeId: volume.id,
        mountPath: '/data',
        backend: { type: VolumeBackendType.JUICEFS, juicefs: volume.backendConfig },
      },
    ])
    expect(result.volumeMountCredentials).toEqual({ [volume.id]: { juicefs: { metaPassword: 'secret' } } })
    expect(JSON.stringify(result.volumes)).not.toContain('secret')
  })
})
