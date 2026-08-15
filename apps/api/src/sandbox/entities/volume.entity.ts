/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm'
import { VolumeState } from '../enums/volume-state.enum'
import { VolumeBackendType } from '../enums/volume-backend-type.enum'
import { VolumeLifecycle } from '../enums/volume-lifecycle.enum'

export interface JuiceFSVolumeBackendConfig {
  metaUrl: string
  cacheSizeMiB: number
}

export type VolumeBackendConfig = Record<string, never> | JuiceFSVolumeBackendConfig

@Entity()
@Unique(['organizationId', 'name'])
export class Volume {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({
    nullable: true,
    type: 'uuid',
  })
  organizationId?: string

  @Column()
  name: string

  @Column({
    type: 'enum',
    enum: VolumeState,
    default: VolumeState.PENDING_CREATE,
  })
  state: VolumeState

  @Column({
    type: 'enum',
    enum: VolumeBackendType,
    default: VolumeBackendType.MANAGED_S3,
  })
  backendType: VolumeBackendType

  @Column({
    type: 'enum',
    enum: VolumeLifecycle,
    default: VolumeLifecycle.MANAGED,
  })
  lifecycle: VolumeLifecycle

  @Column({ type: 'jsonb', default: {} })
  backendConfig: VolumeBackendConfig

  @Column({ nullable: true, type: 'uuid' })
  credentialRef?: string | null

  @Column({ nullable: true })
  errorReason?: string

  @CreateDateColumn({
    type: 'timestamp with time zone',
  })
  createdAt: Date

  @UpdateDateColumn({
    type: 'timestamp with time zone',
  })
  updatedAt: Date

  @Column({ nullable: true })
  lastUsedAt?: Date

  public getBucketName(): string {
    return `daytona-volume-${this.id}`
  }
}
