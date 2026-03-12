const GHCR_IMAGE_REF_PATTERN =
  /^ghcr\.io\/(?<owner>[^/]+)\/(?<name>[^:@]+)(?::[^@]+)?(?:@sha256:[a-f0-9]{64})?$/i;

export function getScorerPackageUrl(
  value: string | null | undefined,
): string | null {
  if (!value) return null;

  const match = GHCR_IMAGE_REF_PATTERN.exec(value.trim());
  if (!match?.groups) return null;

  const owner = match.groups.owner?.toLowerCase();
  const name = match.groups.name;
  if (!owner || !name) return null;

  // Official Agora scorer images are published from this repository.
  if (owner === "andymolecule") {
    return `https://github.com/andymolecule/Agora/pkgs/container/${name}`;
  }

  return null;
}
