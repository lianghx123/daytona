// Copyright 2025 Daytona Platforms Inc.
// SPDX-License-Identifier: AGPL-3.0

package docker

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/daytonaio/common-go/pkg/log"
	"github.com/daytonaio/runner/cmd/runner/config"
	"github.com/daytonaio/runner/pkg/api/dto"
	"github.com/google/uuid"
)

const volumeMountPrefix = "daytona-volume-"

// volumeId becomes part of the host mount path and the S3 bucket name, so require
// the canonical lowercase UUID form (rejects braced/URN/dashless/uppercase variants,
// which uuid.Parse would otherwise accept).
func isValidVolumeId(volumeId string) bool {
	parsed, err := uuid.Parse(volumeId)
	if err != nil {
		return false
	}
	return parsed.String() == volumeId
}

func getVolumeMountBasePath() string {
	if config.GetEnvironment() == "development" {
		return "/tmp"
	}
	return "/mnt"
}

func (d *DockerClient) getVolumesMountPathBinds(ctx context.Context, volumes []dto.VolumeDTO, credentials dto.VolumeMountCredentialsDTO) ([]string, error) {
	// Phase 1: fan out FUSE mounts for unique volumes in parallel. Each
	// ensureVolumeFuseMounted runs mount-s3 and then waits up to 5s for the
	// mount to become ready; doing them sequentially made create-time scale
	// linearly with the number of mounted volumes.
	type uniqueVolumeMount struct {
		volume    dto.VolumeDTO
		mountPath string
	}
	uniqueMounts := make(map[string]uniqueVolumeMount, len(volumes))
	mountBase := filepath.Clean(getVolumeMountBasePath())
	for _, vol := range volumes {
		if !isValidVolumeId(vol.VolumeId) {
			return nil, fmt.Errorf("invalid volumeId %q: must be a volume UUID", vol.VolumeId)
		}
		volumeIdPrefixed := fmt.Sprintf("%s%s", volumeMountPrefix, vol.VolumeId)
		if existing, ok := uniqueMounts[volumeIdPrefixed]; ok {
			if existing.volume.BackendType() != vol.BackendType() {
				return nil, fmt.Errorf("volume %s has conflicting backend specifications", vol.VolumeId)
			}
		} else {
			baseMountPath := filepath.Join(getVolumeMountBasePath(), volumeIdPrefixed)
			// Defense in depth: the path must stay a direct child of mountBase so a
			// traversal string can never escape it or collide with another volume.
			if filepath.Dir(baseMountPath) != mountBase || filepath.Base(baseMountPath) != volumeIdPrefixed {
				return nil, fmt.Errorf("invalid volumeId %q: resolves outside volume mount base", vol.VolumeId)
			}
			uniqueMounts[volumeIdPrefixed] = uniqueVolumeMount{volume: vol, mountPath: baseMountPath}
		}
	}

	mountCtx, cancelMounts := context.WithCancel(ctx)
	defer cancelMounts()

	var (
		wg       sync.WaitGroup
		errMu    sync.Mutex
		firstErr error
	)
	for _, uniqueMount := range uniqueMounts {
		wg.Add(1)
		go func(mount uniqueVolumeMount) {
			defer wg.Done()
			credential, hasCredential := credentials[mount.volume.VolumeId]
			var credentialPtr *dto.VolumeMountCredentialDTO
			if hasCredential {
				credentialPtr = &credential
			}
			if err := d.ensureVolumeFuseMounted(mountCtx, mount.volume, credentialPtr, mount.mountPath); err != nil {
				errMu.Lock()
				if firstErr == nil {
					firstErr = err
					cancelMounts()
				}
				errMu.Unlock()
			}
		}(uniqueMount)
	}
	wg.Wait()
	if firstErr != nil {
		return nil, firstErr
	}

	// Phase 2: build bind strings in input order. Subpath mkdir is cheap and
	// kept sequential so the returned slice order matches volumes.
	volumeMountPathBinds := make([]string, 0, len(volumes))
	for _, vol := range volumes {
		volumeIdPrefixed := fmt.Sprintf("%s%s", volumeMountPrefix, vol.VolumeId)
		baseMountPath := uniqueMounts[volumeIdPrefixed].mountPath

		subpathStr := ""
		if vol.Subpath != nil {
			subpathStr = *vol.Subpath
		}

		bindSource := baseMountPath
		if vol.Subpath != nil && *vol.Subpath != "" {
			bindSource = filepath.Join(baseMountPath, *vol.Subpath)
			// Ensure the resolved path stays within baseMountPath to prevent path traversal
			relativePath, relErr := filepath.Rel(baseMountPath, bindSource)
			if relErr != nil || relativePath == ".." || strings.HasPrefix(relativePath, ".."+string(filepath.Separator)) {
				return nil, fmt.Errorf("invalid subpath %q: resolves outside volume mount", *vol.Subpath)
			}
			err := os.MkdirAll(bindSource, 0755)
			if err != nil {
				return nil, fmt.Errorf("failed to create subpath directory %s: %s", bindSource, err)
			}
		}

		d.logger.DebugContext(ctx, "binding volume subpath", "volumeId", volumeIdPrefixed, "subpath", subpathStr, "mountPath", vol.MountPath)
		volumeMountPathBinds = append(volumeMountPathBinds, fmt.Sprintf("%s/:%s/", bindSource, vol.MountPath))
	}

	return volumeMountPathBinds, nil
}

