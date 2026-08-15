// Copyright 2025 Daytona Platforms Inc.
// SPDX-License-Identifier: AGPL-3.0

package docker

import (
	"context"
	"slices"
	"strings"
	"testing"

	"github.com/daytonaio/runner/pkg/api/dto"
)

func TestJuiceFSMountCommandKeepsPasswordOutOfArguments(t *testing.T) {
	volume := dto.VolumeDTO{
		VolumeId: "00000000-0000-0000-0000-000000000001",
		Backend: &dto.VolumeBackendDTO{
			Type: dto.VolumeBackendJuiceFS,
			JuiceFS: &dto.JuiceFSVolumeSourceDTO{
				MetaURL:      "redis://metadata:6379/1",
				CacheSizeMiB: 2048,
			},
		},
	}
	credential := &dto.VolumeMountCredentialDTO{
		JuiceFS: &dto.JuiceFSVolumeMountCredentialDTO{MetaPassword: "top-secret"},
	}

	cmd := (&DockerClient{}).getJuiceFSMountCmd(context.Background(), volume, credential, "/mnt/volume")
	wantArgs := []string{
		"juicefs", "mount", "-d",
		"--cache-dir", "/var/lib/daytona/juicefs-cache/00000000-0000-0000-0000-000000000001",
		"--cache-size", "2048",
		"redis://metadata:6379/1", "/mnt/volume",
	}
	if !slices.Equal(cmd.Args, wantArgs) {
		t.Fatalf("unexpected JuiceFS arguments: %#v", cmd.Args)
	}
	if strings.Contains(strings.Join(cmd.Args, " "), "top-secret") {
		t.Fatal("metadata password was included in command arguments")
	}
	if !slices.Contains(cmd.Env, "META_PASSWORD=top-secret") {
		t.Fatal("metadata password was not provided through the child process environment")
	}
	for _, arg := range cmd.Args {
		if arg == "--file-mode" || arg == "--dir-mode" || arg == "--subdir" {
			t.Fatalf("JuiceFS command must not override POSIX permissions or use --subdir: %s", arg)
		}
	}
}
