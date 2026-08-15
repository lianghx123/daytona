// Copyright 2025 Daytona Platforms Inc.
// SPDX-License-Identifier: AGPL-3.0

package docker

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/daytonaio/runner/pkg/api/dto"
)

func TestSandboxHostConfigProtectsRunnerManagedMounts(t *testing.T) {
	client := &DockerClient{resourceLimitsDisabled: true}
	hostConfig, err := client.getContainerHostConfig(dto.CreateSandboxDTO{}, []string{"/host/volume:/sandbox/volume"}, nil)
	if err != nil {
		t.Fatalf("getContainerHostConfig failed: %v", err)
	}
	if !hostConfig.Privileged {
		t.Fatal("mount protection must not remove the existing privileged sandbox behavior")
	}
	assertMountProtectionSeccomp(t, hostConfig.SecurityOpt)
}

func TestSandboxWithoutManagedMountKeepsExistingSeccompBehavior(t *testing.T) {
	client := &DockerClient{resourceLimitsDisabled: true}
	hostConfig, err := client.getContainerHostConfig(dto.CreateSandboxDTO{}, nil, nil)
	if err != nil {
		t.Fatalf("getContainerHostConfig failed: %v", err)
	}
	if len(hostConfig.SecurityOpt) != 0 {
		t.Fatalf("mount protection should only be enabled for sandboxes with managed mounts: %#v", hostConfig.SecurityOpt)
	}
}

func TestAndroidHostConfigProtectsRunnerManagedMounts(t *testing.T) {
	client := &DockerClient{resourceLimitsDisabled: true}
	hostConfig := client.getAndroidDeviceHostConfig(dto.CreateSandboxDTO{}, []string{"/host/volume:/sandbox/volume"})
	assertMountProtectionSeccomp(t, hostConfig.SecurityOpt)
}

func assertMountProtectionSeccomp(t *testing.T, securityOpt []string) {
	t.Helper()
	if len(securityOpt) != 1 || !strings.HasPrefix(securityOpt[0], "seccomp=") {
		t.Fatalf("sandbox does not have an inline seccomp profile: %#v", securityOpt)
	}
	var profile struct {
		DefaultAction string `json:"defaultAction"`
		Syscalls      []struct {
			Names  []string `json:"names"`
			Action string   `json:"action"`
		} `json:"syscalls"`
	}
	if err := json.Unmarshal([]byte(strings.TrimPrefix(securityOpt[0], "seccomp=")), &profile); err != nil {
		t.Fatalf("invalid seccomp JSON: %v", err)
	}
	if profile.DefaultAction != "SCMP_ACT_ALLOW" {
		t.Fatalf("unexpected seccomp default action: %s", profile.DefaultAction)
	}
	if len(profile.Syscalls) != 1 || profile.Syscalls[0].Action != "SCMP_ACT_ERRNO" {
		t.Fatalf("unexpected seccomp syscall rules: %#v", profile.Syscalls)
	}
	for _, syscall := range []string{"umount", "umount2"} {
		found := false
		for _, name := range profile.Syscalls[0].Names {
			found = found || name == syscall
		}
		if !found {
			t.Fatalf("seccomp profile does not block %s", syscall)
		}
	}
}