func (d *DockerClient) ensureVolumeFuseMounted(ctx context.Context, volume dto.VolumeDTO, credential *dto.VolumeMountCredentialDTO, mountPath string) error {
	volumeId := fmt.Sprintf("%s%s", volumeMountPrefix, volume.VolumeId)
	d.volumeMutexesMutex.Lock()
	volumeMutex, exists := d.volumeMutexes[volumeId]
	if !exists {
		volumeMutex = &sync.Mutex{}
		d.volumeMutexes[volumeId] = volumeMutex
	}
	d.volumeMutexesMutex.Unlock()

	volumeMutex.Lock()
	defer volumeMutex.Unlock()

	if d.isDirectoryMounted(mountPath) {
		d.logger.DebugContext(ctx, "volume already mounted", "volumeId", volumeId, "mountPath", mountPath)
		return nil
	}

	// Track if directory existed before we create it
	_, statErr := os.Stat(mountPath)
	dirExisted := statErr == nil

	err := os.MkdirAll(mountPath, 0755)
	if err != nil {
		return fmt.Errorf("failed to create mount directory %s: %s", mountPath, err)
	}

	d.logger.InfoContext(ctx, "mounting volume", "volumeId", volumeId, "backend", volume.BackendType(), "mountPath", mountPath)

	mounter, err := newVolumeMounterRegistry(d).Get(volume.BackendType())
	if err != nil {
		return err
	}
	cmd, err := mounter.MountCommand(ctx, volume, credential, mountPath)
	if err != nil {
		return err
	}
	err = cmd.Run()
	if err != nil {
		d.cleanupFailedVolumeMount(ctx, volume, mountPath, dirExisted, true)
		return fmt.Errorf("failed to mount %s volume %s to %s: %s", volume.BackendType(), volumeId, mountPath, err)
	}

	err = d.waitForMountReady(ctx, mountPath)
	if err != nil {
		d.cleanupFailedVolumeMount(ctx, volume, mountPath, dirExisted, true)
		return fmt.Errorf("mount %s not ready after mounting: %s", mountPath, err)
	}

	d.logger.InfoContext(ctx, "mounted volume", "volumeId", volumeId, "backend", volume.BackendType(), "mountPath", mountPath)
	return nil
}

func (d *DockerClient) cleanupFailedVolumeMount(ctx context.Context, volume dto.VolumeDTO, mountPath string, dirExisted bool, tryUnmount bool) {
	if tryUnmount && d.isDirectoryMounted(mountPath) {
		if err := exec.Command("umount", mountPath).Run(); err != nil {
			d.logger.WarnContext(ctx, "failed to unmount during cleanup", "path", mountPath, "error", err)
		}
	}
	if d.isDirectoryMounted(mountPath) {
		return
	}
	if !dirExisted {
		if err := os.Remove(mountPath); err != nil && !os.IsNotExist(err) {
			d.logger.WarnContext(ctx, "failed to remove mount directory during cleanup", "path", mountPath, "error", err)
		}
	}
	if volume.BackendType() == dto.VolumeBackendJuiceFS {
		cachePath := filepath.Join("/var/lib/daytona/juicefs-cache", volume.VolumeId)
		if err := os.RemoveAll(cachePath); err != nil {
			d.logger.WarnContext(ctx, "failed to remove JuiceFS cache during cleanup", "path", cachePath, "error", err)
		}
	}
}

func (d *DockerClient) isDirectoryMounted(path string) bool {
	cmd := exec.Command("mountpoint", path)
	_, err := cmd.Output()

	return err == nil
}

