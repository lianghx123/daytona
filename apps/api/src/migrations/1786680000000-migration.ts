/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { MigrationInterface, QueryRunner } from 'typeorm'

export class Migration1786680000000 implements MigrationInterface {
  name = 'Migration1786680000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "public"."volume_backend_type_enum" AS ENUM('managed_s3', 'juicefs')`)
    await queryRunner.query(`CREATE TYPE "public"."volume_lifecycle_enum" AS ENUM('managed', 'external')`)
    await queryRunner.query(
      `CREATE TABLE "volume_credential" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "encryptedPayload" text NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "volume_credential_id_pk" PRIMARY KEY ("id"))`,
    )
    await queryRunner.query(
      `ALTER TABLE "volume" ADD "backendType" "public"."volume_backend_type_enum" NOT NULL DEFAULT 'managed_s3'`,
    )
    await queryRunner.query(
      `ALTER TABLE "volume" ADD "lifecycle" "public"."volume_lifecycle_enum" NOT NULL DEFAULT 'managed'`,
    )
    await queryRunner.query(`ALTER TABLE "volume" ADD "backendConfig" jsonb NOT NULL DEFAULT '{}'`)
    await queryRunner.query(`ALTER TABLE "volume" ADD "credentialRef" uuid`)
    await queryRunner.query(
      `ALTER TABLE "volume" ADD CONSTRAINT "volume_credentialRef_unique" UNIQUE ("credentialRef")`,
    )
    await queryRunner.query(
      `ALTER TABLE "volume" ADD CONSTRAINT "volume_credentialRef_fk" FOREIGN KEY ("credentialRef") REFERENCES "volume_credential"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    )
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "volume" DROP CONSTRAINT "volume_credentialRef_fk"`)
    await queryRunner.query(`ALTER TABLE "volume" DROP CONSTRAINT "volume_credentialRef_unique"`)
    await queryRunner.query(`ALTER TABLE "volume" DROP COLUMN "credentialRef"`)
    await queryRunner.query(`ALTER TABLE "volume" DROP COLUMN "backendConfig"`)
    await queryRunner.query(`ALTER TABLE "volume" DROP COLUMN "lifecycle"`)
    await queryRunner.query(`ALTER TABLE "volume" DROP COLUMN "backendType"`)
    await queryRunner.query(`DROP TABLE "volume_credential"`)
    await queryRunner.query(`DROP TYPE "public"."volume_lifecycle_enum"`)
    await queryRunner.query(`DROP TYPE "public"."volume_backend_type_enum"`)
  }
}
