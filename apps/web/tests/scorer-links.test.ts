import assert from "node:assert/strict";
import test from "node:test";
import { getScorerPackageUrl } from "../src/lib/scorer-links";

test("getScorerPackageUrl links official Agora scorer images to the package page", () => {
  assert.equal(
    getScorerPackageUrl(
      "ghcr.io/andymolecule/gems-match-scorer@sha256:b4b94ab1b0d35fc3098a36de542805f3c74e512bb2f0cfc01f60125790f71cde",
    ),
    "https://github.com/andymolecule/Agora/pkgs/container/gems-match-scorer",
  );
});

test("getScorerPackageUrl ignores unsupported or custom image references", () => {
  assert.equal(
    getScorerPackageUrl(
      "ghcr.io/acme/custom-scorer@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    ),
    null,
  );
  assert.equal(getScorerPackageUrl("docker.io/library/python:3.12"), null);
  assert.equal(getScorerPackageUrl(null), null);
});