// waitForMountReady waits for a FUSE mount to be fully accessible
// FUSE mounts can be asynchronous - the mount command may return before the filesystem is ready
// This prevents a race condition where the container writes to the directory before the mount is ready
func (d *DockerClient) waitForMountReady(ctx context.Context, path string) error {
	maxAttempts := 50 // 5 seconds total (50 * 100ms)
	sleepDuration := 100 * time.Millisecond

	for i := 0; i < maxAttempts; i++ {
		// First verify the mountpoint is still registered
		if !d.isDirectoryMounted(path) {
			return fmt.Errorf("mount disappeared during readiness check")
		}

		// Try to stat the mount point to ensure filesystem is responsive
		// This will fail if FUSE is not ready yet
		_, err := os.Stat(path)
		if err == nil {
			// Try to read directory to ensure it's fully operational
			_, err = os.ReadDir(path)
			if err == nil {
				d.logger.InfoContext(ctx, "mount is ready", "path", path, "attempts", i+1)
				return nil
			}
		}

		// Wait a bit before retrying
		select {
		case <-ctx.Done():
			return fmt.Errorf("context cancelled while waiting for mount ready: %w", ctx.Err())
		case <-time.After(sleepDuration):
			// Continue to next iteration
		}
	}

	return fmt.Errorf("mount did not become ready within timeout")
}

func (d *DockerClient) getS3MountCmd(ctx context.Context, volume string, path string) *exec.Cmd {
	args := []string{"--allow-other", "--allow-delete", "--allow-overwrite", "--file-mode", "0666", "--dir-mode", "0777"}
	if endpoint := strings.TrimSpace(d.awsEndpointUrl); endpoint != "" {
		args = append(args, "--endpoint-url", endpoint, "--force-path-style")
	}
	args = append(args, volume, path)

	var envVars []string
	if d.awsAccessKeyId != "" {
		envVars = append(envVars, "AWS_ACCESS_KEY_ID="+d.awsAccessKeyId)
	}
	if d.awsSecretAccessKey != "" {
		envVars = append(envVars, "AWS_SECRET_ACCESS_KEY="+d.awsSecretAccessKey)
	}
	if d.awsRegion != "" {
		envVars = append(envVars, "AWS_REGION="+d.awsRegion)
	}

	// No systemd (containerized) — daemon orphan survives runner restarts naturally.
	// CommandContext is used so ctx cancellation can stop a slow mount-s3 startup;
	// once mount-s3 daemonizes (no --foreground), cmd.Run returns and ctx no longer has a leash.
	cmd := exec.CommandContext(ctx, "mount-s3", args...)
	cmd.Env = append(os.Environ(), envVars...)

	_, err := os.Stat("/run/systemd/system")
	if err == nil {
		// Isolate mount-s3 in its own cgroup so the FUSE daemon survives runner restarts.
		sdArgs := []string{"--scope"}
		for _, env := range envVars {
			sdArgs = append(sdArgs, "--setenv="+env)
		}
		sdArgs = append(sdArgs, "--", "mount-s3")
		sdArgs = append(sdArgs, args...)
		cmd = exec.CommandContext(ctx, "systemd-run", sdArgs...)
	}

	cmd.Stderr = io.Writer(&log.ErrorLogWriter{})
	cmd.Stdout = io.Writer(&log.InfoLogWriter{})

	return cmd
}

func (d *DockerClient) getJuiceFSMountCmd(ctx context.Context, volume dto.VolumeDTO, credential *dto.VolumeMountCredentialDTO, path string) *exec.Cmd {
	config := volume.Backend.JuiceFS
	cacheDir := filepath.Join("/var/lib/daytona/juicefs-cache", volume.VolumeId)
	args := []string{
		"mount",
		"-d",
		"--cache-dir", cacheDir,
		"--cache-size", fmt.Sprintf("%d", config.CacheSizeMiB),
		config.MetaURL,
		path,
	}
	cmd := exec.CommandContext(ctx, "juicefs", args...)
	cmd.Env = os.Environ()
	if credential != nil && credential.JuiceFS != nil && credential.JuiceFS.MetaPassword != "" {
		cmd.Env = append(cmd.Env, "META_PASSWORD="+credential.JuiceFS.MetaPassword)
	}
	cmd.Stderr = io.Writer(&log.ErrorLogWriter{})
	cmd.Stdout = io.Writer(&log.InfoLogWriter{})
	return cmd
}
