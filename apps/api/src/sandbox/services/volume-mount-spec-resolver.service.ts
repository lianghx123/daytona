/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { In, Repository } from 'typeorm'
import { BadRequestError } from '../../exceptions/bad-request.exception'
import { SandboxVolume } from '../dto/sandbox.dto'
import { JuiceFSVolumeBackendConfig, Volume } from '../entities/volume.entity'
import { VolumeBackendType } from '../enums/volume-backend-type.enum'
import { VolumeState } from '../enums/volume-state.enum'
import { VolumeCredentialService } from './volume-credential.service'

export interface RunnerVolumeBackendSpec {
  type: VolumeBackendType
  juicefs?: JuiceFSVolumeBackendConfig
}

export interface RunnerVolumeSpec extends SandboxVolume {
  backend: RunnerVolumeBackendSpec
}

export interface RunnerVolumeMountCredential {
  juicefs?: {
    metaPassword?: string
  }
}

export type RunnerVolumeMountCredentials = Record<string, RunnerVolumeMountCredential>

@Injectable()
export class VolumeMountSpecResolver {
  constructor(
    @InjectRepository(Volume)
    private readonly volumeRepository: Repository<Volume>,
    private readonly volumeCredentialService: VolumeCredentialService,
  ) {}

  async resolve(
    organizationId: string,
    mounts: SandboxVolume[] = [],
  ): Promise<{ volumes: RunnerVolumeSpec[]; volumeMountCredentials?: RunnerVolumeMountCredentials }> {
    if (mounts.length === 0) return { volumes: [] }

    const volumeIds = [...new Set(mounts.map((mount) => mount.volumeId))]
    const volumes = await this.volumeRepository.find({ where: { id: In(volumeIds), organizationId } })
    const byId = new Map(volumes.map((volume) => [volume.id, volume]))

    for (const volumeId of volumeIds) {
      const volume = byId.get(volumeId)
      if (!volume) throw new NotFoundException(`Volume with ID ${volumeId} not found`)
      if (volume.state !== VolumeState.READY) {
        throw new BadRequestError(`Volume '${volume.name}' is not in a ready state. Current state: ${volume.state}`)
      }
    }

    const resolvedVolumes: RunnerVolumeSpec[] = mounts.map((mount) => {
      const volume = byId.get(mount.volumeId)!
      return {
        ...mount,
        backend:
          volume.backendType === VolumeBackendType.JUICEFS
            ? { type: volume.backendType, juicefs: volume.backendConfig as JuiceFSVolumeBackendConfig }
            : { type: VolumeBackendType.MANAGED_S3 },
      }
    })

    const volumeMountCredentials = await this.resolveCredentials(volumes)
    return {
      volumes: resolvedVolumes,
      ...(Object.keys(volumeMountCredentials).length > 0 ? { volumeMountCredentials } : {}),
    }
  }

  async hydrateCredentials(volumeIds: string[]): Promise<RunnerVolumeMountCredentials | undefined> {
    if (volumeIds.length === 0) return undefined
    const volumes = await this.volumeRepository.find({ where: { id: In([...new Set(volumeIds)]) } })
    const credentials = await this.resolveCredentials(volumes)
    return Object.keys(credentials).length > 0 ? credentials : undefined
  }

  private async resolveCredentials(volumes: Volume[]): Promise<RunnerVolumeMountCredentials> {
    const entries = await Promise.all(
      volumes.map(async (volume): Promise<[string, RunnerVolumeMountCredential] | undefined> => {
        if (volume.backendType !== VolumeBackendType.JUICEFS || !volume.credentialRef) return undefined
        const credential = await this.volumeCredentialService.get(volume.credentialRef)
        if (!credential) throw new Error(`Credential for volume ${volume.id} was not found`)
        return [volume.id, { juicefs: { metaPassword: credential.metaPassword } }]
      }),
    )

    return Object.fromEntries(entries.filter((entry): entry is [string, RunnerVolumeMountCredential] => !!entry))
  }
}
