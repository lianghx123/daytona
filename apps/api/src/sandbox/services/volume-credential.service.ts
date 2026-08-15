/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { EntityManager, Repository } from 'typeorm'
import { EncryptionService } from '../../encryption/encryption.service'
import { VolumeCredential } from '../entities/volume-credential.entity'

export interface VolumeCredentialPayload {
  metaPassword?: string
}

@Injectable()
export class VolumeCredentialService {
  constructor(
    @InjectRepository(VolumeCredential)
    private readonly credentialRepository: Repository<VolumeCredential>,
    private readonly encryptionService: EncryptionService,
  ) {}

  async create(payload: VolumeCredentialPayload, manager?: EntityManager): Promise<VolumeCredential> {
    const repository = manager ? manager.getRepository(VolumeCredential) : this.credentialRepository
    const credential = repository.create({
      encryptedPayload: await this.encryptionService.encrypt(JSON.stringify(payload)),
    })
    return repository.save(credential)
  }

  async get(credentialRef?: string): Promise<VolumeCredentialPayload | undefined> {
    if (!credentialRef) return undefined

    const credential = await this.credentialRepository.findOneBy({ id: credentialRef })
    if (!credential) return undefined

    const decrypted = await this.encryptionService.decrypt(credential.encryptedPayload)
    return JSON.parse(decrypted) as VolumeCredentialPayload
  }

  async delete(credentialRef?: string, manager?: EntityManager): Promise<void> {
    if (!credentialRef) return
    const repository = manager ? manager.getRepository(VolumeCredential) : this.credentialRepository
    await repository.delete(credentialRef)
  }
}
