// Copyright 2025 Daytona Platforms Inc.
// SPDX-License-Identifier: AGPL-3.0

package docker

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/daytonaio/runner/pkg/api/dto"
)

type VolumeMounter interface {
	BackendType() string
	MountCommand(context.Context, dto.VolumeDTO, *dto.VolumeMountCredentialDTO, string) (*exec.Cmd, error)
}

type S3VolumeMounter struct{ docker *DockerClient }

func (m *S3VolumeMounter) BackendType() string { return dto.VolumeBackendManagedS3 }
func (m *S3VolumeMounter) MountCommand(ctx context.Context, volume dto.VolumeDTO, _ *dto.VolumeMountCredentialDTO, target string) (*exec.Cmd, error) {
	return m.docker.getS3MountCmd(ctx, volumeMountPrefix+volume.VolumeId, target), nil
}

type JuiceFSVolumeMounter struct{ docker *DockerClient }

func (m *JuiceFSVolumeMounter) BackendType() string { return dto.VolumeBackendJuiceFS }
func (m *JuiceFSVolumeMounter) MountCommand(ctx context.Context, volume dto.VolumeDTO, credential *dto.VolumeMountCredentialDTO, target string) (*exec.Cmd, error) {
	if volume.Backend == nil || volume.Backend.JuiceFS == nil {
		return nil, fmt.Errorf("juicefs backend configuration is required")
	}
	if _, err := exec.LookPath("juicefs"); err != nil {
		return nil, fmt.Errorf("juicefs command is not installed: %w", err)
	}
	if _, err := os.Stat("/dev/fuse"); err != nil {
		return nil, fmt.Errorf("FUSE device /dev/fuse is not available: %w", err)
	}
	cacheDir := filepath.Join("/var/lib/daytona/juicefs-cache", volume.VolumeId)
	if err := os.MkdirAll(cacheDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create JuiceFS cache directory: %w", err)
	}
	return m.docker.getJuiceFSMountCmd(ctx, volume, credential, target), nil
}

type VolumeMounterRegistry struct {
	mounters map[string]VolumeMounter
}

func newVolumeMounterRegistry(docker *DockerClient) *VolumeMounterRegistry {
	mounters := []VolumeMounter{
		&S3VolumeMounter{docker: docker},
		&JuiceFSVolumeMounter{docker: docker},
	}
	registry := &VolumeMounterRegistry{mounters: make(map[string]VolumeMounter, len(mounters))}
	for _, mounter := range mounters {
		registry.mounters[mounter.BackendType()] = mounter
	}
	return registry
}

func (r *VolumeMounterRegistry) Get(backendType string) (VolumeMounter, error) {
	mounter, ok := r.mounters[backendType]
	if !ok {
		return nil, fmt.Errorf("unsupported volume backend %q", backendType)
	}
	return mounter, nil
}
