// Copyright 2025 Daytona Platforms Inc.
// SPDX-License-Identifier: AGPL-3.0

package dto

const (
	VolumeBackendManagedS3 = "managed_s3"
	VolumeBackendJuiceFS   = "juicefs"
)

type JuiceFSVolumeSourceDTO struct {
	MetaURL      string `json:"metaUrl" validate:"required"`
	CacheSizeMiB int64  `json:"cacheSizeMiB,omitempty" validate:"min=0"`
}

type VolumeBackendDTO struct {
	Type    string                  `json:"type" validate:"required,oneof=managed_s3 juicefs"`
	JuiceFS *JuiceFSVolumeSourceDTO `json:"juicefs,omitempty"`
}

type JuiceFSVolumeMountCredentialDTO struct {
	MetaPassword string `json:"metaPassword,omitempty"`
}

type VolumeMountCredentialDTO struct {
	JuiceFS *JuiceFSVolumeMountCredentialDTO `json:"juicefs,omitempty"`
}

type VolumeMountCredentialsDTO map[string]VolumeMountCredentialDTO

type VolumeDTO struct {
	VolumeId  string            `json:"volumeId"`
	MountPath string            `json:"mountPath"`
	Subpath   *string           `json:"subpath,omitempty"`
	Backend   *VolumeBackendDTO `json:"backend,omitempty"`
}

func (v VolumeDTO) BackendType() string {
	if v.Backend == nil || v.Backend.Type == "" {
		return VolumeBackendManagedS3
	}
	return v.Backend.Type
}
