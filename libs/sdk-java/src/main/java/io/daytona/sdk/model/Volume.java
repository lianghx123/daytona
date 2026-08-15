// Copyright Daytona Platforms Inc.
// SPDX-License-Identifier: Apache-2.0

package io.daytona.sdk.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import io.daytona.api.client.model.VolumeBackendDto;

@JsonIgnoreProperties(ignoreUnknown = true)
/**
 * Volume metadata returned by Daytona APIs.
 */
public class Volume {
    @JsonProperty("id")
    private String id;
    @JsonProperty("name")
    private String name;
    @JsonProperty("state")
    private String state;
    @JsonProperty("backend")
    private VolumeBackendDto backend;
    @JsonProperty("lifecycle")
    private String lifecycle;

    /**
     * Returns volume identifier.
     *
     * @return volume ID
     */
    public String getId() { return id; }

    /**
     * Sets volume identifier.
     *
     * @param id volume ID
     */
    public void setId(String id) { this.id = id; }

    /**
     * Returns volume name.
     *
     * @return volume name
     */
    public String getName() { return name; }

    /**
     * Sets volume name.
     *
     * @param name volume name
     */
    public void setName(String name) { this.name = name; }

    /**
     * Returns volume state.
     *
     * @return lifecycle state
     */
    public String getState() { return state; }

    /**
     * Sets volume state.
     *
     * @param state lifecycle state
     */
    public void setState(String state) { this.state = state; }

    public VolumeBackendDto getBackend() { return backend; }

    public void setBackend(VolumeBackendDto backend) { this.backend = backend; }

    public String getLifecycle() { return lifecycle; }

    public void setLifecycle(String lifecycle) { this.lifecycle = lifecycle; }
}
