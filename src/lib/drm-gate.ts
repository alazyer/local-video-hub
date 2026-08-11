export interface DrmRequirement {
  keySystem: string;
  licenseUrl: string;
  certificateUrl?: string;
}

export interface DrmGateResult {
  allowed: boolean;
  reason?: string;
}

export function evaluateDrmGate(
  requirement: DrmRequirement | null | undefined,
  drmApiAvailable: boolean,
): DrmGateResult {
  if (!requirement) return { allowed: true };

  if (!drmApiAvailable) {
    return {
      allowed: false,
      reason: "DRM is required but this browser does not expose EME APIs.",
    };
  }

  if (!requirement.licenseUrl.startsWith("https://")) {
    return {
      allowed: false,
      reason: "DRM license URL must be HTTPS.",
    };
  }

  return { allowed: true };
}
